const http = require('http');
const path = require('path');
const Blockchain = require('../lib/chain');
const Transaction = require('../lib/transaction');
const { version: PKG_VERSION } = require('../package.json');

const DEFAULT_PORT = 4000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const MAX_REQUESTS_PER_MINUTE = Number(process.env.FEMTOCHAIN_API_RATE_LIMIT || 120);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = Number(process.env.FEMTOCHAIN_API_MAX_BODY || DEFAULT_MAX_BODY_BYTES);

const RATE_LIMIT_STORE = new Map();

function getCorsOrigin(req) {
  const configured = process.env.FEMTOCHAIN_CORS_ORIGIN || '';
  if (configured) return configured;

  const origin = req.headers.origin;
  if (!origin) return '*';

  const allowList = ['http://localhost', 'http://127.0.0.1'];
  if (allowList.some(prefix => origin.startsWith(prefix))) {
    return origin;
  }

  return 'null';
}

function getAuthToken() {
  return process.env.FEMTOCHAIN_API_TOKEN || '';
}

function enforceRateLimit(req, res, limit) {
  const maxRequests = Number(limit || MAX_REQUESTS_PER_MINUTE);
  if (maxRequests <= 0) return false;

  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = RATE_LIMIT_STORE.get(ip) || { count: 0, start: now };

  if (now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket.count = 0;
    bucket.start = now;
  }

  bucket.count += 1;
  RATE_LIMIT_STORE.set(ip, bucket);

  if (bucket.count > maxRequests) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded' }) + '\n');
    return true;
  }

  return false;
}

function enforceAuth(req, res, expectedToken) {
  if (!expectedToken) return false;

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== expectedToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }) + '\n');
    return true;
  }

  return false;
}

function start(port, dataDir, options = {}) {
  const chain = new Blockchain(dataDir);
  const apiToken = options.apiToken || process.env.FEMTOCHAIN_API_TOKEN || '';
  const rateLimit = options.rateLimit || Number(process.env.FEMTOCHAIN_API_RATE_LIMIT || 120);
  const maxBodyBytes = options.maxBodyBytes || MAX_BODY_BYTES;
  const server = http.createServer((req, res) => handle(req, res, chain, port, apiToken, rateLimit, maxBodyBytes));
  server.listen(port, () => {
    console.log(`FemtoChain API on http://localhost:${port}`);
  });
  return server;
}

function handle(req, res, chain, listenPort, apiToken, rateLimit, maxBodyBytes = MAX_BODY_BYTES) {
  const origin = getCorsOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${listenPort}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Health checks are intentionally unauthenticated and exempt from rate
  // limiting so load balancers and monitoring probes can always reach them.
  if ((path === '/health' || path === '/api/health') && req.method === 'GET') {
    return sendHealth(res, chain);
  }

  const configuredToken = apiToken || getAuthToken();
  if (configuredToken) {
    const authBlocked = enforceAuth(req, res, configuredToken);
    if (authBlocked) return;
  }

  const currentLimit = Number(rateLimit || MAX_REQUESTS_PER_MINUTE);
  if (currentLimit > 0 && enforceRateLimit(req, res, currentLimit)) {
    return;
  }

  try {
    if (path === '/api/info' && req.method === 'GET') {
      return json(res, getInfo(chain));
    }
    if (path === '/api/balance' && req.method === 'GET') {
      const address = url.searchParams.get('address');
      if (!address) return error(res, 400, 'Missing address');
      return json(res, { address, balance: chain.getBalance(address) });
    }
    if (path.startsWith('/api/balance/') && req.method === 'GET') {
      const address = path.slice('/api/balance/'.length);
      return json(res, { address, balance: chain.getBalance(address) });
    }
    if (path === '/api/blocks' && req.method === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      return json(res, getBlocks(chain, limit, offset));
    }
    if (path.startsWith('/api/blocks/') && req.method === 'GET') {
      const idx = parseInt(path.slice('/api/blocks/'.length));
      if (isNaN(idx)) return error(res, 400, 'Invalid index');
      const block = chain.chain[idx];
      if (!block) return error(res, 404, 'Block not found');
      return json(res, blockJSON(block));
    }
    if (path === '/api/mempool' && req.method === 'GET') {
      return json(res, { count: 0, note: 'Mempool only available on a live node' });
    }
    if (path === '/api/peers' && req.method === 'GET') {
      return json(res, { peers: [], note: 'Peers only available on a live node' });
    }
    if (path === '/api/tx/decode' && req.method === 'POST') {
      return readBody(req, res, maxBodyBytes, (body) => {
        try {
          const tx = Transaction.decode(body.base64);
          return json(res, {
            from: tx.from, to: tx.to, amount: tx.amount, fee: tx.fee,
            hash: tx.hash(), publicKey: tx.publicKey, signature: tx.signature,
            isCoinbase: tx.isCoinbase(), isValid: tx.isValid()
          });
        } catch (e) {
          return error(res, 400, 'Invalid transaction: ' + e.message);
        }
      });
    }
    return error(res, 404, 'Not found');
  } catch (e) {
    return error(res, 500, e.message);
  }
}

function bigintReplacer(key, value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

// Lightweight liveness/readiness probe. Returns 200 when the node's chain is
// valid and 503 when it is not, so orchestrators can restart unhealthy nodes.
function sendHealth(res, chain) {
  let chainValid = false;
  let blocks = 0;
  let latestHash = null;
  try {
    chainValid = chain.isValid();
    blocks = chain.getBlockCount();
    const latest = chain.getLatestBlock();
    latestHash = latest ? latest.hash : null;
  } catch (_) {
    chainValid = false;
  }

  const body = {
    status: chainValid ? 'ok' : 'unhealthy',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    blocks,
    chainValid,
    latestBlock: latestHash,
    version: PKG_VERSION || null
  };

  res.writeHead(chainValid ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, bigintReplacer, 2) + '\n');
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, bigintReplacer, 2) + '\n');
}

function error(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }) + '\n');
}

// Buffers a request body up to a fixed maximum size. Oversized bodies are
// rejected with 413 and are not accumulated in memory, preventing a single
// large POST from exhausting the node's memory.
function readBody(req, res, maxBytes = MAX_BODY_BYTES, cb) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    error(res, 413, 'Payload too large');
    req.resume();
    return;
  }

  let body = '';
  let size = 0;
  let finished = false;

  req.on('data', (chunk) => {
    if (finished) return;
    size += chunk.length;
    if (size > maxBytes) {
      finished = true;
      body = '';
      error(res, 413, 'Payload too large');
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    try { cb(JSON.parse(body)); }
    catch (e) { error(res, 400, 'Invalid JSON'); }
  });
  req.on('error', () => {
    if (finished) return;
    finished = true;
    error(res, 400, 'Request error');
  });
}

function getInfo(chain) {
  const latest = chain.getLatestBlock();
  return {
    blocks: chain.getBlockCount(),
    supply: chain.getSupply(),
    difficulty: chain.getDifficulty(),
    reward: chain.getBlockReward(),
    latestBlock: {
      index: latest.index,
      hash: latest.hash,
      timestamp: latest.timestamp,
      transactions: latest.transactions.length
    },
    valid: chain.isValid()
  };
}

function getBlocks(chain, limit, offset) {
  const total = chain.chain.length;
  const slice = chain.chain.slice(offset, offset + limit).map(b => blockSummary(b));
  return { blocks: slice, total, offset, limit };
}

function blockSummary(block) {
  const coinbase = block.transactions[0];
  return {
    index: block.index,
    hash: block.hash,
    timestamp: block.timestamp,
    difficulty: block.difficulty,
    txCount: block.transactions.length,
    reward: coinbase ? coinbase.amount : 0n
  };
}

function blockJSON(block) {
  return {
    index: block.index,
    timestamp: block.timestamp,
    hash: block.hash,
    previousHash: block.previousHash,
    difficulty: block.difficulty,
    nonce: block.nonce,
    transactions: block.transactions.map(tx => ({
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      fee: tx.fee,
      hash: tx.hash(),
      isCoinbase: tx.isCoinbase(),
      signature: tx.signature
    }))
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let dataDir = DATA_DIR;
  let apiToken = process.env.FEMTOCHAIN_API_TOKEN || '';
  let rateLimit = Number(process.env.FEMTOCHAIN_API_RATE_LIMIT || 120);
  let maxBodyBytes = Number(process.env.FEMTOCHAIN_API_MAX_BODY || DEFAULT_MAX_BODY_BYTES);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') port = parseInt(args[++i]);
    else if (args[i] === '--data-dir' || args[i] === '-d') dataDir = args[++i];
    else if (args[i] === '--auth-token' || args[i] === '-t') apiToken = args[++i];
    else if (args[i] === '--rate-limit' || args[i] === '-r') rateLimit = parseInt(args[++i]);
    else if (args[i] === '--max-body' || args[i] === '-b') maxBodyBytes = parseInt(args[++i]);
  }

  start(port, dataDir, { apiToken, rateLimit, maxBodyBytes });
}

module.exports = { start };

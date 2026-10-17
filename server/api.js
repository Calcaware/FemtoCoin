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
const DEFAULT_HEADERS_TIMEOUT_MS = 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 5 * 1000;
const DEFAULT_CONNECTIONS_CHECK_INTERVAL_MS = 30 * 1000;
const DEFAULT_RATE_LIMIT_MAX_CLIENTS = 10000;
const DEFAULT_RATE_LIMIT_SWEEP_MS = 30 * 1000;
const DEFAULT_HEALTH_TTL_MS = 1000;

// Coerces a configured value into a positive whole number, falling back to a
// safe default when the value is missing or invalid.
function resolvePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// Coerces a configured duration into a whole number of milliseconds. Zero is a
// valid value here and means "no caching", so the caller revalidates every time.
function resolveDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

// Per-client rate limit buckets in a fixed window. The store is bounded: stale
// buckets are swept once their window has passed and, when the cap is hit, the
// least recently used client is dropped. Without both bounds a large or spoofed
// address space could grow the map forever and exhaust memory.
function createRateLimiter(options = {}) {
  const windowMs = resolvePositiveInt(options.windowMs, RATE_LIMIT_WINDOW_MS);
  const maxClients = resolvePositiveInt(options.maxClients, DEFAULT_RATE_LIMIT_MAX_CLIENTS);
  const sweepIntervalMs = resolvePositiveInt(options.sweepIntervalMs, DEFAULT_RATE_LIMIT_SWEEP_MS);
  const store = new Map();
  let lastSweepAt = 0;

  function sweep(now) {
    for (const [client, bucket] of store) {
      if (now - bucket.start > windowMs) store.delete(client);
    }
    lastSweepAt = now;
  }

  // Records one request for a client and reports whether it is over the limit.
  function check(client, limit, now = Date.now()) {
    // Sweeping is throttled so a burst of requests cannot turn every call into
    // a full scan of the store. Memory stays bounded by maxClients regardless.
    if (now - lastSweepAt >= sweepIntervalMs) sweep(now);

    let bucket = store.get(client);
    if (bucket && now - bucket.start > windowMs) bucket = null;

    if (bucket) {
      // Re-insert so insertion order doubles as least-recently-used order.
      store.delete(client);
    } else {
      bucket = { count: 0, start: now };
    }

    bucket.count += 1;
    store.set(client, bucket);

    while (store.size > maxClients) {
      store.delete(store.keys().next().value);
    }

    return bucket.count > limit;
  }

  return {
    check,
    get size() { return store.size; },
    get maxClients() { return maxClients; }
  };
}

// Health probes are cheap to send but expensive to answer: the readiness check
// walks every block of the chain. This holds the chain-derived part of the
// verdict for a short window so a burst of unauthenticated probes reuses one
// result instead of revalidating the chain on each request. Per-request fields
// such as uptime and timestamp are still produced fresh by the caller.
function createHealthCache(options = {}) {
  const ttlMs = resolveDuration(options.ttlMs, DEFAULT_HEALTH_TTL_MS);
  let entry = null;
  let validations = 0;

  // Returns the cached value while it is younger than the TTL, otherwise calls
  // compute() once and stores the result.
  function read(compute, now = Date.now()) {
    if (entry && now - entry.at < ttlMs) return entry.value;
    const value = compute();
    entry = { value, at: now };
    validations += 1;
    return value;
  }

  // Drops the cached verdict so the next read revalidates the chain. Useful
  // after a state change that should be reflected immediately.
  function reset() {
    entry = null;
  }

  return {
    read,
    reset,
    get ttlMs() { return ttlMs; },
    get validations() { return validations; }
  };
}

// Trust only exact local hostnames. A plain prefix match would also accept
// lookalike hosts such as http://localhost.attacker.example.
function isLocalOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
}

function getCorsOrigin(req) {
  const configured = (process.env.FEMTOCHAIN_CORS_ORIGIN || '').trim();
  const allowed = configured ? configured.split(',').map(entry => entry.trim()).filter(Boolean) : [];
  const origin = req.headers.origin;

  if (allowed.length > 0) {
    if (!origin) return allowed[0];
    // Echoing back only an exact match keeps the header valid; anything else
    // gets an opaque origin so the browser rejects the response.
    return allowed.includes(origin) ? origin : 'null';
  }

  if (!origin) return '*';
  return isLocalOrigin(origin) ? origin : 'null';
}

function getAuthToken() {
  return process.env.FEMTOCHAIN_API_TOKEN || '';
}

function enforceRateLimit(req, res, limit, limiter) {
  const maxRequests = Number(limit ?? MAX_REQUESTS_PER_MINUTE);
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) return false;

  const ip = req.socket.remoteAddress || 'unknown';
  const overLimit = limiter.check(ip, maxRequests);
  if (overLimit) {
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

// Coerces a configured timeout into a positive finite number of milliseconds,
// falling back to a safe default when the value is missing or invalid.
function resolveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Sets per-socket HTTP timeouts so slow or stalled clients cannot keep
// connections open indefinitely and exhaust the server (slowloris-style).
function applyServerTimeouts(server, timeouts = {}) {
  const keepAliveTimeout = resolveTimeout(timeouts.keepAliveTimeout, DEFAULT_KEEPALIVE_TIMEOUT_MS);
  const headersTimeout = resolveTimeout(timeouts.headersTimeout, DEFAULT_HEADERS_TIMEOUT_MS);
  const requestTimeout = resolveTimeout(timeouts.requestTimeout, DEFAULT_REQUEST_TIMEOUT_MS);

  server.keepAliveTimeout = keepAliveTimeout;
  // Node requires headersTimeout to be larger than keepAliveTimeout so idle
  // keep-alive sockets are not torn down before the next request headers.
  server.headersTimeout = Math.max(headersTimeout, keepAliveTimeout + 1000);
  server.requestTimeout = Math.max(requestTimeout, server.headersTimeout);

  // Node only evaluates the header/request deadlines on this interval, so keep
  // it no larger than the smallest timeout for timely enforcement.
  const checkInterval = resolveTimeout(
    timeouts.connectionsCheckingInterval,
    DEFAULT_CONNECTIONS_CHECK_INTERVAL_MS
  );
  server.connectionsCheckingInterval = Math.min(checkInterval, server.headersTimeout);
  return server;
}

function start(port, dataDir, options = {}) {
  const chain = new Blockchain(dataDir);
  const apiToken = options.apiToken || process.env.FEMTOCHAIN_API_TOKEN || '';
  const rateLimit = options.rateLimit ?? Number(process.env.FEMTOCHAIN_API_RATE_LIMIT || 120);
  const maxBodyBytes = options.maxBodyBytes || MAX_BODY_BYTES;
  const rateLimiter = createRateLimiter({
    maxClients:
      options.rateLimitMaxClients ?? process.env.FEMTOCHAIN_API_RATE_LIMIT_MAX_CLIENTS,
    windowMs: options.rateLimitWindowMs
  });
  const healthCache = createHealthCache({
    ttlMs: options.healthTtl ?? process.env.FEMTOCHAIN_API_HEALTH_TTL
  });
  const server = http.createServer((req, res) =>
    handle(req, res, { chain, port, apiToken, rateLimit, maxBodyBytes, rateLimiter, healthCache }));
  // Exposed for introspection and tests; the limiter stores its buckets per
  // server and the health cache holds this server's cached readiness verdict.
  server.rateLimiter = rateLimiter;
  server.healthCache = healthCache;
  applyServerTimeouts(server, {
    headersTimeout: options.headersTimeout ?? process.env.FEMTOCHAIN_API_HEADERS_TIMEOUT,
    requestTimeout: options.requestTimeout ?? process.env.FEMTOCHAIN_API_REQUEST_TIMEOUT,
    keepAliveTimeout: options.keepAliveTimeout ?? process.env.FEMTOCHAIN_API_KEEPALIVE_TIMEOUT,
    connectionsCheckingInterval:
      options.connectionsCheckingInterval ?? process.env.FEMTOCHAIN_API_CONNECTIONS_CHECK_INTERVAL
  });
  server.listen(port, () => {
    console.log(`FemtoChain API on http://localhost:${port}`);
  });
  return server;
}

function handle(req, res, context) {
  const {
    chain, port, apiToken, rateLimit,
    maxBodyBytes = MAX_BODY_BYTES, rateLimiter, healthCache
  } = context;
  const origin = getCorsOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Health checks are intentionally unauthenticated and exempt from rate
  // limiting so load balancers and monitoring probes can always reach them.
  if ((path === '/health' || path === '/api/health') && req.method === 'GET') {
    return sendHealth(res, chain, healthCache);
  }

  const configuredToken = apiToken || getAuthToken();
  if (configuredToken) {
    const authBlocked = enforceAuth(req, res, configuredToken);
    if (authBlocked) return;
  }

  const currentLimit = Number(rateLimit ?? MAX_REQUESTS_PER_MINUTE);
  if (Number.isFinite(currentLimit) && currentLimit > 0 &&
      enforceRateLimit(req, res, currentLimit, rateLimiter)) {
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

// Collects the chain-derived part of the readiness verdict. This is the
// expensive half, so callers route it through the health cache.
function readChainState(chain) {
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
  return { chainValid, blocks, latestHash };
}

// Lightweight liveness/readiness probe. Returns 200 when the node's chain is
// valid and 503 when it is not, so orchestrators can restart unhealthy nodes.
function sendHealth(res, chain, healthCache) {
  const state = healthCache
    ? healthCache.read(() => readChainState(chain))
    : readChainState(chain);

  const body = {
    status: state.chainValid ? 'ok' : 'unhealthy',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    blocks: state.blocks,
    chainValid: state.chainValid,
    latestBlock: state.latestHash,
    version: PKG_VERSION || null
  };

  res.writeHead(state.chainValid ? 200 : 503, { 'Content-Type': 'application/json' });
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
  let rateLimitMaxClients = process.env.FEMTOCHAIN_API_RATE_LIMIT_MAX_CLIENTS;
  let maxBodyBytes = Number(process.env.FEMTOCHAIN_API_MAX_BODY || DEFAULT_MAX_BODY_BYTES);
  let headersTimeout = process.env.FEMTOCHAIN_API_HEADERS_TIMEOUT;
  let requestTimeout = process.env.FEMTOCHAIN_API_REQUEST_TIMEOUT;
  let keepAliveTimeout = process.env.FEMTOCHAIN_API_KEEPALIVE_TIMEOUT;
  let connectionsCheckingInterval = process.env.FEMTOCHAIN_API_CONNECTIONS_CHECK_INTERVAL;
  let healthTtl = process.env.FEMTOCHAIN_API_HEALTH_TTL;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') port = parseInt(args[++i]);
    else if (args[i] === '--data-dir' || args[i] === '-d') dataDir = args[++i];
    else if (args[i] === '--auth-token' || args[i] === '-t') apiToken = args[++i];
    else if (args[i] === '--rate-limit' || args[i] === '-r') rateLimit = parseInt(args[++i]);
    else if (args[i] === '--rate-limit-clients') rateLimitMaxClients = parseInt(args[++i]);
    else if (args[i] === '--max-body' || args[i] === '-b') maxBodyBytes = parseInt(args[++i]);
    else if (args[i] === '--headers-timeout') headersTimeout = parseInt(args[++i]);
    else if (args[i] === '--request-timeout') requestTimeout = parseInt(args[++i]);
    else if (args[i] === '--keepalive-timeout') keepAliveTimeout = parseInt(args[++i]);
    else if (args[i] === '--check-interval') connectionsCheckingInterval = parseInt(args[++i]);
    else if (args[i] === '--health-ttl') healthTtl = parseInt(args[++i]);
  }

  start(port, dataDir, {
    apiToken, rateLimit, rateLimitMaxClients, maxBodyBytes,
    headersTimeout, requestTimeout, keepAliveTimeout, connectionsCheckingInterval,
    healthTtl
  });
}

module.exports = { start, applyServerTimeouts, createRateLimiter, createHealthCache };

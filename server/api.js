const http = require('http');
const path = require('path');
const Blockchain = require('../lib/chain');
const Transaction = require('../lib/transaction');
const { COIN, toFTM, parseFTM } = require('../lib/unit');

const DEFAULT_PORT = 4000;
const DATA_DIR = path.join(__dirname, '..', 'data');

function start(port, dataDir) {
  const chain = new Blockchain(dataDir);
  const server = http.createServer((req, res) => handle(req, res, chain, port));
  server.listen(port, () => {
    console.log(`FemtoChain API on http://localhost:${port}`);
  });
  return server;
}

function handle(req, res, chain, listenPort) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${listenPort}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

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
      return readBody(req, res, (body) => {
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

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, bigintReplacer, 2) + '\n');
}

function error(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }) + '\n');
}

function readBody(req, res, cb) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { cb(JSON.parse(body)); }
    catch (e) { error(res, 400, 'Invalid JSON'); }
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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') port = parseInt(args[++i]);
    else if (args[i] === '--data-dir' || args[i] === '-d') dataDir = args[++i];
  }
  start(port, dataDir);
}

module.exports = { start };

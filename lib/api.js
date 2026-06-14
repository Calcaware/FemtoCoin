const http = require('http');
const { addressFromPublicKey } = require('./crypto');
const Transaction = require('./transaction');

const DEFAULT_PORT = 4000;

class ApiServer {
  constructor(node, apiPort) {
    this.node = node;
    this.chain = node.chain;
    this.port = apiPort || DEFAULT_PORT;
    this.server = null;
  }

  start() {
    this.server = http.createServer((req, res) => this._handle(req, res));
    this.server.listen(this.port, () => {
      console.log(`REST API on http://localhost:${this.port}`);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }

  _handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${this.port}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    try {
      if (path === '/api/info' && method === 'GET') {
        return this._json(res, this._getInfo());
      }
      if (path === '/api/balance' && method === 'GET') {
        const address = url.searchParams.get('address');
        if (!address) return this._error(res, 400, 'Missing address query parameter');
        return this._json(res, { address, balance: this.chain.getBalance(address) });
      }
      if (path.startsWith('/api/balance/') && method === 'GET') {
        const address = path.slice('/api/balance/'.length);
        return this._json(res, { address, balance: this.chain.getBalance(address) });
      }
      if (path === '/api/blocks' && method === 'GET') {
        const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
        const offset = parseInt(url.searchParams.get('offset')) || 0;
        return this._json(res, this._getBlocks(limit, offset));
      }
      if (path.startsWith('/api/blocks/') && method === 'GET') {
        const index = parseInt(path.slice('/api/blocks/'.length));
        if (isNaN(index)) return this._error(res, 400, 'Invalid block index');
        const block = this.chain.chain[index];
        if (!block) return this._error(res, 404, 'Block not found');
        return this._json(res, this._blockToJSON(block));
      }
      if (path === '/api/mempool' && method === 'GET') {
        return this._json(res, this._getMempool());
      }
      if (path === '/api/peers' && method === 'GET') {
        return this._json(res, { peers: this.node.getPeerList() });
      }
      if (path === '/api/tx/send' && method === 'POST') {
        return this._readBody(req, res, (body) => {
          try {
            const result = this._sendTx(body);
            return this._json(res, result);
          } catch (err) {
            return this._error(res, 400, err.message);
          }
        });
      }
      if (path === '/api/tx/decode' && method === 'POST') {
        return this._readBody(req, res, (body) => {
          try {
            const tx = Transaction.decode(body.base64);
            return this._json(res, {
              from: tx.from,
              to: tx.to,
              amount: tx.amount,
              fee: tx.fee,
              hash: tx.hash(),
              publicKey: tx.publicKey,
              signature: tx.signature,
              isCoinbase: tx.isCoinbase(),
              isValid: tx.isValid()
            });
          } catch (err) {
            return this._error(res, 400, 'Invalid transaction: ' + err.message);
          }
        });
      }
      if (path === '/api/wallet/create' && method === 'POST') {
        return this._readBody(req, res, (body) => {
          try {
            const { Wallet } = require('./wallet');
            const wallet = new Wallet(this.node.dataDir + '/../wallets');
            wallet.createNew();
            wallet.save(body.name || 'wallet-' + Date.now());
            return this._json(res, { address: wallet.address });
          } catch (err) {
            return this._error(res, 500, err.message);
          }
        });
      }
      return this._error(res, 404, 'Not found');
    } catch (err) {
      return this._error(res, 500, err.message);
    }
  }

  _json(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2) + '\n');
  }

  _error(res, status, message) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }, null, 2) + '\n');
  }

  _readBody(req, res, cb) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        cb(JSON.parse(body));
      } catch (err) {
        this._error(res, 400, 'Invalid JSON body');
      }
    });
  }

  _getInfo() {
    const c = this.chain;
    const latest = c.getLatestBlock();
    return {
      blocks: c.getBlockCount(),
      supply: c.getSupply(),
      difficulty: c.getDifficulty(),
      reward: c.getBlockReward(),
      mempool: this.node.getMempoolSize(),
      peers: this.node.peers.size,
      latestBlock: {
        index: latest.index,
        hash: latest.hash,
        timestamp: latest.timestamp,
        transactions: latest.transactions.length
      },
      valid: c.isValid()
    };
  }

  _getBlocks(limit, offset) {
    const chain = this.chain.chain;
    const total = chain.length;
    const slice = chain.slice(offset, offset + limit).map(b => this._blockSummary(b));
    return { blocks: slice, total, offset, limit };
  }

  _blockToJSON(block) {
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

  _blockSummary(block) {
    const coinbase = block.transactions[0];
    return {
      index: block.index,
      hash: block.hash,
      timestamp: block.timestamp,
      difficulty: block.difficulty,
      txCount: block.transactions.length,
      reward: coinbase ? coinbase.amount : 0
    };
  }

  _getMempool() {
    const txs = [];
    for (const tx of this.node.mempool.values()) {
      txs.push({
        hash: tx.hash(),
        from: tx.from,
        to: tx.to,
        amount: tx.amount,
        fee: tx.fee
      });
    }
    return { count: txs.length, transactions: txs };
  }

  _sendTx(body) {
    const { privateKey, publicKey, to, amount, fee } = body;
    if (!privateKey || !publicKey || !to || !amount) {
      throw new Error('Required: privateKey, publicKey, to, amount');
    }
    const txAmount = parseInt(amount);
    if (isNaN(txAmount) || txAmount < 1) {
      throw new Error('Amount must be a positive integer');
    }
    const tx = this.chain.createTransaction(
      privateKey, publicKey, to, txAmount, parseInt(fee) || 0
    );
    this.node.mempool.set(tx.hash(), tx);
    this.node._broadcast('NEW_TX', tx.toBase64());
    return { hash: tx.hash(), from: tx.from, to: tx.to, amount: tx.amount, fee: tx.fee };
  }
}

module.exports = ApiServer;

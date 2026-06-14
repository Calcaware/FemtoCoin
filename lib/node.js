const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const Peer = require('./peer');
const Transaction = require('./transaction');
const Block = require('./block');

const RECONNECT_INTERVAL = 10000;

const DEFAULT_BOOTSTRAP = [
  { host: 'seed.femtochain.io', port: 3000 },
  { host: 'seed2.femtochain.io', port: 3000 },
];

class Node {
  constructor(port, chain, dataDir = './data', bootstrap = []) {
    this.port = port;
    this.chain = chain;
    this.dataDir = dataDir;
    this.peersPath = path.join(dataDir, 'peers.json');
    this.bootstrap = bootstrap.length > 0 ? bootstrap : DEFAULT_BOOTSTRAP;
    this.peers = new Map();
    this.mempool = new Map();
    this.server = null;
    this.running = false;

    this.chain.on('block', (block) => {
      this._removeMempoolTransactions(block);
      this._broadcast('NEW_BLOCK', block.toBase64());
    });

    this.chain.on('chain-replaced', () => {
      this.mempool.clear();
    });
  }

  start() {
    this.running = true;

    this.server = new WebSocket.Server({ port: this.port });
    this.server.on('connection', (ws, req) => this._onConnection(ws, req));

    this._connectToKnownPeers();
    this._bootstrapIfNeeded();
    this._startMaintenance();
  }

  _bootstrapIfNeeded() {
    const known = this._loadKnownPeers();
    if (known.length > 0) return;
    for (const seed of this.bootstrap) {
      dns.lookup(seed.host, { all: true }, (err, addresses) => {
        if (err || !addresses) {
          this._connectToPeer(seed.host, seed.port);
          return;
        }
        for (const addr of addresses) {
          this._connectToPeer(addr.address, seed.port);
        }
      });
    }
  }

  stop() {
    this.running = false;
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    if (this.server) this.server.close();
  }

  _onConnection(ws, req) {
    const host = req.socket.remoteAddress.replace(/^::ffff:/, '');
    const peer = new Peer(ws, { host, port: null });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        this._handleMessage(peer, msg);
      } catch (_) {}
    });

    ws.on('close', () => {
      peer.connected = false;
      this.peers.delete(peer.id);
    });

    ws.on('error', () => {
      peer.close();
      this.peers.delete(peer.id);
    });

    this.peers.set(peer.id, peer);
    this._sendHandshake(peer);
  }

  _sendHandshake(peer) {
    peer.send('HANDSHAKE', {
      port: this.port,
      height: this.chain.getBlockCount(),
      latestHash: this.chain.getLatestBlock().hash
    });
  }

  _handleMessage(peer, msg) {
    switch (msg.type) {
      case 'HANDSHAKE':
        this._onHandshake(peer, msg.data);
        break;
      case 'NEW_TX':
        this._onNewTx(peer, msg.data);
        break;
      case 'NEW_BLOCK':
        this._onNewBlock(peer, msg.data);
        break;
      case 'GET_CHAIN':
        peer.send('CHAIN', this.chain.chain.map(b => b.toBase64()));
        break;
      case 'CHAIN':
        this._onChain(peer, msg.data);
        break;
      case 'GET_PEERS':
        peer.send('PEERS', { peers: this._getKnownPeers() });
        break;
      case 'PEERS':
        this._onPeers(msg.data);
        break;
    }
  }

  _onHandshake(peer, data) {
    peer.port = data.port;
    peer.height = data.height;
    peer.latestHash = data.latestHash;

    if (data.height > this.chain.getBlockCount()) {
      peer.send('GET_CHAIN');
    }

    peer.send('GET_PEERS');
    this._saveKnownPeers();
  }

  _onNewTx(peer, data) {
    const tx = Transaction.decode(data);
    if (this.mempool.has(tx.hash())) return;
    if (this._isTxInChain(tx)) return;
    if (!tx.isValid()) return;

    this.mempool.set(tx.hash(), tx);
    this._broadcast('NEW_TX', data, peer);
  }

  _isTxInChain(tx) {
    const hash = tx.hash();
    for (const block of this.chain.chain) {
      for (const bt of block.transactions) {
        if (!bt.isCoinbase() && bt.hash() === hash) return true;
      }
    }
    return false;
  }

  _onNewBlock(peer, data) {
    const block = Block.decode(data);

    if (block.index <= this.chain.getBlockCount() &&
        this.chain.chain[block.index] &&
        this.chain.chain[block.index].hash === block.hash) {
      return;
    }

    if (block.previousHash === this.chain.getLatestBlock().hash) {
      this.chain.addBlock(block);
    } else if (block.index > this.chain.getBlockCount()) {
      peer.send('GET_CHAIN');
    }
  }

  _onChain(peer, data) {
    const list = Array.isArray(data) ? data : (typeof data === 'string' ? JSON.parse(data) : data.blocks);
    const newChain = list.map(b => Block.decode(b));
    if (newChain.length <= this.chain.getBlockCount()) return;
    this.chain.replaceChain(newChain);
  }

  _onPeers(data) {
    const list = data.peers || [];
    for (const p of list) {
      this._connectToPeer(p.host, p.port);
    }
    this._saveKnownPeers();
  }

  connectToPeer(host, port) {
    if (host === '127.0.0.1' || host === 'localhost') host = '127.0.0.1';
    if (host === '127.0.0.1' && port === this.port) return;
    for (const peer of this.peers.values()) {
      if (peer.host === host && peer.port === port) return;
    }
    this._connectToPeer(host, port);
  }

  _connectToPeer(host, port) {
    if (host === '127.0.0.1' || host === 'localhost') host = '127.0.0.1';
    if (host === '127.0.0.1' && port === this.port) return;
    for (const peer of this.peers.values()) {
      if (peer.host === host && peer.port === port) return;
    }
    const ws = new WebSocket(`ws://${host}:${port}`);

    ws.on('open', () => {
      const peer = new Peer(ws, { host, port });
      this.peers.set(peer.id, peer);
      this._sendHandshake(peer);
      this._saveKnownPeers();
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        this._handleMessage(
          [...this.peers.values()].find(p => p.ws === ws),
          msg
        );
      } catch (_) {}
    });

    ws.on('close', () => {
      const peer = [...this.peers.values()].find(p => p.ws === ws);
      if (peer) {
        peer.connected = false;
        this.peers.delete(peer.id);
      }
    });

    ws.on('error', () => {
      ws.close();
    });
  }

  _broadcast(type, data, excludePeer = null) {
    for (const peer of this.peers.values()) {
      if (peer !== excludePeer && peer.connected) {
        peer.send(type, data);
      }
    }
  }

  _removeMempoolTransactions(block) {
    for (const tx of block.transactions) {
      if (!tx.isCoinbase()) {
        this.mempool.delete(tx.hash());
      }
    }
  }

  _getKnownPeers() {
    const peers = [];
    for (const peer of this.peers.values()) {
      if (peer.host && peer.port) {
        peers.push({ host: peer.host, port: peer.port });
      }
    }
    return peers;
  }

  _saveKnownPeers() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.peersPath, JSON.stringify(this._getKnownPeers(), null, 2));
    } catch (_) {}
  }

  _loadKnownPeers() {
    try {
      if (fs.existsSync(this.peersPath)) {
        return JSON.parse(fs.readFileSync(this.peersPath, 'utf8'));
      }
    } catch (_) {}
    return [];
  }

  _connectToKnownPeers() {
    const peers = this._loadKnownPeers();
    for (const p of peers) {
      this._connectToPeer(p.host, p.port);
    }
  }

  _startMaintenance() {
    setInterval(() => {
      for (const peer of this.peers.values()) {
        if (!peer.connected) {
          this.peers.delete(peer.id);
          if (peer.host && peer.port) {
            this._connectToPeer(peer.host, peer.port);
          }
        }
      }
    }, RECONNECT_INTERVAL);
  }

  getPeerList() {
    const list = [];
    for (const peer of this.peers.values()) {
      list.push({
        id: peer.id,
        host: peer.host,
        port: peer.port,
        height: peer.height,
        connected: peer.connected
      });
    }
    return list;
  }

  getMempoolSize() {
    return this.mempool.size;
  }
}

module.exports = Node;

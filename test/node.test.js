const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Node = require('../lib/node');
const Peer = require('../lib/peer');
const Blockchain = require('../lib/chain');
const { generateKeypair, addressFromPublicKey } = require('../lib/crypto');
const Transaction = require('../lib/transaction');

function tempDir() {
  return path.join('/tmp', 'node-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

describe('Node', () => {
  let dir;
  let chain;
  let node;

  beforeEach(() => {
    dir = tempDir();
    fs.mkdirSync(dir, { recursive: true });
    chain = new Blockchain(dir);
    node = new Node(3100, chain, dir, []);
  });

  it('accepts valid transactions into the mempool', () => {
    const kp = generateKeypair();
    const tx = new Transaction(addressFromPublicKey(kp.publicKey), 'recipient', 10n, 1n, Date.now());
    tx.sign(kp.privateKey, kp.publicKey);

    node._onNewTx({ id: 'peer1' }, tx.toBase64());

    assert.strictEqual(node.mempool.size, 1);
    assert.ok(node.mempool.has(tx.hash()));
  });

  it('ignores invalid or duplicate transactions', () => {
    const kp = generateKeypair();
    const tx = new Transaction(addressFromPublicKey(kp.publicKey), 'recipient', 10n, 1n, Date.now());
    tx.sign(kp.privateKey, kp.publicKey);

    node._onNewTx({ id: 'peer1' }, tx.toBase64());
    node._onNewTx({ id: 'peer2' }, tx.toBase64());

    assert.strictEqual(node.mempool.size, 1);

    const badTx = new Transaction('from', 'to', 5n, 0n, Date.now());
    node._onNewTx({ id: 'peer3' }, badTx.toBase64());
    assert.strictEqual(node.mempool.size, 1);
  });

  it('stores peer metadata and exposes peer getters', () => {
    const ws = { readyState: 1, send: () => {}, close: () => {} };
    const peer = new Peer(ws, { host: '10.0.0.2', port: 3001 });
    node.peers.set(peer.id, peer);

    const list = node.getPeerList();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].host, '10.0.0.2');
    assert.strictEqual(list[0].port, 3001);
    assert.strictEqual(node.getMempoolSize(), 0);
  });

  it('rejects oversized chain payloads', () => {
    const peer = { send: () => {} };
    node.maxChainLength = 2;
    const payload = [
      { index: 0, previousHash: 'a', hash: 'b', difficulty: 1, nonce: 0, transactions: [] },
      { index: 1, previousHash: 'b', hash: 'c', difficulty: 1, nonce: 0, transactions: [] },
      { index: 2, previousHash: 'c', hash: 'd', difficulty: 1, nonce: 0, transactions: [] }
    ];

    node._onChain(peer, payload);
    assert.strictEqual(node.chain.getBlockCount(), 1);
  });

  it('ignores malformed peer messages', () => {
    node._handleMessage(null, null);
    node._handleMessage(null, { type: 'BAD_TYPE', data: {} });
    assert.strictEqual(node.peers.size, 0);
  });
});

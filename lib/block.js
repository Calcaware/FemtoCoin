const protobuf = require('protobufjs');
const path = require('path');
const { sha256b } = require('./crypto');
const Transaction = require('./transaction');
const { COIN } = require('./unit');

const root = protobuf.loadSync(path.join(__dirname, '..', 'proto', 'blockchain.proto'));
const BlockMessage = root.lookupType('femtochain.Block');

const MAX_BLOCK_SIZE = 1048576;

class Block {
  constructor(index, timestamp, transactions, previousHash, difficulty, nonce = 0) {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.difficulty = difficulty;
    this.nonce = nonce;
    this.hash = this.computeHash();
  }

  computeHash() {
    const msg = {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map(t => t instanceof Transaction ? t.toProtobuf() : t),
      previousHash: this.previousHash || '',
      difficulty: this.difficulty,
      nonce: this.nonce
    };
    return sha256b(BlockMessage.encode(msg).finish());
  }

  mine() {
    const target = '0'.repeat(this.difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.computeHash();
    }
  }

  async mineAsync(onProgress) {
    const target = '0'.repeat(this.difficulty);
    let hashes = 0;
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.computeHash();
      hashes++;
      if (hashes % 10000 === 0) {
        if (onProgress) onProgress(this.nonce, this.hash);
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }

  hasValidPoW() {
    return this.hash.startsWith('0'.repeat(this.difficulty));
  }

  exceedsSizeLimit() {
    return this.encode().length > MAX_BLOCK_SIZE;
  }

  toProtobuf() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map(t => t instanceof Transaction ? t.toProtobuf() : t),
      previousHash: this.previousHash || '',
      difficulty: this.difficulty,
      nonce: this.nonce,
      hash: this.hash || ''
    };
  }

  encode() {
    return BlockMessage.encode(this.toProtobuf()).finish();
  }

  toBase64() {
    return this.encode().toString('base64');
  }

  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map(t => t.toJSON()),
      previousHash: this.previousHash,
      difficulty: this.difficulty,
      nonce: this.nonce,
      hash: this.hash
    };
  }

  static decode(data) {
    const msg = BlockMessage.decode(data instanceof Buffer ? data : Buffer.from(data, 'base64'));
    return Block.fromProtobuf(msg);
  }

  static fromProtobuf(msg) {
    const txs = (msg.transactions || []).map(t => Transaction.fromProtobuf(t));
    const block = new Block(
      Number(msg.index),
      Number(msg.timestamp),
      txs,
      msg.previousHash || '0',
      msg.difficulty,
      Number(msg.nonce)
    );
    block.hash = msg.hash || block.hash;
    return block;
  }

  static fromJSON(json) {
    const txs = json.transactions.map(t => Transaction.fromJSON(t));
    const block = new Block(json.index, json.timestamp, txs, json.previousHash, json.difficulty, json.nonce);
    block.hash = json.hash;
    return block;
  }
}

Block.MAX_BLOCK_SIZE = MAX_BLOCK_SIZE;

module.exports = Block;

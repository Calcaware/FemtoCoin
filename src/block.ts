export {};

const protobuf = require('protobufjs');
const pathModule = require('path');
const { sha256b } = require('./crypto');
const TransactionModel = require('./transaction');

const root = protobuf.loadSync(pathModule.join(__dirname, '..', 'proto', 'blockchain.proto'));
const BlockMessage = root.lookupType('femtochain.Block');

const MAX_BLOCK_SIZE = 1048576;

class Block {
  index: number;
  timestamp: number;
  transactions: any[];
  previousHash: string;
  difficulty: number;
  nonce: number;
  hash: string;

  constructor(index: number, timestamp: number, transactions: any[], previousHash: string, difficulty: number, nonce = 0) {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.difficulty = difficulty;
    this.nonce = nonce;
    this.hash = this.computeHash();
  }

  computeHash(): string {
    const msg = {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map((t: any) => t instanceof TransactionModel ? t.toProtobuf() : t),
      previousHash: this.previousHash || '',
      difficulty: this.difficulty,
      nonce: this.nonce
    };
    return sha256b(BlockMessage.encode(msg).finish());
  }

  mine(): void {
    const target = '0'.repeat(this.difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.computeHash();
    }
  }

  async mineAsync(onProgress?: (nonce: number, hash: string) => void): Promise<void> {
    const target = '0'.repeat(this.difficulty);
    let hashes = 0;
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.computeHash();
      hashes++;
      if (hashes % 10000 === 0) {
        if (onProgress) onProgress(this.nonce, this.hash);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  hasValidPoW(): boolean {
    return this.hash.startsWith('0'.repeat(this.difficulty));
  }

  exceedsSizeLimit(): boolean {
    return this.encode().length > MAX_BLOCK_SIZE;
  }

  toProtobuf(): any {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map((t: any) => t instanceof TransactionModel ? t.toProtobuf() : t),
      previousHash: this.previousHash || '',
      difficulty: this.difficulty,
      nonce: this.nonce,
      hash: this.hash || ''
    };
  }

  encode(): Buffer {
    return BlockMessage.encode(this.toProtobuf()).finish();
  }

  toBase64(): string {
    return this.encode().toString('base64');
  }

  toJSON(): { index: number; timestamp: number; transactions: any[]; previousHash: string; difficulty: number; nonce: number; hash: string } {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map((t: any) => t.toJSON()),
      previousHash: this.previousHash,
      difficulty: this.difficulty,
      nonce: this.nonce,
      hash: this.hash
    };
  }

  static decode(data: Buffer | string): Block {
    const bytes = data instanceof Buffer ? data : Buffer.from(String(data), 'base64');
    const msg = BlockMessage.decode(bytes);
    return Block.fromProtobuf(msg);
  }

  static fromProtobuf(msg: any): Block {
    const txs = (msg.transactions || []).map((t: any) => TransactionModel.fromProtobuf(t));
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

  static fromJSON(json: any): Block {
    const txs = json.transactions.map((t: any) => TransactionModel.fromJSON(t));
    const block = new Block(json.index, json.timestamp, txs, json.previousHash, json.difficulty, json.nonce);
    block.hash = json.hash;
    return block;
  }
}

(Block as any).MAX_BLOCK_SIZE = MAX_BLOCK_SIZE;

module.exports = Block;

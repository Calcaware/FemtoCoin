export {};

const fs = require('fs');
const EventEmitter = require('events');
const BlockModel = require('./block');
const TransactionModel = require('./transaction');
const { addressFromPublicKey } = require('./crypto');
const { COIN } = require('./unit');

const HALVING_INTERVAL = 210000;
const DIFFICULTY_INTERVAL = 10;
const TARGET_BLOCK_TIME = 30000;
const INITIAL_DIFFICULTY = 4;

class Blockchain extends EventEmitter {
  dataDir: string;
  chainPath: string;
  chain: any[];
  state: Map<string, bigint>;

  constructor(dataDir = './data') {
    super();
    this.dataDir = dataDir;
    this.chainPath = `${dataDir}/chain.dat`;
    this.chain = [];
    this.state = new Map();
    this.loadChain();
  }

  loadChain(): void {
    if (fs.existsSync(this.chainPath)) {
      const raw = fs.readFileSync(this.chainPath);
      let offset = 0;
      while (offset + 4 <= raw.length) {
        const len = raw.readUInt32BE(offset);
        offset += 4;
        if (offset + len > raw.length) break;
        const block = BlockModel.decode(raw.subarray(offset, offset + len));
        this.chain.push(block);
        offset += len;
      }
    } else {
      this.chain = [this.createGenesisBlock()];
      this.saveChain();
    }
    this.rebuildState();
  }

  saveChain(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const buffers = this.chain.map((b: any) => b.encode());
    const header = Buffer.alloc(4);
    const chunks: Buffer[] = [];
    for (const buf of buffers) {
      header.writeUInt32BE(buf.length);
      chunks.push(Buffer.from(header), buf);
    }
    fs.writeFileSync(this.chainPath, Buffer.concat(chunks));
  }

  createGenesisBlock(): any {
    const tx = new TransactionModel('0', '0', 0n, 0n, 1700000000000);
    const block = new BlockModel(0, 1700000000000, [tx], '0', INITIAL_DIFFICULTY);
    block.mine();
    return block;
  }

  rebuildState(): void {
    this.state = new Map();
    for (const block of this.chain) {
      this._applyBlockTransactions(block);
    }
  }

  _applyBlockTransactions(block: any): void {
    for (const tx of block.transactions) {
      if (tx.isCoinbase()) {
        this.state.set(tx.to, (this.state.get(tx.to) || 0n) + tx.amount);
      } else {
        this.state.set(tx.from, (this.state.get(tx.from) || 0n) - tx.amount - tx.fee);
        this.state.set(tx.to, (this.state.get(tx.to) || 0n) + tx.amount);
      }
    }
  }

  getBalance(address: string): bigint {
    return this.state.get(address) || 0n;
  }

  getLatestBlock(): any {
    return this.chain[this.chain.length - 1];
  }

  getDifficulty(): number {
    const length = this.chain.length;
    if (length < DIFFICULTY_INTERVAL) return INITIAL_DIFFICULTY;
    if (length % DIFFICULTY_INTERVAL !== 0) return this.chain[length - 1].difficulty;

    const last = this.chain[length - 1];
    const prev = this.chain[length - DIFFICULTY_INTERVAL];
    const timeTaken = last.timestamp - prev.timestamp;
    const expected = TARGET_BLOCK_TIME * DIFFICULTY_INTERVAL;

    if (timeTaken < expected / 2) return last.difficulty + 1;
    if (timeTaken > expected * 2) return Math.max(1, last.difficulty - 1);
    return last.difficulty;
  }

  getBlockReward(): bigint {
    const halvings = Math.floor(this.chain.length / HALVING_INTERVAL);
    const reward = BigInt(50) * COIN;
    const shifted = reward >> BigInt(halvings);
    return shifted < COIN ? COIN : shifted;
  }

  addBlock(block: any): boolean {
    const latest = this.getLatestBlock();

    if (block.index !== latest.index + 1) return false;
    if (block.previousHash !== latest.hash) return false;
    if (block.hash !== block.computeHash()) return false;
    if (!block.hasValidPoW()) return false;
    if (block.difficulty !== this.getDifficulty()) return false;
    if (block.exceedsSizeLimit()) return false;

    const coinbase = block.transactions[0];
    if (!coinbase || !coinbase.isCoinbase()) return false;

    let totalFees = 0n;
    const tempState = new Map(this.state);

    for (let i = 1; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (!tx.isValid()) return false;

      if (tx.from === tx.to) return false;

      const senderBalance = tempState.get(tx.from) || 0n;
      if (senderBalance < tx.amount + tx.fee) return false;

      tempState.set(tx.from, senderBalance - tx.amount - tx.fee);
      tempState.set(tx.to, (tempState.get(tx.to) || 0n) + tx.amount);
      totalFees += tx.fee;
    }

    const expectedReward = this.getBlockReward() + totalFees;
    if (coinbase.amount !== expectedReward) return false;

    tempState.set(coinbase.to, (tempState.get(coinbase.to) || 0n) + coinbase.amount);

    this.chain.push(block);
    this.state = tempState;
    this._appendBlock(block);
    this.emit('block', block);
    return true;
  }

  _appendBlock(block: any): void {
    const buf = block.encode();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(buf.length);
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.appendFileSync(this.chainPath, Buffer.concat([header, buf]));
  }

  createBlock(minerAddress: string, transactions: any[] = []): any {
    const latest = this.getLatestBlock();
    const difficulty = this.getDifficulty();
    const reward = this.getBlockReward();

    const validTxs: any[] = [];
    const usedState = new Map(this.state);
    let totalFees = 0n;

    for (const tx of transactions) {
      if (!tx.isValid()) continue;
      const balance = usedState.get(tx.from) || 0n;
      if (balance >= tx.amount + tx.fee) {
        usedState.set(tx.from, balance - tx.amount - tx.fee);
        usedState.set(tx.to, (usedState.get(tx.to) || 0n) + tx.amount);
        totalFees += tx.fee;
        validTxs.push(tx);
      }
    }

    const coinbase = new TransactionModel('0', minerAddress, reward + totalFees, 0n, Date.now());
    return new BlockModel(
      latest.index + 1,
      Date.now(),
      [coinbase, ...validTxs],
      latest.hash,
      difficulty
    );
  }

  mineBlock(minerAddress: string, transactions: any[] = []): any {
    const block = this.createBlock(minerAddress, transactions);
    if (block.exceedsSizeLimit()) return null;
    block.mine();
    if (this.addBlock(block)) {
      return block;
    }
    return null;
  }

  createTransaction(senderPrivateKey: string, senderPublicKey: string, toAddress: string, amount: bigint | string | number, fee: bigint | string | number = 0n): any {
    const fromAddress = addressFromPublicKey(senderPublicKey);
    const balance = this.getBalance(fromAddress);
    const amountBI = BigInt(amount);
    const feeBI = BigInt(fee);
    if (balance < amountBI + feeBI) {
      throw new Error(`Insufficient balance: ${balance} < ${amountBI + feeBI}`);
    }
    if (fromAddress === toAddress) {
      throw new Error('Cannot send to self');
    }
    const tx = new TransactionModel(fromAddress, toAddress, amountBI, feeBI);
    tx.sign(senderPrivateKey, senderPublicKey);
    return tx;
  }

  replaceChain(newChain: any[]): boolean {
    if (newChain.length <= this.chain.length) return false;
    if (!this._validateChain(newChain)) return false;
    this.chain = newChain;
    this.rebuildState();
    this.saveChain();
    this.emit('chain-replaced', newChain);
    return true;
  }

  _validateChain(blocks: any[]): boolean {
    if (blocks.length === 0) return false;
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const prev = blocks[i - 1];
      if (block.previousHash !== prev.hash) return false;
      if (block.hash !== block.computeHash()) return false;
      if (!block.hasValidPoW()) return false;
    }
    return true;
  }

  isValid(): boolean {
    return this._validateChain(this.chain);
  }

  getSupply(): bigint {
    let total = 0n;
    for (const balance of this.state.values()) total += balance;
    return total;
  }

  getBlockCount(): number {
    return this.chain.length;
  }
}

module.exports = Blockchain;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Blockchain = require('../lib/chain');
const Transaction = require('../lib/transaction');
const Block = require('../lib/block');
const crypto = require('../lib/crypto');
const { COIN } = require('../lib/unit');

function tempDir() {
  return path.join('/tmp', 'chain-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

function quickMine(block) {
  while (!block.hash.startsWith('0'.repeat(block.difficulty))) {
    block.nonce++;
    block.hash = block.computeHash();
  }
}

describe('Blockchain', () => {
  describe('genesis', () => {
    it('creates genesis block on fresh chain', () => {
      const dir = tempDir();
      const chain = new Blockchain(dir);
      assert.strictEqual(chain.getBlockCount(), 1);
      assert.strictEqual(chain.chain[0].index, 0);
      assert.ok(chain.isValid());
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('genesis block has 0 reward', () => {
      const dir = tempDir();
      const chain = new Blockchain(dir);
      assert.strictEqual(chain.chain[0].transactions[0].amount, 0n);
      assert.strictEqual(chain.getSupply(), 0n);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('getLatestBlock returns last block', () => {
      const dir = tempDir();
      const chain = new Blockchain(dir);
      assert.strictEqual(chain.getLatestBlock().index, 0);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('mining', () => {
    it('mineBlock creates and adds a valid block', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      const block = chain.mineBlock(addr);
      assert.ok(block);
      assert.strictEqual(block.index, 1);
      assert.strictEqual(chain.getBlockCount(), 2);
      assert.strictEqual(chain.getBalance(addr), 50n * COIN);
      assert.ok(chain.isValid());
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('mineBlock returns null when block fails validation', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      assert.ok(chain.mineBlock(addr));

      const block2 = chain.createBlock(addr);
      block2.index = 1;
      quickMine(block2);
      assert.strictEqual(chain.addBlock(block2), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('processes multiple blocks and tracks balances', () => {
      const dir = tempDir();
      const kp1 = crypto.generateKeypair();
      const kp2 = crypto.generateKeypair();
      const addr1 = crypto.addressFromPublicKey(kp1.publicKey);
      const addr2 = crypto.addressFromPublicKey(kp2.publicKey);
      const chain = new Blockchain(dir);

      chain.mineBlock(addr1);
      assert.strictEqual(chain.getBalance(addr1), 50n * COIN);

      chain.mineBlock(addr2);
      assert.strictEqual(chain.getBalance(addr1), 50n * COIN);
      assert.strictEqual(chain.getBalance(addr2), 50n * COIN);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('validation', () => {
    it('rejects block with wrong previousHash', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      const bad = chain.createBlock(addr);
      bad.previousHash = 'wrong';
      quickMine(bad);
      assert.strictEqual(chain.addBlock(bad), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects block with invalid hash (tampered)', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      const bad = chain.createBlock(addr);
      quickMine(bad);
      bad.hash = '0000000000000000000000000000000000000000000000000000000000000000';
      assert.strictEqual(chain.addBlock(bad), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects block with invalid coinbase amount', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      const bad = chain.createBlock(addr);
      bad.transactions[0].amount = 999n;
      quickMine(bad);
      assert.strictEqual(chain.addBlock(bad), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects block with unsigned non-coinbase transaction', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      chain.mineBlock(addr);
      const latest = chain.getLatestBlock();
      const unsignedTx = new Transaction(addr, 'victim', 10n, 0n);
      const block = new Block(2, Date.now(), [
        new Transaction('0', addr, 50n * COIN, 0n, Date.now()),
        unsignedTx
      ], latest.hash, chain.getDifficulty());
      quickMine(block);
      assert.strictEqual(chain.addBlock(block), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects block with no coinbase', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      const latest = chain.getLatestBlock();
      const bad = new Block(1, Date.now(), [], latest.hash, chain.getDifficulty());
      quickMine(bad);
      assert.strictEqual(chain.addBlock(bad), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('transactions', () => {
    it('sends coins between addresses', () => {
      const dir = tempDir();
      const kp1 = crypto.generateKeypair();
      const kp2 = crypto.generateKeypair();
      const addr1 = crypto.addressFromPublicKey(kp1.publicKey);
      const addr2 = crypto.addressFromPublicKey(kp2.publicKey);
      const chain = new Blockchain(dir);
      chain.mineBlock(addr1);

      const tx = chain.createTransaction(kp1.privateKey, kp1.publicKey, addr2, 30n * COIN);
      assert.ok(tx);
      chain.mineBlock(addr1, [tx]);
      assert.strictEqual(chain.getBalance(addr1), 70n * COIN);
      assert.strictEqual(chain.getBalance(addr2), 30n * COIN);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects send with insufficient balance', () => {
      const dir = tempDir();
      const kp1 = crypto.generateKeypair();
      const kp2 = crypto.generateKeypair();
      const addr1 = crypto.addressFromPublicKey(kp1.publicKey);
      const addr2 = crypto.addressFromPublicKey(kp2.publicKey);
      const chain = new Blockchain(dir);

      assert.throws(() => {
        chain.createTransaction(kp1.privateKey, kp1.publicKey, addr2, 999n * COIN);
      }, /Insufficient balance/);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects send to self', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      chain.mineBlock(addr);

      assert.throws(() => {
        chain.createTransaction(kp.privateKey, kp.publicKey, addr, 10n * COIN);
      }, /Cannot send to self/);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('chain replacement', () => {
    it('replaceChain accepts longer valid chain', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);

      const chain = new Blockchain(dir);
      chain.mineBlock(addr);

      const next = chain.createBlock(addr);
      quickMine(next);
      assert.ok(chain.replaceChain([chain.chain[0], chain.chain[1], next]));
      assert.strictEqual(chain.getBlockCount(), 3);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('replaceChain rejects shorter chain', () => {
      const dir = tempDir();
      const chain = new Blockchain(dir);
      assert.strictEqual(chain.replaceChain([]), false);
      assert.strictEqual(chain.replaceChain([chain.chain[0]]), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('replaceChain emits chain-replaced event', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);
      chain.mineBlock(addr);

      let emitted = false;
      chain.on('chain-replaced', () => { emitted = true; });
      const next = chain.createBlock(addr);
      quickMine(next);
      chain.replaceChain([chain.chain[0], chain.chain[1], next]);
      assert.ok(emitted);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('persistence', () => {
    it('persists chain to disk and reloads', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);

      const chain1 = new Blockchain(dir);
      chain1.mineBlock(addr);
      chain1.mineBlock(addr);
      assert.strictEqual(chain1.getBlockCount(), 3);

      const chain2 = new Blockchain(dir);
      assert.strictEqual(chain2.getBlockCount(), 3);
      assert.strictEqual(chain2.chain[0].hash, chain1.chain[0].hash);
      assert.strictEqual(chain2.chain[1].hash, chain1.chain[1].hash);
      assert.strictEqual(chain2.chain[2].hash, chain1.chain[2].hash);
      assert.ok(chain2.isValid());

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('persisted chain maintains balances', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);

      const chain1 = new Blockchain(dir);
      chain1.mineBlock(addr);
      chain1.mineBlock(addr);
      assert.strictEqual(chain1.getBalance(addr), 100n * COIN);

      const chain2 = new Blockchain(dir);
      assert.strictEqual(chain2.getBalance(addr), 100n * COIN);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('supply', () => {
    it('getSupply tracks total minted coins', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);

      const chain = new Blockchain(dir);
      assert.strictEqual(chain.getSupply(), 0n);
      chain.mineBlock(addr);
      assert.strictEqual(chain.getSupply(), 50n * COIN);
      chain.mineBlock(addr);
      assert.strictEqual(chain.getSupply(), 100n * COIN);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('events', () => {
    it('emits block event when block is added', () => {
      const dir = tempDir();
      const kp = crypto.generateKeypair();
      const addr = crypto.addressFromPublicKey(kp.publicKey);
      const chain = new Blockchain(dir);

      let emitted = null;
      chain.on('block', (b) => { emitted = b; });
      chain.mineBlock(addr);
      assert.ok(emitted);
      assert.strictEqual(emitted.index, 1);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('difficulty and reward', () => {
    it('getBlockReward returns 50 FTM for early blocks', () => {
      const dir = tempDir();
      const chain = new Blockchain(dir);
      assert.strictEqual(chain.getBlockReward(), 50n * COIN);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('getDifficulty returns 4 for fresh chain', () => {
      const dir = tempDir();
      const chain = new Blockchain(dir);
      assert.strictEqual(chain.getDifficulty(), 4);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});

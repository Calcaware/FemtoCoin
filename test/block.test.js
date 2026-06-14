const { describe, it } = require('node:test');
const assert = require('node:assert');
const Block = require('../lib/block');
const Transaction = require('../lib/transaction');

describe('Block', () => {
  const dummyTx = new Transaction('0', 'miner', 50n, 0n, 1000);

  it('creates a block with correct fields', () => {
    const block = new Block(1, 2000, [dummyTx], 'abc', 0, 0);
    assert.strictEqual(block.index, 1);
    assert.strictEqual(block.timestamp, 2000);
    assert.strictEqual(block.transactions.length, 1);
    assert.strictEqual(block.transactions[0], dummyTx);
    assert.strictEqual(block.previousHash, 'abc');
    assert.strictEqual(block.difficulty, 0);
    assert.strictEqual(block.nonce, 0);
  });

  it('computeHash returns a 64-char hex string', () => {
    const block = new Block(0, 1000, [dummyTx], '0', 0, 0);
    assert.strictEqual(block.computeHash().length, 64);
    assert.match(block.computeHash(), /^[0-9a-f]+$/);
  });

  it('computeHash is deterministic', () => {
    const block = new Block(0, 1000, [dummyTx], '0', 0, 0);
    assert.strictEqual(block.computeHash(), block.computeHash());
  });

  it('hash changes when nonce changes', () => {
    const a = new Block(0, 1000, [dummyTx], '0', 0, 0);
    const b = new Block(0, 1000, [dummyTx], '0', 0, 1);
    assert.notStrictEqual(a.hash, b.hash);
  });

  it('hash changes when index changes', () => {
    const a = new Block(0, 1000, [dummyTx], '0', 0, 0);
    const b = new Block(1, 1000, [dummyTx], '0', 0, 0);
    assert.notStrictEqual(a.hash, b.hash);
  });

  it('mine finds a valid nonce for difficulty 2', () => {
    const block = new Block(1, 2000, [dummyTx], '0'.repeat(64), 2, 0);
    block.mine();
    assert.ok(block.hash.startsWith('00'));
    assert.ok(block.nonce > 0);
  });

  it('mine for difficulty 0 is instant (nonce 0)', () => {
    const block = new Block(1, 2000, [dummyTx], '0'.repeat(64), 0, 0);
    block.mine();
    assert.strictEqual(block.nonce, 0);
  });

  it('hasValidPoW returns true for valid hash', () => {
    const block = new Block(1, 2000, [dummyTx], '0'.repeat(64), 0, 0);
    block.hash = '00abc';
    block.difficulty = 0;
    assert.ok(block.hasValidPoW());
  });

  it('hasValidPoW returns false for invalid hash', () => {
    const block = new Block(1, 2000, [dummyTx], '0'.repeat(64), 2, 0);
    block.hash = 'ff0000';
    block.difficulty = 2;
    assert.strictEqual(block.hasValidPoW(), false);
  });

  it('encode produces a Buffer', () => {
    const block = new Block(0, 1000, [dummyTx], '0', 0, 0);
    const buf = block.encode();
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
  });

  it('protobuf roundtrip preserves all fields', () => {
    const tx1 = new Transaction('a', 'b', 100n, 0n, 1000);
    const block1 = new Block(5, 5000, [dummyTx, tx1], 'prevhash', 3, 42);
    block1.hash = block1.computeHash();
    const buf = block1.encode();
    const block2 = Block.decode(buf);
    assert.strictEqual(block2.index, block1.index);
    assert.strictEqual(block2.timestamp, block1.timestamp);
    assert.strictEqual(block2.previousHash, block1.previousHash);
    assert.strictEqual(block2.difficulty, block1.difficulty);
    assert.strictEqual(block2.nonce, block1.nonce);
    assert.strictEqual(block2.hash, block1.hash);
    assert.strictEqual(block2.transactions.length, 2);
    assert.strictEqual(block2.transactions[1].from, 'a');
    assert.strictEqual(block2.transactions[1].amount, 100n);
  });

  it('toBase64 roundtrip preserves hash', () => {
    const block1 = new Block(2, 3000, [dummyTx], 'prev', 1, 10);
    block1.hash = block1.computeHash();
    const b64 = block1.toBase64();
    const block2 = Block.decode(b64);
    assert.strictEqual(block2.hash, block1.hash);
  });

  it('exceedsSizeLimit returns false for small block', () => {
    const block = new Block(0, 1000, [dummyTx], '0', 0, 0);
    assert.strictEqual(block.exceedsSizeLimit(), false);
  });

  it('exceedsSizeLimit returns true when block exceeds 1MB', () => {
    const manyTxs = [];
    for (let i = 0; i < 12000; i++) {
      manyTxs.push(new Transaction('0'.repeat(40), 'a'.repeat(40), 1n, 0n, Date.now()));
    }
    const block = new Block(1, Date.now(), manyTxs, '0'.repeat(64), 4, 0);
    assert.ok(block.encode().length > Block.MAX_BLOCK_SIZE);
    assert.ok(block.exceedsSizeLimit());
  });

  it('fromJSON roundtrip preserves fields', () => {
    const tx = new Transaction('from', 'to', 75n, 1n, 2000);
    const block1 = new Block(3, 4000, [dummyTx, tx], 'prev', 2, 99);
    block1.hash = block1.computeHash();
    const json = block1.toJSON();
    const block2 = Block.fromJSON(json);
    assert.strictEqual(block2.index, block1.index);
    assert.strictEqual(block2.hash, block1.hash);
    assert.strictEqual(block2.transactions.length, 2);
  });

  it('MAX_BLOCK_SIZE is exported', () => {
    assert.strictEqual(Block.MAX_BLOCK_SIZE, 1048576);
  });
});

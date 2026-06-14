const { describe, it } = require('node:test');
const assert = require('node:assert');
const Transaction = require('../lib/transaction');
const crypto = require('../lib/crypto');

describe('Transaction', () => {
  it('creates a basic transaction', () => {
    const tx = new Transaction('alice', 'bob', 100n, 5n, 1000);
    assert.strictEqual(tx.from, 'alice');
    assert.strictEqual(tx.to, 'bob');
    assert.strictEqual(tx.amount, 100n);
    assert.strictEqual(tx.fee, 5n);
    assert.strictEqual(tx.timestamp, 1000);
  });

  it('defaults fee to 0 and timestamp to Date.now()', () => {
    const before = Date.now();
    const tx = new Transaction('a', 'b', 50n);
    const after = Date.now();
    assert.strictEqual(tx.fee, 0n);
    assert.ok(tx.timestamp >= before && tx.timestamp <= after);
  });

  it('isCoinbase returns true for coinbase tx', () => {
    const tx = new Transaction('0', 'addr', 50n, 0n, 1000);
    assert.ok(tx.isCoinbase());
  });

  it('isCoinbase returns false for normal tx', () => {
    const tx = new Transaction('addr1', 'addr2', 50n, 0n, 1000);
    assert.strictEqual(tx.isCoinbase(), false);
  });

  it('coinbase tx is valid without signature', () => {
    const tx = new Transaction('0', 'addr', 50n, 0n, 1000);
    assert.ok(tx.isValid());
  });

  it('non-coinbase tx without signature is invalid', () => {
    const tx = new Transaction('addr1', 'addr2', 50n);
    assert.strictEqual(tx.isValid(), false);
  });

  it('produces a deterministic 64-char hex hash', () => {
    const tx = new Transaction('a', 'b', 100n, 0n, 1000);
    const h = tx.hash();
    assert.strictEqual(h.length, 64);
    assert.match(h, /^[0-9a-f]+$/);
    assert.strictEqual(tx.hash(), h);
  });

  it('different transactions have different hashes', () => {
    const h1 = new Transaction('a', 'b', 100n, 0n, 1000).hash();
    const h2 = new Transaction('a', 'b', 101n, 0n, 1000).hash();
    assert.notStrictEqual(h1, h2);
  });

  it('sign and validation works', () => {
    const kp = crypto.generateKeypair();
    const from = crypto.addressFromPublicKey(kp.publicKey);
    const tx = new Transaction(from, 'recipient', 50n, 1n);
    tx.sign(kp.privateKey, kp.publicKey);
    assert.ok(tx.signature);
    assert.ok(tx.publicKey);
    assert.ok(tx.isValid());
  });

  it('signature from wrong key fails validation', () => {
    const kp1 = crypto.generateKeypair();
    const kp2 = crypto.generateKeypair();
    const from = crypto.addressFromPublicKey(kp1.publicKey);
    const tx = new Transaction(from, 'recipient', 50n, 1n);
    tx.sign(kp2.privateKey, kp2.publicKey);
    assert.strictEqual(tx.isValid(), false);
  });

  it('sign then tamper amount fails validation', () => {
    const kp = crypto.generateKeypair();
    const from = crypto.addressFromPublicKey(kp.publicKey);
    const tx = new Transaction(from, 'recipient', 50n, 1n);
    tx.sign(kp.privateKey, kp.publicKey);
    assert.ok(tx.isValid());
    tx.amount = 999n;
    assert.strictEqual(tx.isValid(), false);
  });

  it('encode produces a Buffer', () => {
    const tx = new Transaction('a', 'b', 100n, 0n, 1000);
    const buf = tx.encode();
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
  });

  it('protobuf roundtrip preserves all fields', () => {
    const kp = crypto.generateKeypair();
    const from = crypto.addressFromPublicKey(kp.publicKey);
    const tx1 = new Transaction(from, 'recipient', 100n, 5n, 12345);
    tx1.sign(kp.privateKey, kp.publicKey);
    const buf = tx1.encode();
    const tx2 = Transaction.decode(buf);
    assert.strictEqual(tx2.from, tx1.from);
    assert.strictEqual(tx2.to, tx1.to);
    assert.strictEqual(tx2.amount, tx1.amount);
    assert.strictEqual(tx2.fee, tx1.fee);
    assert.strictEqual(tx2.timestamp, tx1.timestamp);
    assert.strictEqual(tx2.publicKey, tx1.publicKey);
    assert.strictEqual(tx2.signature, tx1.signature);
  });

  it('toBase64 roundtrip preserves hash', () => {
    const kp = crypto.generateKeypair();
    const from = crypto.addressFromPublicKey(kp.publicKey);
    const tx1 = new Transaction(from, 'recipient', 100n, 0n, 12345);
    tx1.sign(kp.privateKey, kp.publicKey);
    const h1 = tx1.hash();
    const b64 = tx1.toBase64();
    const tx2 = Transaction.decode(b64);
    assert.strictEqual(tx2.hash(), h1);
  });

  it('fromJSON roundtrip preserves fields', () => {
    const tx1 = new Transaction('addr', 'recipient', 50n, 2n, 999);
    const json = tx1.toJSON();
    const tx2 = Transaction.fromJSON(json);
    assert.strictEqual(tx2.from, tx1.from);
    assert.strictEqual(tx2.to, tx1.to);
    assert.strictEqual(tx2.amount, tx1.amount);
    assert.strictEqual(tx2.fee, tx1.fee);
    assert.strictEqual(tx2.timestamp, tx1.timestamp);
  });

  it('decode accepts both Buffer and base64 string', () => {
    const tx1 = new Transaction('a', 'b', 1n, 0n, 1000);
    const buf = tx1.encode();
    const b64 = tx1.toBase64();
    const fromBuf = Transaction.decode(buf);
    const fromB64 = Transaction.decode(b64);
    assert.strictEqual(fromBuf.hash(), fromB64.hash());
  });
});

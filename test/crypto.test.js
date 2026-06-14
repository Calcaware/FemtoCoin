const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('../lib/crypto');

describe('crypto', () => {
  it('sha256 returns a 64-character hex string', () => {
    const hash = crypto.sha256('hello');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it('sha256 is deterministic', () => {
    assert.strictEqual(crypto.sha256('hello'), crypto.sha256('hello'));
  });

  it('sha256b returns 64-character hex string from Buffer', () => {
    const hash = crypto.sha256b(Buffer.from('hello'));
    assert.strictEqual(hash.length, 64);
  });

  it('sha256b matches sha256 for string input', () => {
    const buf = Buffer.from('hello');
    assert.strictEqual(crypto.sha256b(buf), crypto.sha256('hello'));
  });

  it('generateKeypair produces PEM-encoded keys', () => {
    const kp = crypto.generateKeypair();
    assert.ok(kp.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'));
    assert.ok(kp.privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
  });

  it('generateKeypair produces unique keys each time', () => {
    const a = crypto.generateKeypair();
    const b = crypto.generateKeypair();
    assert.notStrictEqual(a.publicKey, b.publicKey);
  });

  it('addressFromPublicKey returns first 40 chars of sha256', () => {
    const kp = crypto.generateKeypair();
    const addr = crypto.addressFromPublicKey(kp.publicKey);
    assert.strictEqual(addr.length, 40);
    assert.match(addr, /^[0-9a-f]+$/);
    assert.strictEqual(addr, crypto.sha256(kp.publicKey).slice(0, 40));
  });

  it('sign and verify work with valid keypair', () => {
    const kp = crypto.generateKeypair();
    const data = 'hello world';
    const sig = crypto.sign(data, kp.privateKey);
    assert.strictEqual(sig.length, 128);
    assert.match(sig, /^[0-9a-f]+$/);
    assert.ok(crypto.verify(data, sig, kp.publicKey));
  });

  it('verify rejects signature from wrong key', () => {
    const kp1 = crypto.generateKeypair();
    const kp2 = crypto.generateKeypair();
    const sig = crypto.sign('hello', kp1.privateKey);
    assert.strictEqual(crypto.verify('hello', sig, kp2.publicKey), false);
  });

  it('verify rejects tampered data', () => {
    const kp = crypto.generateKeypair();
    const sig = crypto.sign('hello', kp.privateKey);
    assert.strictEqual(crypto.verify('HELLO', sig, kp.publicKey), false);
  });

  it('sign/verify roundtrip with binary data', () => {
    const kp = crypto.generateKeypair();
    const buf = Buffer.from([0, 1, 2, 3, 255]);
    const sig = crypto.sign(buf.toString('hex'), kp.privateKey);
    assert.ok(crypto.verify(buf.toString('hex'), sig, kp.publicKey));
  });
});

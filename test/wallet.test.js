const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Wallet } = require('../lib/wallet');

function tempDir() {
  return path.join('/tmp', 'wallet-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

describe('Wallet', () => {
  it('createNew generates keypair and address', () => {
    const wallet = new Wallet();
    wallet.createNew();
    assert.ok(wallet.keypair);
    assert.ok(wallet.keypair.publicKey);
    assert.ok(wallet.keypair.privateKey);
    assert.ok(wallet.address);
    assert.strictEqual(wallet.address.length, 40);
  });

  it('save and load roundtrip preserves keys', () => {
    const dir = tempDir();
    const w1 = new Wallet(dir);
    w1.createNew();
    const addr = w1.address;
    const pk = w1.keypair.publicKey;
    w1.save('testwallet');

    const w2 = new Wallet(dir);
    w2.load('testwallet');
    assert.strictEqual(w2.address, addr);
    assert.strictEqual(w2.keypair.publicKey, pk);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('load throws for non-existent wallet', () => {
    const wallet = new Wallet(tempDir());
    assert.throws(() => wallet.load('nonexistent'), /Wallet not found/);
  });

  it('saveEncrypted and load with password roundtrip', () => {
    const dir = tempDir();
    const w1 = new Wallet(dir);
    w1.createNew();
    const addr = w1.address;
    const pk = w1.keypair.publicKey;
    const sk = w1.keypair.privateKey;
    w1.saveEncrypted('encwallet', 'correct-password');

    const w2 = new Wallet(dir);
    w2.load('encwallet', 'correct-password');
    assert.strictEqual(w2.address, addr);
    assert.strictEqual(w2.keypair.publicKey, pk);
    assert.strictEqual(w2.keypair.privateKey, sk);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encrypted wallet rejects wrong password', () => {
    const dir = tempDir();
    const w1 = new Wallet(dir);
    w1.createNew();
    w1.saveEncrypted('encwallet', 'correct');

    const w2 = new Wallet(dir);
    assert.throws(() => {
      w2.load('encwallet', 'wrong');
    });

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encrypted wallet rejects empty password', () => {
    const dir = tempDir();
    const w1 = new Wallet(dir);
    w1.createNew();
    w1.saveEncrypted('encwallet', 'password');

    const w2 = new Wallet(dir);
    assert.throws(() => {
      w2.load('encwallet', '');
    });

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('isEncrypted returns true for encrypted wallets', () => {
    const dir = tempDir();
    const w = new Wallet(dir);
    w.createNew();
    w.saveEncrypted('enc', 'pass');
    assert.ok(w.isEncrypted('enc'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('isEncrypted returns false for plain wallets', () => {
    const dir = tempDir();
    const w = new Wallet(dir);
    w.createNew();
    w.save('plain');
    assert.strictEqual(w.isEncrypted('plain'), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('isEncrypted returns false for missing wallet', () => {
    const w = new Wallet('/nonexistent');
    assert.strictEqual(w.isEncrypted('missing'), false);
  });

  it('multiple encrypted wallets use different salts', () => {
    const dir = tempDir();
    const w1 = new Wallet(dir);
    w1.createNew();
    w1.saveEncrypted('a', 'same');

    const w2 = new Wallet(dir);
    w2.createNew();
    w2.saveEncrypted('b', 'same');

    const contentA = JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8'));
    const contentB = JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8'));
    assert.notStrictEqual(contentA.crypto.kdfparams.salt, contentB.crypto.kdfparams.salt);
    assert.notStrictEqual(contentA.crypto.cipherparams.iv, contentB.crypto.cipherparams.iv);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('static loadFromFile loads wallet by path', () => {
    const dir = tempDir();
    const w1 = new Wallet(dir);
    w1.createNew();
    const addr = w1.address;
    w1.save('static_test');

    const w2 = Wallet.loadFromFile(path.join(dir, 'static_test.json'));
    assert.strictEqual(w2.address, addr);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('wallet address matches addressFromPublicKey', () => {
    const { addressFromPublicKey } = require('../lib/crypto');
    const wallet = new Wallet();
    wallet.createNew();
    assert.strictEqual(
      wallet.address,
      addressFromPublicKey(wallet.keypair.publicKey)
    );
  });
});

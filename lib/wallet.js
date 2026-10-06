const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateKeypair, addressFromPublicKey } = require('./crypto');

const KDF_OPTS = { N: 16384, r: 8, p: 1, keylen: 32 };
const CIPHER = 'aes-256-gcm';
const SAFE_WALLET_NAME = /^[A-Za-z0-9._-]+$/;

function validateWalletName(name) {
  if (typeof name !== 'string') {
    throw new Error('Wallet name must be a string.');
  }

  const value = name.trim();
  if (!value || value.length > 64) {
    throw new Error('Wallet name must be 1-64 characters long.');
  }

  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error('Wallet name contains invalid path characters.');
  }

  if (!SAFE_WALLET_NAME.test(value)) {
    throw new Error('Wallet name may only contain letters, numbers, dot, underscore, and dash.');
  }

  return value;
}

class Wallet {
  constructor(walletDir = './wallets') {
    this.walletDir = walletDir;
    this.keypair = null;
    this.address = null;
  }

  createNew() {
    this.keypair = generateKeypair();
    this.address = addressFromPublicKey(this.keypair.publicKey);
    return this;
  }

  save(name) {
    const safeName = validateWalletName(name);
    fs.mkdirSync(this.walletDir, { recursive: true });
    const filePath = path.join(this.walletDir, `${safeName}.json`);
    const data = {
      address: this.address,
      publicKey: this.keypair.publicKey,
      privateKey: this.keypair.privateKey
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return filePath;
  }

  saveEncrypted(name, password) {
    const safeName = validateWalletName(name);
    fs.mkdirSync(this.walletDir, { recursive: true });
    const filePath = path.join(this.walletDir, `${safeName}.json`);

    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password is required for encrypted wallets.');
    }

    const salt = crypto.randomBytes(32).toString('hex');
    const key = crypto.scryptSync(password, salt, KDF_OPTS.keylen, KDF_OPTS);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CIPHER, key, iv);

    const plaintext = JSON.stringify({
      publicKey: this.keypair.publicKey,
      privateKey: this.keypair.privateKey
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);

    const keystore = {
      address: this.address,
      crypto: {
        cipher: CIPHER,
        cipherparams: {
          iv: iv.toString('hex'),
          tag: cipher.getAuthTag().toString('hex')
        },
        ciphertext: encrypted.toString('hex'),
        kdf: 'scrypt',
        kdfparams: {
          n: KDF_OPTS.N,
          r: KDF_OPTS.r,
          p: KDF_OPTS.p,
          keylen: KDF_OPTS.keylen,
          salt: salt
        }
      }
    };

    fs.writeFileSync(filePath, JSON.stringify(keystore, null, 2));
    return filePath;
  }

  load(name, password) {
    const safeName = validateWalletName(name);
    const filePath = path.join(this.walletDir, `${safeName}.json`);
    return this._loadFromPath(filePath, password);
  }

  _loadFromPath(filePath, password) {
    if (!fs.existsSync(filePath)) throw new Error(`Wallet not found: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (data.crypto) {
      return this._decryptKeystore(data, data.crypto, password);
    }

    this.address = data.address;
    this.keypair = {
      publicKey: data.publicKey,
      privateKey: data.privateKey
    };
    return this;
  }

  _decryptKeystore(data, cryptoData, password) {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password is required for encrypted wallets.');
    }

    const kdfp = cryptoData.kdfparams;
    const key = crypto.scryptSync(
      password,
      kdfp.salt,
      kdfp.keylen,
      { N: kdfp.n, r: kdfp.r, p: kdfp.p }
    );

    const decipher = crypto.createDecipheriv(
      cryptoData.cipher,
      key,
      Buffer.from(cryptoData.cipherparams.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(cryptoData.cipherparams.tag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cryptoData.ciphertext, 'hex')),
      decipher.final()
    ]);

    const parsed = JSON.parse(decrypted.toString('utf8'));
    this.address = data.address;
    this.keypair = {
      publicKey: parsed.publicKey,
      privateKey: parsed.privateKey
    };
    return this;
  }

  isEncrypted(name) {
    const safeName = validateWalletName(name);
    const filePath = path.join(this.walletDir, `${safeName}.json`);
    if (!fs.existsSync(filePath)) return false;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return !!data.crypto;
  }

  static validateName(name) {
    return validateWalletName(name);
  }

  static loadFromFile(filePath, password) {
    const wallet = new Wallet();
    return wallet._loadFromPath(filePath, password);
  }
}

module.exports = { Wallet, validateWalletName };

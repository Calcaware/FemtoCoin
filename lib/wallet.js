const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateKeypair, addressFromPublicKey } = require('./crypto');

const KDF_OPTS = { N: 16384, r: 8, p: 1, keylen: 32 };
const CIPHER = 'aes-256-gcm';

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
    fs.mkdirSync(this.walletDir, { recursive: true });
    const filePath = path.join(this.walletDir, `${name}.json`);
    const data = {
      address: this.address,
      publicKey: this.keypair.publicKey,
      privateKey: this.keypair.privateKey
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return filePath;
  }

  saveEncrypted(name, password) {
    fs.mkdirSync(this.walletDir, { recursive: true });
    const filePath = path.join(this.walletDir, `${name}.json`);

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
    const filePath = path.join(this.walletDir, `${name}.json`);
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
    const filePath = path.join(this.walletDir, `${name}.json`);
    if (!fs.existsSync(filePath)) return false;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return !!data.crypto;
  }

  static loadFromFile(filePath, password) {
    const wallet = new Wallet();
    return wallet._loadFromPath(filePath, password);
  }
}

module.exports = { Wallet };

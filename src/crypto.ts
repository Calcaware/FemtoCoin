export {};

const nodeCrypto = require('crypto');

function sha256(data: string | Buffer): string {
  return nodeCrypto.createHash('sha256').update(data).digest('hex');
}

function sha256b(data: string | Buffer): string {
  return nodeCrypto.createHash('sha256').update(data).digest('hex');
}

function generateKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}

function addressFromPublicKey(publicKey: string): string {
  return sha256(publicKey).slice(0, 40);
}

function sign(data: string | Buffer, privateKey: string): string {
  return nodeCrypto.sign(null, Buffer.from(data), privateKey).toString('hex');
}

function verify(data: string | Buffer, signature: string, publicKey: string): boolean {
  return nodeCrypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signature, 'hex'));
}

module.exports = { sha256, sha256b, generateKeypair, addressFromPublicKey, sign, verify };

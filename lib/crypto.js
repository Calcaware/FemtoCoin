const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha256b(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey, privateKey };
}

function addressFromPublicKey(publicKey) {
  return sha256(publicKey).slice(0, 40);
}

function sign(data, privateKey) {
  return crypto.sign(null, Buffer.from(data), privateKey).toString('hex');
}

function verify(data, signature, publicKey) {
  return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signature, 'hex'));
}

module.exports = { sha256, sha256b, generateKeypair, addressFromPublicKey, sign, verify };

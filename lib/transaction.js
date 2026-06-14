const protobuf = require('protobufjs');
const path = require('path');
const { sha256b, sign, verify, addressFromPublicKey } = require('./crypto');

const root = protobuf.loadSync(path.join(__dirname, '..', 'proto', 'blockchain.proto'));
const TxMessage = root.lookupType('femtochain.Transaction');

class Transaction {
  constructor(from, to, amount, fee = 0n, timestamp = Date.now()) {
    this.from = from;
    this.to = to;
    this.amount = BigInt(amount);
    this.fee = BigInt(fee);
    this.timestamp = timestamp;
    this.publicKey = null;
    this.signature = null;
  }

  hash() {
    const msg = {
      from: this.from || '',
      to: this.to || '',
      amount: this.amount.toString(),
      fee: this.fee.toString(),
      timestamp: this.timestamp
    };
    return sha256b(TxMessage.encode(msg).finish());
  }

  sign(privateKey, publicKey) {
    this.publicKey = publicKey;
    this.signature = sign(this.hash(), privateKey);
  }

  isValid() {
    if (this.isCoinbase()) return true;
    if (!this.signature || !this.publicKey) return false;
    if (addressFromPublicKey(this.publicKey) !== this.from) return false;
    return verify(this.hash(), this.signature, this.publicKey);
  }

  isCoinbase() {
    return this.from === '0' && this.publicKey === null && this.signature === null;
  }

  toProtobuf() {
    return {
      from: this.from || '',
      to: this.to || '',
      amount: this.amount.toString(),
      fee: this.fee.toString(),
      timestamp: this.timestamp,
      publicKey: this.publicKey || '',
      signature: this.signature || ''
    };
  }

  encode() {
    return TxMessage.encode(this.toProtobuf()).finish();
  }

  toBase64() {
    return this.encode().toString('base64');
  }

  toJSON() {
    return {
      from: this.from,
      to: this.to,
      amount: this.amount.toString(),
      fee: this.fee.toString(),
      timestamp: this.timestamp,
      publicKey: this.publicKey,
      signature: this.signature
    };
  }

  static decode(data) {
    const msg = TxMessage.decode(data instanceof Buffer ? data : Buffer.from(data, 'base64'));
    return Transaction.fromProtobuf(msg);
  }

  static fromProtobuf(msg) {
    const tx = new Transaction(
      msg.from || '0',
      msg.to || '',
      msg.amount || '0',
      msg.fee || '0',
      Number(msg.timestamp)
    );
    tx.publicKey = msg.publicKey || null;
    tx.signature = msg.signature || null;
    return tx;
  }

  static fromJSON(json) {
    const tx = new Transaction(json.from, json.to, json.amount || '0', json.fee || '0', json.timestamp);
    tx.publicKey = json.publicKey;
    tx.signature = json.signature;
    return tx;
  }
}

module.exports = Transaction;

export {};

const protobuf = require('protobufjs');
const pathModule = require('path');
const { sha256b, sign, verify, addressFromPublicKey } = require('./crypto');

const root = protobuf.loadSync(pathModule.join(__dirname, '..', 'proto', 'blockchain.proto'));
const TxMessage = root.lookupType('femtochain.Transaction');

class Transaction {
  from: string;
  to: string;
  amount: bigint;
  fee: bigint;
  timestamp: number;
  publicKey: string | null;
  signature: string | null;

  constructor(from: string, to: string, amount: bigint | string | number, fee: bigint | string | number = 0n, timestamp: number = Date.now()) {
    this.from = from;
    this.to = to;
    this.amount = BigInt(amount);
    this.fee = BigInt(fee);
    this.timestamp = timestamp;
    this.publicKey = null;
    this.signature = null;
  }

  hash(): string {
    const msg = {
      from: this.from || '',
      to: this.to || '',
      amount: this.amount.toString(),
      fee: this.fee.toString(),
      timestamp: this.timestamp
    };
    return sha256b(TxMessage.encode(msg).finish());
  }

  sign(privateKey: string, publicKey: string): void {
    this.publicKey = publicKey;
    this.signature = sign(this.hash(), privateKey);
  }

  isValid(): boolean {
    if (this.isCoinbase()) return true;
    if (!this.signature || !this.publicKey) return false;
    if (addressFromPublicKey(this.publicKey) !== this.from) return false;
    return verify(this.hash(), this.signature, this.publicKey);
  }

  isCoinbase(): boolean {
    return this.from === '0' && this.publicKey === null && this.signature === null;
  }

  toProtobuf(): any {
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

  encode(): Buffer {
    return TxMessage.encode(this.toProtobuf()).finish();
  }

  toBase64(): string {
    return this.encode().toString('base64');
  }

  toJSON(): { from: string; to: string; amount: string; fee: string; timestamp: number; publicKey: string | null; signature: string | null } {
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

  static decode(data: Buffer | string): Transaction {
    const bytes = data instanceof Buffer ? data : Buffer.from(String(data), 'base64');
    const msg = TxMessage.decode(bytes);
    return Transaction.fromProtobuf(msg);
  }

  static fromProtobuf(msg: any): Transaction {
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

  static fromJSON(json: any): Transaction {
    const tx = new Transaction(json.from, json.to, json.amount || '0', json.fee || '0', json.timestamp);
    tx.publicKey = json.publicKey;
    tx.signature = json.signature;
    return tx;
  }
}

module.exports = Transaction;

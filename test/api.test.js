const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { start } = require('../server/api');
const crypto = require('../lib/crypto');
const { COIN } = require('../lib/unit');

function tempDir() {
  return path.join('/tmp', 'api-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('API Server (standalone)', () => {
  let dir, server, port;

  before(() => {
    dir = tempDir();
    const Blockchain = require('../lib/chain');
    const chain = new Blockchain(dir);
    const kp = crypto.generateKeypair();
    const addr = crypto.addressFromPublicKey(kp.publicKey);
    chain.mineBlock(addr);
    port = 45902;
    server = start(port, dir);
  });

  after(() => {
    server.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/info returns chain stats', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/info`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.blocks, 2);
    assert.strictEqual(body.supply, String(50n * COIN));
    assert.strictEqual(body.valid, true);
  });

  it('GET /api/balance/:address returns balance', async () => {
    const kp = crypto.generateKeypair();
    const addr = crypto.addressFromPublicKey(kp.publicKey);
    const { status, body } = await get(`http://localhost:${port}/api/balance/${addr}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.balance, '0');
  });

  it('GET /api/balance?address= returns balance', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/balance?address=unknown`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.balance, '0');
  });

  it('GET /api/balance with no address returns 400', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/balance`);
    assert.strictEqual(status, 400);
    assert.ok(body.error);
  });

  it('GET /api/blocks returns block list', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/blocks`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.total, 2);
    assert.strictEqual(body.blocks.length, 2);
  });

  it('GET /api/blocks?limit=1 returns limited results', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/blocks?limit=1`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.blocks.length, 1);
  });

  it('GET /api/blocks/:index returns specific block', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/blocks/0`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.index, 0);
  });

  it('GET /api/blocks/:index for missing block returns 404', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/blocks/999`);
    assert.strictEqual(status, 404);
    assert.ok(body.error);
  });

  it('POST /api/tx/decode decodes base64 transaction', async () => {
    const kp = crypto.generateKeypair();
    const from = crypto.addressFromPublicKey(kp.publicKey);
    const Transaction = require('../lib/transaction');
    const tx = new Transaction(from, 'recipient', 10n, 0n);
    tx.sign(kp.privateKey, kp.publicKey);
    const b64 = tx.toBase64();

    const { status, body } = await post(`http://localhost:${port}/api/tx/decode`, { base64: b64 });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.from, from);
    assert.strictEqual(body.amount, '10');
    assert.ok(body.isValid);
  });

  it('POST /api/tx/decode with bad data returns 400', async () => {
    const { status, body } = await post(`http://localhost:${port}/api/tx/decode`, { base64: 'invalid' });
    assert.strictEqual(status, 400);
    assert.ok(body.error);
  });

  it('GET unknown endpoint returns 404', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/nonexistent`);
    assert.strictEqual(status, 404);
    assert.ok(body.error);
  });

  it('OPTIONS returns 204 with CORS headers', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${port}/api/info`, { method: 'OPTIONS' }, (res) => {
        resolve({ status: res.statusCode });
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(status, 204);
  });
});

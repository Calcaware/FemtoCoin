const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { start, applyServerTimeouts, createRateLimiter, createHealthCache } = require('../server/api');
const crypto = require('../lib/crypto');
const { COIN } = require('../lib/unit');

function tempDir() {
  return path.join('/tmp', 'api-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
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

// Performs a request and reports the CORS origin the server answered with,
// which is what browser clients use to decide whether a response is readable.
function getOrigin(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({
        status: res.statusCode,
        allowOrigin: res.headers['access-control-allow-origin']
      }));
    });
    req.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Starts a server on an ephemeral port and resolves once it is accepting
// connections, so tests never race the listener setup.
async function startOnEphemeralPort(options = {}) {
  const dir = tempDir();
  const server = start(0, dir, options);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, dir, port: server.address().port };
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

  it('GET /health returns an unauthenticated liveness report', async () => {
    const { status, body } = await get(`http://localhost:${port}/health`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.chainValid, true);
    assert.strictEqual(body.blocks, 2);
    assert.ok(typeof body.uptime === 'number');
    assert.ok(typeof body.timestamp === 'number');
    assert.ok(body.latestBlock);
    assert.ok(body.version);
  });

  it('GET /api/health is an alias for /health', async () => {
    const { status, body } = await get(`http://localhost:${port}/api/health`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'ok');
  });

  it('health check is reachable even when API auth is configured', async () => {
    const authDir = tempDir();
    const Blockchain = require('../lib/chain');
    const chain = new Blockchain(authDir);
    const kp = crypto.generateKeypair();
    const addr = crypto.addressFromPublicKey(kp.publicKey);
    chain.mineBlock(addr);

    const authServer = start(45904, authDir, { apiToken: 'secret-token' });
    try {
      const health = await get(`http://localhost:45904/health`);
      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.body.status, 'ok');

      const protectedRoute = await get(`http://localhost:45904/api/info`);
      assert.strictEqual(protectedRoute.status, 401);
    } finally {
      authServer.close();
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  });

  it('rejects requests without a bearer token when API auth is configured', async () => {
    const authDir = tempDir();
    const Blockchain = require('../lib/chain');
    const chain = new Blockchain(authDir);
    const kp = crypto.generateKeypair();
    const addr = crypto.addressFromPublicKey(kp.publicKey);
    chain.mineBlock(addr);

    const authServer = start(45903, authDir, { apiToken: 'secret-token' });
    try {
      const unauthorized = await get(`http://localhost:45903/api/info`);
      assert.strictEqual(unauthorized.status, 401);

      const authorized = await get(`http://localhost:45903/api/info`, { Authorization: 'Bearer secret-token' });
      assert.strictEqual(authorized.status, 200);
    } finally {
      authServer.close();
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  });
});

describe('API Server body size limit', () => {
  let dir, server, port;
  const maxBodyBytes = 256;

  before(() => {
    dir = tempDir();
    const Blockchain = require('../lib/chain');
    const chain = new Blockchain(dir);
    const kp = crypto.generateKeypair();
    const addr = crypto.addressFromPublicKey(kp.publicKey);
    chain.mineBlock(addr);
    port = 45905;
    server = start(port, dir, { maxBodyBytes });
  });

  after(() => {
    server.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects an oversized POST body with 413', async () => {
    const oversized = { base64: 'A'.repeat(maxBodyBytes * 4) };
    const { status, body } = await post(`http://localhost:${port}/api/tx/decode`, oversized);
    assert.strictEqual(status, 413);
    assert.match(body.error, /too large/i);
  });

  it('still accepts request bodies within the limit', async () => {
    const { status } = await post(`http://localhost:${port}/api/tx/decode`, { base64: 'invalid' });
    assert.notStrictEqual(status, 413);
    assert.strictEqual(status, 400);
  });

  it('rejects an oversized chunked body without a Content-Length header', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${port}/api/tx/decode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write('{"base64":"');
      req.write('A'.repeat(maxBodyBytes * 4));
      req.write('"}');
      req.end();
    });
    assert.strictEqual(status, 413);
  });
});

describe('API Server HTTP timeouts', () => {
  it('applies configurable socket timeouts to the server', async () => {
    const dir = tempDir();
    const server = start(0, dir, { headersTimeout: 25000, requestTimeout: 90000, keepAliveTimeout: 3000 });
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      assert.strictEqual(server.keepAliveTimeout, 3000);
      assert.strictEqual(server.headersTimeout, 25000);
      assert.strictEqual(server.requestTimeout, 90000);
      assert.ok(server.connectionsCheckingInterval <= server.headersTimeout);
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps headersTimeout greater than keepAliveTimeout', () => {
    const server = {};
    applyServerTimeouts(server, { headersTimeout: 1000, keepAliveTimeout: 5000, requestTimeout: 10000 });
    assert.ok(server.headersTimeout > server.keepAliveTimeout);
    assert.ok(server.requestTimeout >= server.headersTimeout);
  });

  it('falls back to safe defaults for invalid timeout values', () => {
    const server = {};
    applyServerTimeouts(server, { headersTimeout: -1, requestTimeout: 'abc', keepAliveTimeout: 0 });
    assert.ok(Number.isFinite(server.keepAliveTimeout) && server.keepAliveTimeout > 0);
    assert.ok(Number.isFinite(server.headersTimeout) && server.headersTimeout > 0);
    assert.ok(Number.isFinite(server.requestTimeout) && server.requestTimeout > 0);
  });

  it('drops clients that never send request headers (slowloris)', async () => {
    const dir = tempDir();
    const server = start(0, dir, {
      headersTimeout: 200,
      keepAliveTimeout: 100,
      requestTimeout: 2000,
      connectionsCheckingInterval: 50
    });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port: livePort } = server.address();
    try {
      const outcome = await new Promise((resolve) => {
        const socket = net.connect(livePort, '127.0.0.1');
        // Resume the socket so the 408 response and the server's FIN are read;
        // otherwise a paused socket never observes EOF and no 'close' fires.
        socket.resume();
        const timer = setTimeout(() => {
          socket.destroy();
          resolve('still-open');
        }, 5000);
        socket.on('close', () => { clearTimeout(timer); resolve('closed'); });
        socket.on('error', () => { clearTimeout(timer); resolve('closed'); });
      });
      assert.strictEqual(outcome, 'closed');
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('API health cache', () => {
  const T0 = 1700000000000;

  it('reuses the verdict within the TTL and recomputes afterwards', () => {
    const cache = createHealthCache({ ttlMs: 1000 });
    let calls = 0;
    const compute = () => { calls += 1; return { chainValid: true }; };

    const first = cache.read(compute, T0);
    assert.strictEqual(cache.read(compute, T0 + 500), first);
    assert.strictEqual(calls, 1);
    assert.strictEqual(cache.validations, 1);

    cache.read(compute, T0 + 1500);
    assert.strictEqual(calls, 2);
  });

  it('recomputes on every read when the TTL is zero', () => {
    const cache = createHealthCache({ ttlMs: 0 });
    let calls = 0;
    const compute = () => { calls += 1; return calls; };
    assert.strictEqual(cache.read(compute, T0), 1);
    assert.strictEqual(cache.read(compute, T0), 2);
    assert.strictEqual(cache.validations, 2);
  });

  it('drops the cached verdict when reset', () => {
    const cache = createHealthCache({ ttlMs: 60000 });
    let calls = 0;
    const compute = () => { calls += 1; return calls; };
    cache.read(compute, T0);
    cache.reset();
    cache.read(compute, T0 + 1);
    assert.strictEqual(calls, 2);
  });

  it('falls back to a positive default TTL for invalid values', () => {
    assert.ok(createHealthCache({ ttlMs: 'abc' }).ttlMs > 0);
    assert.ok(createHealthCache({ ttlMs: -10 }).ttlMs > 0);
  });
});

describe('API Server health caching', () => {
  it('validates the chain once for probes inside the TTL', async () => {
    const { server, dir, port } = await startOnEphemeralPort({ healthTtl: 60000 });
    try {
      const first = await get(`http://127.0.0.1:${port}/health`);
      const second = await get(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(first.status, 200);
      assert.strictEqual(second.status, 200);
      assert.strictEqual(first.body.chainValid, true);
      assert.strictEqual(second.body.blocks, first.body.blocks);
      assert.strictEqual(server.healthCache.validations, 1);

      // Cached chain data must not freeze the per-request fields.
      assert.ok(Math.abs(Date.now() - second.body.timestamp) < 2000);
      assert.ok(typeof second.body.uptime === 'number');
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('revalidates once the TTL expires', async () => {
    const { server, dir, port } = await startOnEphemeralPort({ healthTtl: 50 });
    try {
      await get(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(server.healthCache.validations, 1);

      await new Promise((resolve) => setTimeout(resolve, 120));
      await get(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(server.healthCache.validations, 2);
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('revalidates every probe when the TTL is disabled', async () => {
    const { server, dir, port } = await startOnEphemeralPort({ healthTtl: 0 });
    try {
      assert.strictEqual(server.healthCache.ttlMs, 0);
      for (let i = 0; i < 3; i++) {
        const { status } = await get(`http://127.0.0.1:${port}/health`);
        assert.strictEqual(status, 200);
      }
      assert.strictEqual(server.healthCache.validations, 3);
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('API rate limit store', () => {
  const T0 = 1700000000000;

  it('sweeps buckets whose window has expired', () => {
    const limiter = createRateLimiter({ windowMs: 1000, sweepIntervalMs: 1, maxClients: 100 });
    limiter.check('10.0.0.1', 5, T0);
    limiter.check('10.0.0.2', 5, T0);
    assert.strictEqual(limiter.size, 2);

    limiter.check('10.0.0.3', 5, T0 + 5000);
    assert.strictEqual(limiter.size, 1);
  });

  it('keeps counting requests inside the window and resets afterwards', () => {
    const limiter = createRateLimiter({ windowMs: 1000, sweepIntervalMs: 1, maxClients: 100 });
    assert.strictEqual(limiter.check('10.0.0.1', 3, T0), false);
    assert.strictEqual(limiter.check('10.0.0.1', 3, T0 + 100), false);
    assert.strictEqual(limiter.check('10.0.0.1', 3, T0 + 200), false);
    // The fourth request inside the window pushes the client over the limit.
    assert.strictEqual(limiter.check('10.0.0.1', 3, T0 + 300), true);
    // The bucket expired, so the client starts a fresh window.
    assert.strictEqual(limiter.check('10.0.0.1', 3, T0 + 5000), false);
    assert.strictEqual(limiter.size, 1);
  });

  it('never grows past the configured client cap', () => {
    const limiter = createRateLimiter({ maxClients: 8, sweepIntervalMs: 60000 });
    for (let i = 0; i < 500; i++) {
      limiter.check(`192.168.${Math.floor(i / 256)}.${i % 256}`, 5, T0 + i);
    }
    assert.strictEqual(limiter.maxClients, 8);
    assert.strictEqual(limiter.size, 8);
  });

  it('evicts idle clients before active ones', () => {
    const limiter = createRateLimiter({ maxClients: 3, sweepIntervalMs: 60000 });
    assert.strictEqual(limiter.check('steady', 5, T0), false);

    for (let i = 0; i < 100; i++) {
      limiter.check('steady', 1000, T0 + 10 + i);
      limiter.check(`churn-${i}`, 1000, T0 + 10 + i);
    }
    assert.ok(limiter.size <= 3);

    // A still lower limit only trips if the steady bucket survived the churn,
    // because an evicted bucket would come back empty.
    assert.strictEqual(limiter.check('steady', 5, T0 + 5000), true);
  });

  it('falls back to defaults for invalid configuration', () => {
    const limiter = createRateLimiter({ maxClients: 0, windowMs: -5, sweepIntervalMs: 'abc' });
    assert.ok(limiter.maxClients > 0);
    limiter.check('10.0.0.1', 1, T0);
    assert.strictEqual(limiter.size, 1);
  });
});

describe('API Server rate limiting', () => {
  it('answers 429 once the client exceeds the configured limit', async () => {
    const { server, dir, port } = await startOnEphemeralPort({ rateLimit: 3 });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await get(`http://127.0.0.1:${port}/api/info`)).status);
      }
      assert.deepStrictEqual(statuses, [200, 200, 200, 429, 429]);

      // Health probes stay reachable while the client is throttled.
      const health = await get(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(health.status, 200);
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throttle when the limit is 0', async () => {
    const { server, dir, port } = await startOnEphemeralPort({ rateLimit: 0 });
    try {
      for (let i = 0; i < 5; i++) {
        const { status } = await get(`http://127.0.0.1:${port}/api/info`);
        assert.strictEqual(status, 200);
      }
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a separate store per server instance', async () => {
    const first = await startOnEphemeralPort({ rateLimit: 1 });
    const second = await startOnEphemeralPort({ rateLimit: 1 });
    try {
      const a = await get(`http://127.0.0.1:${first.port}/api/info`);
      const aAgain = await get(`http://127.0.0.1:${first.port}/api/info`);
      const b = await get(`http://127.0.0.1:${second.port}/api/info`);
      assert.strictEqual(a.status, 200);
      assert.strictEqual(aAgain.status, 429);
      assert.strictEqual(b.status, 200);
    } finally {
      await closeServer(first.server);
      await closeServer(second.server);
      fs.rmSync(first.dir, { recursive: true, force: true });
      fs.rmSync(second.dir, { recursive: true, force: true });
    }
  });

  it('applies the configured client cap to the server store', async () => {
    const { server, dir, port } = await startOnEphemeralPort({
      rateLimit: 1000,
      rateLimitMaxClients: 4
    });
    try {
      assert.strictEqual(server.rateLimiter.maxClients, 4);
      for (let i = 0; i < 50; i++) {
        server.rateLimiter.check(`10.1.${Math.floor(i / 256)}.${i % 256}`, 5);
      }
      assert.strictEqual(server.rateLimiter.size, 4);

      const { status } = await get(`http://127.0.0.1:${port}/api/info`);
      assert.strictEqual(status, 200);
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('API Server CORS origins', () => {
  it('trusts exact local origins and rejects lookalike hosts', async () => {
    const { server, dir, port } = await startOnEphemeralPort();
    const base = `http://127.0.0.1:${port}/api/info`;
    try {
      const local = await getOrigin(base, { Origin: 'http://localhost:3000' });
      assert.strictEqual(local.allowOrigin, 'http://localhost:3000');

      const loopback = await getOrigin(base, { Origin: 'http://127.0.0.1:8080' });
      assert.strictEqual(loopback.allowOrigin, 'http://127.0.0.1:8080');

      const lookalike = await getOrigin(base, { Origin: 'http://localhost.attacker.example' });
      assert.strictEqual(lookalike.allowOrigin, 'null');

      const foreign = await getOrigin(base, { Origin: 'https://evil.example' });
      assert.strictEqual(foreign.allowOrigin, 'null');

      const none = await getOrigin(base);
      assert.strictEqual(none.allowOrigin, '*');
    } finally {
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honors a comma-separated origin allowlist', async () => {
    const { server, dir, port } = await startOnEphemeralPort();
    const base = `http://127.0.0.1:${port}/api/info`;
    process.env.FEMTOCHAIN_CORS_ORIGIN = 'http://localhost:3000, https://app.example';
    try {
      const allowed = await getOrigin(base, { Origin: 'https://app.example' });
      assert.strictEqual(allowed.allowOrigin, 'https://app.example');

      const denied = await getOrigin(base, { Origin: 'https://attacker.example' });
      assert.strictEqual(denied.allowOrigin, 'null');
    } finally {
      delete process.env.FEMTOCHAIN_CORS_ORIGIN;
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores an allowlist that only contains separators', async () => {
    const { server, dir, port } = await startOnEphemeralPort();
    const base = `http://127.0.0.1:${port}/api/info`;
    process.env.FEMTOCHAIN_CORS_ORIGIN = ' , ';
    try {
      const none = await getOrigin(base);
      assert.strictEqual(none.allowOrigin, '*');

      const local = await getOrigin(base, { Origin: 'http://localhost:3000' });
      assert.strictEqual(local.allowOrigin, 'http://localhost:3000');
    } finally {
      delete process.env.FEMTOCHAIN_CORS_ORIGIN;
      await closeServer(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const Peer = require('../lib/peer');

describe('Peer', () => {
  it('stores connection metadata and address', () => {
    const ws = { readyState: 1, send: () => {}, close: () => {} };
    const peer = new Peer(ws, { host: '127.0.0.1', port: 3000 });

    assert.ok(peer.id.startsWith('peer_'));
    assert.strictEqual(peer.host, '127.0.0.1');
    assert.strictEqual(peer.port, 3000);
    assert.strictEqual(peer.connected, true);
    assert.strictEqual(peer.address, '127.0.0.1:3000');
  });

  it('send serializes a JSON message when websocket is open', () => {
    const sent = [];
    const ws = {
      readyState: 1,
      send: (msg) => sent.push(msg)
    };

    const peer = new Peer(ws, { host: 'localhost', port: 4000 });
    peer.send('NEW_TX', { tx: 'abc' });

    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(JSON.parse(sent[0]), { type: 'NEW_TX', data: { tx: 'abc' } });
  });

  it('close marks the peer disconnected and closes the socket', () => {
    let closed = false;
    const ws = {
      readyState: 1,
      close: () => { closed = true; }
    };

    const peer = new Peer(ws);
    peer.close();

    assert.strictEqual(peer.connected, false);
    assert.strictEqual(closed, true);
  });
});

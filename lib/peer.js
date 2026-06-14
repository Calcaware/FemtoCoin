const WebSocket = require('ws');

let idCounter = 0;

class Peer {
  constructor(ws, info = {}) {
    this.ws = ws;
    this.id = `peer_${++idCounter}`;
    this.host = info.host || null;
    this.port = info.port || null;
    this.connected = true;
    this.height = 0;
    this.latestHash = null;
  }

  send(type, data = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  close() {
    this.connected = false;
    try { this.ws.close(); } catch (_) {}
  }

  get address() {
    if (this.host && this.port) return `${this.host}:${this.port}`;
    return this.id;
  }
}

module.exports = Peer;

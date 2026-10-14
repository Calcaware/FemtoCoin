Full test plan for FemtoCoin
============================

This project has a full test suite covering the main blockchain modules, the wallet flow, the API, and the networking support layer.

Core modules
------------
- lib/crypto.js: hashing, key generation, signing, verification
- lib/unit.js: unit conversion and bigint formatting
- lib/transaction.js: transaction hashing, signing, validation, serialization
- lib/block.js: block hashing, PoW, protobuf encode/decode, size limits
- lib/chain.js: block validation, reward logic, persistence, replacement rules
- lib/wallet.js: wallet creation, encrypted keystore behavior, input validation
- lib/node.js: peer communication, mempool handling, peer limits
- lib/peer.js: socket metadata and message send semantics
- server/api.js: HTTP API behavior and auth enforcement

Test files
----------
- test/crypto.test.js
- test/unit.test.js
- test/transaction.test.js
- test/block.test.js
- test/chain.test.js
- test/wallet.test.js
- test/node.test.js
- test/peer.test.js
- test/api.test.js

Coverage intent
---------------
The suite verifies:
- deterministic hash and cryptographic correctness
- transaction and block validation rules
- chain persistence and replacement behavior
- wallet file safety and encrypted keystore handling
- API request and error handling
- oversized API request bodies are rejected with 413 rather than buffered
- HTTP header/request/keep-alive timeouts are configured and stalled clients are dropped
- node-level limits for peer and message abuse
- peer metadata and communication logic

Execution
---------
Run the full suite with:

```bash
node --test
```

Recommended CI usage:

```bash
npm test
npm run typecheck
npm run audit
```

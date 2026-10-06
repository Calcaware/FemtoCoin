FemtoCoin project review
=======================

Scope
-----
This review covers the blockchain implementation, wallet flow, P2P networking, API, dependency health, and practical engineering improvements. The goal is to identify where this project is strong, where it is risky, and what the next steps should be.

Current state
-------------
- Runtime: Node.js project with a blockchain engine, wallet management, peer-to-peer networking, and a REST API.
- Test status: 90 tests passed after installing dependencies.
- Dependency status: npm install completed successfully. npm audit reports 1 moderate vulnerability in protobufjs.
- Important note: this project is a working prototype and a strong educational implementation, but it is not yet hardened for internet-facing production use.

Strong points
-------------
- Clear separation of concerns between block, chain, wallet, node, and API layers.
- Good unit test coverage across crypto, blocks, transactions, chain logic, and wallets.
- Use of Ed25519, SHA-256, scrypt, and AES-256-GCM gives a reasonable security baseline for a prototype.
- PoW validation, difficulty adjustment, chain replacement rules, and persistent chain storage are all implemented.
- The project already contains a helpful README and a fairly structured architecture.

Observed risks
--------------
1. Dependency vulnerability
   - npm audit reports a moderate protobufjs advisory.
   - Impact: untrusted .proto parsing can trigger prototype pollution or DoS under certain conditions.
   - Recommendation: upgrade protobufjs to a patched version and add an automated dependency audit step in CI.

2. Wallet path traversal risk
   - The wallet code builds filesystem paths with user-controlled names using path.join(this.walletDir, `${name}.json`).
   - A wallet name like ../other/evil could escape the wallet directory and overwrite arbitrary files.
   - This is a real file-system security issue if wallet names are user-supplied or network-controlled.
   - Recommendation: validate names strictly and restrict them to a safe basename pattern such as /^[a-zA-Z0-9_-]+$/.

3. Plain-text wallet files are a major source of risk
   - The non-encrypted wallet mode saves private keys directly to disk in JSON.
   - This is useful for local demos, but it is unsafe for any real-world use or multi-user environment.
   - Recommendation: require encrypted wallets by default, with a secure wallet directory permission policy.

4. No server-side authentication or authorization on the API
   - The REST API exposes chain data and balance lookup without any auth layer.
   - This is acceptable for a public read-only explorer, but not for an API that may be used to control funds or private node state.
   - Recommendation: add auth for admin endpoints, rate limiting, and separate read-only/public vs. private/admin surfaces.

5. CORS is permissive
   - Access-Control-Allow-Origin is set to '*' for all requests.
   - This is harmless in a read-only public chain explorer, but dangerous if the API later exposes sensitive information or write paths.
   - Recommendation: restrict to trusted origins and use a whitelist.

6. Peer-to-peer network trust model is weak
   - The node accepts peers and chain data from remote peers without strong identity or trust checks.
   - This is okay for a test network, but risky for an untrusted public network.
   - Recommendation: use peer allowlists, ban lists, peer reputation checks, and limits on chain size and message rate.

7. No transport security for network messages
   - WebSockets are plain ws://, not wss://.
   - In public or hostile networks, this exposes messages to interception or tampering.
   - Recommendation: support TLS or encrypted tunnels and verify peer identity if this is intended to run beyond a private LAN.

8. Large message and chain replay risks
   - Requests and peer messages are processed with few limits.
   - Malicious peers could send unusually large chains or large payloads to consume CPU, memory, or disk I/O.
   - Recommendation: impose body size caps, peer connection quotas, message rate limits, and chain-length ceilings.

9. Memory and file handling are not hardened
   - CLI stores wallet passwords in a Map in process memory.
   - There is no secure-memory strategy and no cross-process isolation.
   - Recommendation: use a safer secret store model or explicit encrypted secret handling in a production-grade design.

10. The codebase is JavaScript-only, which increases maintenance risk
    - The project already includes many modules and tests, but JS does not enforce types or surface API contract issues as well as TypeScript.
    - Recommendation: migrate the core business logic gradually to TypeScript while keeping the runtime stable.

Architecture summary
--------------------
The system is organized as a simple blockchain node with layered responsibilities:

+-------------------+
| CLI / shell       |
| node index.js     |
+---------+---------+
          |
          v
+-------------------+
| Node              |
| - WebSocket P2P  |
| - mempool         |
| - peer discovery  |
| - gossip          |
+---------+---------+
          |
          v
+-------------------+
| Blockchain        |
| - block validation|
| - state rebuild   |
| - chain replace   |
| - difficulty      |
+---------+---------+
          |
          v
+-------------------+
| Block / Tx / Crypto|
| - PB serialization|
| - Ed25519 sign    |
| - SHA-256 hash    |
| - PoW logic       |
+---------+---------+
          |
          v
+-------------------+
| Wallet store      |
| - keystore files  |
| - scrypt+AES-GCM  |
| - local addresses |
+---------+---------+
          |
          v
+-------------------+
| File store        |
| chain.dat         |
| peers.json        |
| wallets/*.json    |
+-------------------+

The REST API is a sidecar service for chain introspection and does not directly manage transaction submission or wallet keys.

Improvement ideas
-----------------
1. Upgrade protobufjs and add npm audit to CI.
2. Add strict wallet name validation and safe file creation.
3. Default to encrypted wallet creation and only allow plain wallets in clearly marked local-only modes.
4. Add authentication and rate limiting to the API.
5. Harden CORS to trusted origins only.
6. Add TLS and peer validation to the P2P layer.
7. Add message size limits and peer connection quotas.
8. Add logging, metrics, and health checks.
9. Split the node into cleaner modules: network, consensus, wallet, persistence, and API.
10. Introduce a TypeScript migration path for the core library before adding more complexity.
11. Add a formal state machine for mempool and block validation events.
12. Add a pruning or snapshot strategy for long-term chain persistence.
13. Add explorer and API separation so read-only explorer traffic is isolated from control-plane traffic.
14. Add integration tests for malicious peer behavior and malformed messages.
15. Add Docker health checks and non-root container execution.

TypeScript migration guidance
-----------------------------
A gradual TypeScript migration would make the project safer without a risky rewrite.

Suggested approach:
- Start with the crypto, transaction, and block modules.
- Add types for Transaction, Block, Wallet, Peer, and Blockchain state.
- Keep the runtime output stable while improving developer safety.
- Move from CommonJS to ESM only if the project is ready for that change.
- Add tsconfig strict mode and a narrow type-check CI job.

A good first migration set is:
- lib/crypto.js
- lib/unit.js
- lib/transaction.js
- lib/block.js
- lib/chain.js

This can be done without breaking the public API or the existing tests.

Conclusion
----------
This is a well-structured and educational blockchain project with a decent security baseline for a prototype. The biggest immediate wins are dependency hardening, safer wallet handling, API security, and peer validation. The project is solid enough to evolve, but it should not be exposed to an untrusted network without additional protections.

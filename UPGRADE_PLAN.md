Upgrade plan for FemtoCoin
=========================

Goal
----
This project is a solid blockchain prototype, but it needs a layered hardening plan before it is safe to run in a hostile or public environment. The plan below focuses on immediate security hardening first, then operational maturity, then TypeScript migration.

Architecture summary
--------------------
+------------------------+
| CLI / interactive shell |
| node index.js          |
+-----------+------------+
            |
            v
+-----------+------------+
| Node                   |
| - peer tracking        |
| - mempool              |
| - WebSocket gossip     |
| - peer limits          |
+-----------+------------+
            |
            v
+-----------+------------+
| Blockchain             |
| - validation           |
| - difficulty          |
| - reward logic        |
| - chain replacement    |
+-----------+------------+
            |
            v
+-----------+------------+
| Persisted data         |
| - chain.dat            |
| - peers.json           |
| - wallets/*.json       |
+-----------+------------+
            |
            v
+-----------+------------+
| API                    |
| - read-only endpoints  |
| - optional auth        |
| - rate limiting        |
+------------------------+

Phase 1: harden the base
------------------------
Priority: high

1. Upgrade protobufjs to a patched version.
   - Done.
   - Dependency is now set to protobufjs ^8.8.0.
   - Result: npm audit reports 0 vulnerabilities.

2. Restrict wallet file names and path traversal.
   - Done.
   - Wallet names are now validated before save/load.
   - Unsafe names such as ../evil or a/b are rejected.

3. Add API auth support and rate limiting.
   - Done.
   - The REST API accepts an optional bearer token using FEMTOCHAIN_API_TOKEN.
   - A configurable rate limit is enabled by default when the environment is configured.

4. Harden the network layer.
   - Done.
   - Peer count caps, payload limits, and chain length limits are enforced.
   - This reduces abuse from oversized or malicious messages.

5. Add security regression tests.
   - Done.
   - Tests cover wallet path validation and API bearer-token protection.

Phase 2: operational hardening
------------------------------
Priority: medium

1. Add TLS support for WebSocket traffic.
   - Use wss:// behind a reverse proxy or custom TLS layer.
   - Validate remote peer identities before trust is granted.

2. Restrict CORS to trusted origins.
   - Keep allow-list checks in configuration.
   - Default to a safer origin model instead of wildcard access.

3. Add structured logging and metrics.
   - Include node health, peer count, blocks mined, and rejected messages.
   - Add a lightweight health endpoint for monitoring.

4. Harden container deployment.
   - Run Docker containers as a non-root user.
   - Add health checks and explicit volume permissions.

5. Add malicious peer and malformed message tests.
   - Simulate invalid JSON, oversize payloads, and peer spam.

Phase 3: TypeScript migration
----------------------------
Priority: medium

1. Convert core logic to TypeScript incrementally.
   - Started with the core crypto, transaction, block, and chain modules under src/.
   - Runtime behavior remains stable while the type surface is strengthened.

2. Add strict TypeScript checks in CI.
   - tsconfig is configured with strict mode.
   - The project now includes a typecheck script.

3. Separate domain boundaries.
   - Keep blockchain logic, networking, and wallet storage in isolated modules.
   - Avoid mixing transport concerns with consensus logic.

Phase 4: long-term production readiness
---------------------------------------
Priority: low

1. Introduce snapshot or pruning strategy for long-term chain storage.
2. Add explorer and node API separation for operational isolation.
3. Add quotas for mempool, peer state, and chain replay behavior.
4. Add release gates for dependency and security scanning.

Execution status
----------------
- Phase 1: complete
- Phase 2: documented and ready for implementation
- Phase 3: planned
- Phase 4: planned

Follow-up commands
------------------
Use the following environment variables to tune the hardened runtime:

FEMTOCHAIN_API_TOKEN=your-token
FEMTOCHAIN_API_RATE_LIMIT=120
FEMTOCHAIN_API_MAX_BODY=1048576
FEMTOCHAIN_CORS_ORIGIN=http://localhost:3000
FEMTOCHAIN_SECURE_WALLETS=1
FEMTOCHAIN_MAX_PEERS=32
FEMTOCHAIN_MAX_CHAIN_LENGTH=5000

Example:

FEMTOCHAIN_API_TOKEN=secret node server/api.js --port 4000

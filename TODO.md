# TODO - FemtoCoin Project

## Project Status
- ✅ All 126 tests pass
- ✅ TypeScript typecheck passes with strict mode
- ✅ `npm audit` reports 0 vulnerabilities (protobufjs upgraded)
- ✅ Phase 1 (hardening) from UPGRADE_PLAN.md is complete
- ✅ Wallet path traversal validation implemented
- ✅ API auth and rate limiting implemented
- ✅ Rate limit store is swept and capped so it cannot grow without bound
- ✅ Health/status endpoint implemented (`GET /health`)
- ✅ API request body size capped (`413 Payload Too Large`)
- ✅ HTTP server timeouts implemented (slowloris protection)

## Phase 1: Completed ✅
- [x] Upgrade protobufjs to patched version (8.8.0+)
- [x] Add wallet name validation to prevent path traversal
- [x] Add API bearer token auth via `FEMTOCHAIN_API_TOKEN`
- [x] Add configurable API rate limiting
- [x] Add peer/message/chain size limits in node layer
- [x] Add security regression tests (wallet validation, API auth)

## Phase 2: Operational Hardening (High Priority)

### P2P & Network Security
- [ ] **Add TLS support for WebSocket (wss://)** - Support TLS for peer-to-peer connections, either direct TLS or via reverse proxy configuration
- [ ] **Implement peer allowlist/blocklist** - Add configurable allowlist for trusted peers and blocklist for abusive ones
- [ ] **Add peer reputation system** - Track peer behavior (invalid blocks, spam, timeouts) and score peers accordingly
- [ ] **Validate peer identities** - Add cryptographic peer authentication before trusting chain data
- [x] **Restrict CORS to trusted origins** - Replace wildcard CORS with configurable allowlist (default to safer model). Only exact `localhost` and `127.0.0.1` origins are trusted by default (lookalike hosts such as `http://localhost.attacker.example` are rejected), and `FEMTOCHAIN_CORS_ORIGIN` accepts a comma-separated list of allowed origins.

### Infrastructure & Operations
- [ ] **Add structured logging** - Replace console.log with structured logging (levels, timestamps, context) for better observability
- [ ] **Add metrics collection** - Track blocks mined, peer counts, rejected messages, validation failures, mempool size
- [x] **Add health check endpoint** - Lightweight health/status endpoint for monitoring and load balancers (`GET /health`, `GET /api/health`)
- [ ] **Cache health check results** - `GET /health` runs `chain.isValid()` on every unauthenticated probe, and that check walks the whole chain, so a flood of cheap probes can still burn CPU. Cache the verdict for a short interval or revalidate in the background instead of validating per request
- [ ] **Harden Docker containers** - Run as non-root user, add HEALTHCHECK in Dockerfile, proper volume permissions
- [ ] **Improve error handling** - Consistent error reporting and graceful degradation across modules

### Security Testing
- [ ] **Add malicious peer tests** - Simulate invalid JSON, oversized payloads, malformed blocks, chain forks from bad actors
- [ ] **Add DoS/spam resistance tests** - Test rate limiting, peer connection quotas, mempool flooding
- [ ] **Add edge case validation tests** - Test boundary conditions for blocks, transactions, difficulty

## Phase 3: TypeScript Migration (Medium Priority)

### Core Modules (In Progress)
- [x] `src/crypto.ts` - Cryptographic primitives
- [x] `src/transaction.ts` - Transaction model with protobuf serialization
- [x] `src/block.ts` - Block model with PoW mining
- [x] `src/chain.ts` - Blockchain state machine
- [x] `src/unit.ts` - Unit conversion utilities

### Remaining TypeScript Conversions
- [ ] **Convert `lib/wallet.js` → `src/wallet.ts`** - Add proper types for keystore formats, crypto operations
- [ ] **Convert `lib/node.js` → `src/node.ts`** - Add types for peer management, message passing, event handling
- [ ] **Convert `lib/peer.js` → `src/peer.ts`** - Type peer connections and message envelopes
- [ ] **Convert `lib/api.js` → `src/api.ts` (or `server/api.ts`)** - Type HTTP handlers, request/response
- [ ] **Convert CLI (`index.js`)** - Consider migrating to TypeScript or maintain JS wrapper
- [ ] **Update build pipeline** - Ensure dist/ outputs are used by runtime, or update imports to use built modules
- [ ] **Add strict CI typecheck** - Enforce `tsc --noEmit` in CI pipeline
- [ ] **Improve type definitions** - Add interfaces for all domain entities (Transaction, Block, Wallet, Peer, etc.)

## Phase 4: Long-term Production Readiness (Low Priority)

### Scalability & Performance
- [ ] **Implement chain pruning/snapshots** - Allow pruning old blocks while preserving recent state for long-term operation
- [ ] **Add state snapshots** - Periodic snapshot of UTXO/account state to speed up sync
- [ ] **Optimize chain storage** - Consider improvements to binary persistence format
- [ ] **Add mempool eviction policy** - Age-based or fee-based eviction to prevent unbounded growth

### Architecture Improvements
- [ ] **Separate explorer from node API** - Isolate read-only explorer traffic from control-plane operations
- [ ] **Modularize node components** - Split into clearer boundaries: network, consensus, wallet, persistence, RPC/API
- [ ] **Add formal state machine** - Model mempool, block validation, and sync states explicitly
- [ ] **Implement event system** - Cleaner pub/sub for block mined, tx added, peer connected events

### DevOps & Release
- [ ] **Add CI/CD pipeline** - Automated tests, typecheck, linting, security scanning on PRs
- [ ] **Add release automation** - Semantic versioning, changelog generation
- [ ] **Add integration tests for network behavior** - Multi-node integration tests with actual WebSocket connections
- [ ] **Security scanning in CI** - Regular `npm audit`, dependency updates, SAST

## Code Quality & Documentation

- [ ] **Remove the dead `lib/api.js` duplicate** - `lib/api.js` is unreferenced dead code (only `server/api.js` is loaded) that duplicates the API surface but omits the auth, CORS allowlist, and rate-limiting hardening. Delete it or consolidate everything into one API implementation so the insecure variant cannot be shipped by mistake.
- [x] **Cap API request body size** - `readBody()` in `server/api.js` now reads with a fixed maximum length (default 1 MiB, configurable via `FEMTOCHAIN_API_MAX_BODY` or `--max-body`) and returns `413 Payload Too Large` for oversized bodies instead of buffering them in memory.
- [x] **Add HTTP server timeouts** - `headersTimeout`, `requestTimeout`, and `keepAliveTimeout` are now set on the API server (configurable via `FEMTOCHAIN_API_HEADERS_TIMEOUT`, `FEMTOCHAIN_API_REQUEST_TIMEOUT`, `FEMTOCHAIN_API_KEEPALIVE_TIMEOUT`, and `FEMTOCHAIN_API_CONNECTIONS_CHECK_INTERVAL`) so slow or stalled clients cannot hold connections open indefinitely.
- [x] **Bound the API rate-limit store** - The `RATE_LIMIT_STORE` map in `server/api.js` only ever grew: every distinct client IP created a permanent entry, so a large or spoofed address space could slowly exhaust memory. `createRateLimiter()` now owns a per-server store that sweeps buckets once their window expires, caps tracked clients with `FEMTOCHAIN_API_RATE_LIMIT_MAX_CLIENTS` (default 10000, `--rate-limit-clients`), and evicts the least recently used client when the cap is reached.
- [ ] **Add ESLint/Prettier** - Consistent code style enforcement
- [ ] **Improve inline documentation** - Add JSDoc/TSDoc comments for public APIs
- [ ] **Update README with hardening guide** - Document security best practices, env vars, production setup
- [ ] **Create API documentation** - Document REST endpoints with examples
- [ ] **Add contributing guidelines** - CONTRIBUTING.md with development workflow

## Environment Configuration Reference

Key environment variables for hardened deployments:
- `FEMTOCHAIN_API_TOKEN` - Bearer token for API auth
- `FEMTOCHAIN_API_RATE_LIMIT` - Requests per minute (default varies, set to 0 to disable)
- `FEMTOCHAIN_API_RATE_LIMIT_MAX_CLIENTS` - Maximum client buckets tracked by the rate limiter (default 10000, least recently used entries are evicted)
- `FEMTOCHAIN_API_MAX_BODY` - Maximum API request body size in bytes (default 1048576)
- `FEMTOCHAIN_API_HEADERS_TIMEOUT` - Milliseconds allowed to receive request headers (default 60000)
- `FEMTOCHAIN_API_REQUEST_TIMEOUT` - Milliseconds allowed for the whole request (default 300000)
- `FEMTOCHAIN_API_KEEPALIVE_TIMEOUT` - Milliseconds an idle keep-alive socket is retained (default 5000)
- `FEMTOCHAIN_API_CONNECTIONS_CHECK_INTERVAL` - Milliseconds between timeout sweeps of open connections (default 30000)
- `FEMTOCHAIN_CORS_ORIGIN` - Allowed CORS origins (comma-separated)
- `FEMTOCHAIN_SECURE_WALLETS` - Require encrypted wallets by default (1/0)
- `FEMTOCHAIN_MAX_PEERS` - Maximum concurrent peer connections
- `FEMTOCHAIN_MAX_CHAIN_LENGTH` - Maximum chain length from peers
- `FEMTOCHAIN_SECURE_WALLETS_DIR` - Restrict wallet directory permissions

---

*This TODO is based on PROJECT_REVIEW.md, UPGRADE_PLAN.md, and the current codebase state.*
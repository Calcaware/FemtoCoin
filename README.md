# FemtoChain

A proof-of-work blockchain in JavaScript with ed25519 cryptography and P2P networking. This project started as a joke cryptocurrency called FemtoCoin about four years ago. It used string concatenation for transaction signing, a single-file architecture, and had no actual security. I decided to take it seriously, rewrite it from scratch, and turn it into a real blockchain implementation. The chain state was reset. The old name stuck around.

## Features

- **Blockchain.** SHA-256 linked blocks with difficulty-adjusted Proof-of-Work mining. Each block references the hash of the previous block, forming an immutable chain. Difficulty retargets every 10 blocks to maintain a ~30 second block time.
- **Cryptography.** ed25519 key pairs for transaction signing, using Node.js built-in crypto module. No third-party crypto libraries.
- **Encrypted Wallets.** Password-protected keystores using scrypt key derivation and AES-256-GCM encryption. Compatible with the general Ethereum keystore format.
- **Consensus.** Longest-chain rule. Peers exchange chains on connection. The chain with the most cumulative proof of work wins.
- **P2P Networking.** WebSocket-based peer-to-peer protocol with automatic peer exchange, DNS seed discovery, and persistent peer storage.
- **Protocol Buffers.** Block and transaction serialization uses Protocol Buffers for deterministic binary encoding. This replaces the original JSON-based format and ensures cross-language compatibility for a future Go port.
- **Continuous Mining.** Built-in mining loop that yields to the event loop every 10,000 hashes. Mine one block at a time or let it run continuously.
- **Containerized.** Docker and docker-compose support for single-node or multi-node clusters.
- **1 MB Block Size Limit.** Blocks larger than 1,048,576 bytes are rejected by the network. This prevents unbounded block growth from spam transactions.
- **Binary Chain Storage.** The blockchain is persisted to a single binary file (chain.dat) using length-prefixed protobuf blocks. This replaces the old JSON file format and enables atomic appends.
- **Test Suite.** Comprehensive unit and integration tests using Node.js built-in test runner. Covers cryptography, transactions, blocks, chain logic, wallet encryption, and persistence.

## Quick Start

```bash
# Start a single node (interactive shell)
node index.js

# Specify port and bootstrap seed
node index.js 3000 --seed seed.femtochain.io:3000

# Run headless (no interactive CLI) with REST API
node index.js 3000 --api-port 4000 &
```

### Interactive Commands

```
ftm[3000]> create-wallet alice                    Unencrypted wallet
ftm[3000]> create-wallet -e alice                 Encrypted wallet (password prompt)
ftm[3000]> wallets                                List all wallets
ftm[3000]> mine alice                             Mine one block
ftm[3000]> start-mining alice                     Continuous mining (Ctrl+C to stop)
ftm[3000]> send alice bob 10                      Password prompt if encrypted
ftm[3000]> balance alice
ftm[3000]> info                                   Chain + node stats
ftm[3000]> connect 192.168.1.5 3000               Connect to a peer
ftm[3000]> peers                                  List connected peers
ftm[3000]> chain                                  Print full blockchain
ftm[3000]> mempool                                Show pending transactions
ftm[3000]> help                                   Print this help
ftm[3000]> exit                                   Shutdown
```

## Architecture

### Project Structure

```
lib/
  crypto.js        SHA-256 hashing, ed25519 key generation and signing
  transaction.js   Transaction class with protobuf serialization
  block.js         Block class with PoW mining, protobuf serialization, size limits
  chain.js         Blockchain state machine, difficulty adjustment, consensus rules
  wallet.js        Key pair persistence with optional scrypt + AES-256-GCM encryption
  peer.js          WebSocket peer connection wrapper
  node.js          P2P node, networking, mempool, bootstrap, event-driven broadcast
  api.js           REST API server (HTTP JSON endpoints)
proto/
  blockchain.proto Protocol Buffers schema for Transaction, Block, and Chain messages
test/
  crypto.test.js   Unit tests for hashing, key generation, signing, verification
  transaction.test.js  Unit tests for creation, signing, protobuf roundtrip, validation
  block.test.js    Unit tests for mining, protobuf roundtrip, PoW validation, size limits
  chain.test.js    Unit tests for block addition, state management, persistence, replacement
  wallet.test.js   Unit tests for save/load, encrypted keystore, wrong password rejection
  api.test.js      Integration tests for REST API endpoints
index.js           Interactive CLI entry point
Dockerfile         Multi-stage Docker build with dumb-init
docker-compose.yml 3-node cluster for local testing
```

### How Mining Works

1. The node selects pending transactions from the mempool and validates each one against the current chain state (sufficient balance, valid signature, no self-sends).
2. A coinbase transaction is created for the miner address with the block reward plus accumulated transaction fees.
3. The block is assembled with the current index, timestamp, transactions, previous block hash, and the current network difficulty.
4. The miner repeatedly increments a nonce and recomputes the block hash until the hash starts with the required number of zero bits (the difficulty target).
5. Once a valid nonce is found, the block is added to the chain. The state is updated atomically. The block is broadcast to all connected peers.

The continuous mining mode (`start-mining`) yields to the event loop every 10,000 hashes, allowing the node to handle incoming messages and maintain connectivity while mining.

### How the Chain Validates Blocks

Each incoming block goes through these checks:

1. **Index check.** The block index must be exactly one greater than the latest block.
2. **Previous hash check.** The block's `previousHash` must match the latest block's hash.
3. **Hash integrity check.** The block's announced hash must equal `computeHash()` over the serialized block data.
4. **Proof-of-Work check.** The hash must start with `difficulty` zero bits.
5. **Difficulty check.** The block difficulty must match the network's current computed difficulty.
6. **Block size check.** The encoded block must not exceed 1 MB.
7. **Coinbase check.** The first transaction must be a coinbase transaction (from address '0', no signature).
8. **Transaction validation.** Each non-coinbase transaction must have a valid signature, a sender with sufficient balance, and must not be a self-send.
9. **Reward check.** The coinbase amount must exactly equal the block reward plus the sum of all transaction fees in the block.
10. **State application.** If all checks pass, the state is updated atomically and the block is appended to the chain file on disk.

### P2P Protocol

Messages are sent as JSON envelopes over WebSocket. Block and transaction payloads are base64-encoded Protocol Buffers.

| Type       | Direction    | Purpose                                                  |
|------------|------------- |----------------------------------------------------------|
| HANDSHAKE  | bidirectional| Exchange port, chain height, latest block hash           |
| NEW_TX     | broadcast    | Gossip a new transaction (base64 protobuf payload)       |
| NEW_BLOCK  | broadcast    | Gossip a mined block (base64 protobuf payload)           |
| GET_CHAIN  | request      | Request the full chain                                   |
| CHAIN      | response     | Full chain as an array of base64 protobuf blocks         |
| GET_PEERS  | request      | Request known peers                                      |
| PEERS      | response     | List of known peers (host, port)                         |

Peer discovery happens through three mechanisms:

1. **DNS seeds.** Hardcoded bootstrap hostnames (seed.femtochain.io, seed2.femtochain.io) are resolved on startup. If DNS resolution fails, the host is connected to directly.
2. **Peer exchange.** Connected nodes share their peer lists using GET_PEERS and PEERS messages. New peers are connected to automatically.
3. **Persistence.** Known peers are saved to `data/peers.json` and reconnected on restart with a 10-second retry interval.

### Tokenomics

| Parameter              | Value                         |
|------------------------|-------------------------------|
| Genesis supply         | 0 FTM (all coins must be mined)|
| Block reward           | 50 FTM                        |
| Halving interval       | Every 210,000 blocks          |
| Minimum reward after halving | 1 FTM                   |
| Block time target      | ~30 seconds                   |
| Difficulty adjustment  | Every 10 blocks               |
| Mining algorithm       | SHA-256 Proof-of-Work         |

The genesis block has a zero-amount coinbase transaction. No coins exist until the first block is mined after genesis. Block rewards halve every 210,000 blocks (similar to Bitcoin's schedule) until reaching a floor of 1 FTM per block.

### Wallet Encryption

Wallets can be stored as plain JSON or as encrypted keystores. The encrypted format uses:

- **Key derivation.** scrypt with N=16384, r=8, p=1, producing a 32-byte key.
- **Cipher.** AES-256-GCM with a random 16-byte IV and a 16-byte authentication tag.
- **Salt.** A random 32-byte salt, unique per wallet.

The encrypted keystore format is modeled after the Ethereum keystore standard but is not identical. Wrong passwords are detected during decryption (GCM authentication tag validation will fail) rather than during a separate password check step.

## Multi-Node with Docker

```bash
# Build the image
docker build -t femtochain .

# Run a single node with persistent data
docker run -p 3000:3000 -v femto_data:/app/data -v femto_wallets:/app/wallets femtochain

# Full three-node cluster
docker-compose up --build
```

The `docker-compose.yml` starts 3 nodes connected via Docker networking. node1 is the bootstrap seed. node2 and node3 auto-connect to it using the `--seed` flag with the Docker service name as the hostname.

To mine inside a docker-compose node:

```bash
# Create a wallet
docker compose exec node1 node -e "const {Wallet}=require('./lib/wallet');const w=new Wallet('/app/wallets');w.createNew();w.save('miner1');console.log(w.address);"

# Mine one block
docker compose exec node1 node -e "const {Wallet}=require('./lib/wallet');const Blockchain=require('./lib/chain');const w=new Wallet('/app/wallets');w.load('miner1');const c=new Blockchain('/app/data');c.mineBlock(w.address);console.log('Mined. Balance:',c.getBalance(w.address));"
```

## Running Tests

```bash
npm test
```

This runs all test files in the `test/` directory using Node.js built-in test runner. Tests cover cryptography, transactions, blocks, chain validation and persistence, wallet encryption, and error handling.

For test coverage:

```bash
node --experimental-test-coverage --test
```

## AWS Deployment

### EC2

```bash
# Launch an Ubuntu 24.04 instance
# Open port 3000 (TCP) in the security group
# SSH in

sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# Log out and back in

git clone https://github.com/calcaware/FemtoCoin
cd FemtoCoin
docker compose up -d

# Set up a DNS A record (e.g. seed.femtochain.io) pointing to the instance IP
```

### ECS

1. Push the Docker image to ECR.
2. Create an ECS cluster with a service using the image.
3. Mount EFS volumes for `/app/data` and `/app/wallets`.
4. Expose port 3000.

### Kubernetes

Deploy using a StatefulSet for persistent node identities, a headless Service for peer discovery, and PersistentVolumeClaims for chain data and wallets.

## Why Protocol Buffers

The original implementation used JSON for everything. JSON-based serialization is non-deterministic (object key ordering can change) and produces larger payloads. Switching to Protocol Buffers gives:

- **Deterministic encoding.** The same data always produces the same bytes. This matters because block hashes are computed over serialized block data.
- **Smaller payloads.** Binary encoding is more compact than JSON, reducing bandwidth usage during P2P sync.
- **Cross-language compatibility.** The .proto file can be compiled to Go, Rust, Python, or any other language with protobuf support. This preserves the option to rewrite resource-intensive components in a lower-level language.
- **Industry standard.** Protocol Buffers are used by Ethereum, Cosmos, and many other blockchain projects.

## Security Considerations

- **Transaction signing.** All non-coinbase transactions are signed with the sender's ed25519 private key. The signature covers the transaction hash, which is computed over the protobuf serialization of the transaction fields. Tampering with any field after signing invalidates the signature.
- **Wallet encryption.** Encrypted wallets use scrypt with N=16384 iterations. This is a deliberate tradeoff between security and performance. The Node.js OpenSSL 3 scrypt implementation has a default memory limit of 32 MB, which caps the scrypt parameters. For production deployments, consider increasing the memory limit or using a dedicated key management solution.
- **Chain validation.** Every block received from a peer is fully validated before it is added to the chain. This includes hash integrity checks, proof-of-work verification, signature validation on every transaction, balance sufficiency checks, and coinbase amount verification.
- **Longest-chain rule.** The network follows the longest valid chain. If a peer presents a longer chain that passes all validation checks, the local chain is replaced.
- **Self-connect prevention.** Nodes refuse to connect to themselves. Peer deduplication prevents multiple connections to the same peer.

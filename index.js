#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Blockchain = require('./lib/chain');
const Transaction = require('./lib/transaction');
const Node = require('./lib/node');
const { Wallet } = require('./lib/wallet');
const { COIN, toFTM, parseFTM } = require('./lib/unit');

const DATA_DIR = path.join(__dirname, 'data');
const WALLET_DIR = path.join(__dirname, 'wallets');

const walletPasswords = new Map();

function main() {
  const args = process.argv.slice(2);
  const seeds = [];
  let port = 3000;
  let headless = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' || args[i] === '-s') {
      const parts = args[++i].split(':');
      seeds.push({ host: parts[0], port: parseInt(parts[1]) || 3000 });
    } else if (args[i] === '--headless' || args[i] === '-h') {
      headless = true;
    } else if (/^\d+$/.test(args[i])) {
      port = parseInt(args[i]);
    } else if (!/^-/.test(args[i])) {
      return runCommand(args);
    }
  }

  if (headless || !process.stdin.isTTY) {
    startNonInteractive(port, seeds);
  } else {
    startInteractive(port, seeds);
  }
}

function startInteractive(port, seeds = []) {
  const chain = new Blockchain(DATA_DIR);
  const node = new Node(port, chain, DATA_DIR, seeds);
  node.start();

  console.log(`FemtoChain node running on ws://localhost:${port}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\x1b[36mftm[${port}]\x1b[0m `,
    terminal: true
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    if (!cmd) { rl.prompt(); return; }

    try {
      await handleCmd(cmd, parts.slice(1), node, rl);
    } catch (err) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    node.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => rl.close());
}

function startNonInteractive(port, seeds = []) {
  const chain = new Blockchain(DATA_DIR);
  const node = new Node(port, chain, DATA_DIR, seeds);
  node.start();
  console.log(`FemtoChain node running on ws://localhost:${port}`);
  process.on('SIGINT', () => { node.stop(); process.exit(0); });
  process.on('SIGTERM', () => { node.stop(); process.exit(0); });
}

async function handleCmd(cmd, args, node, rl) {
  switch (cmd) {
    case 'help':
      return help();
    case 'create-wallet':
      return createWallet(args, rl);
    case 'wallets':
      return listWallets();
    case 'mine':
      return mine(args[0], node, rl);
    case 'start-mining':
    case 'mine-continuous':
      return startMining(args[0], node, rl);
    case 'send':
      return send(args[0], args[1], args[2], node, rl);
    case 'balance':
      return balance(args[0], node);
    case 'info':
      return info(node);
    case 'chain':
      return printChain(node);
    case 'connect':
      return connect(args[0], args[1], node);
    case 'peers':
      return printPeers(node);
    case 'mempool':
      return mempoolInfo(node);
    case 'exit':
    case 'quit':
      return rl.close();
    default:
      console.log(`Unknown: ${cmd}. Type 'help'`);
  }
}

async function getPassword(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function loadWalletWithPassword(name, rl) {
  const wallet = new Wallet(WALLET_DIR);
  if (wallet.isEncrypted(name)) {
    let password = walletPasswords.get(name);
    if (!password) {
      password = await getPassword(rl, `Password for "${name}": `);
      walletPasswords.set(name, password);
    }
    wallet.load(name, password);
  } else {
    wallet.load(name);
  }
  return wallet;
}

function resolveAddress(arg) {
  const walletPath = path.join(WALLET_DIR, `${arg}.json`);
  if (fs.existsSync(walletPath)) {
    const data = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return data.address;
  }
  return arg;
}

function help() {
  console.log(`
\x1b[1mFemtoChain v2\x1b[0m

  create-wallet <name>         Create an unencrypted wallet
  create-wallet -e <name>      Create an encrypted wallet (password-protected)
  wallets                      List all wallets
  mine <wallet>                Mine one block
  start-mining <wallet>        Continuously mine blocks (Ctrl+C to stop)
  send <from> <to> <amount>    Send coins
  balance <name|address>       Check balance
  info                         Chain summary
  chain                        Print chain
  connect <host> <port>        Connect to a peer
  peers                        List connected peers
  mempool                      Pending transactions
  exit                         Shutdown

Run headless:  node index.js --headless 3000
REST API:      node server/api.js --port 4000 --data-dir ./data
Explorer:      open explorer/index.html in a browser
`);
}

async function createWallet(args, rl) {
  const encrypted = args[0] === '-e' || args[0] === '--encrypted';
  const name = encrypted ? args[1] : args[0];
  if (!name) throw new Error('Usage: create-wallet [-e] <name>');

  const wallet = new Wallet(WALLET_DIR);
  wallet.createNew();

  if (encrypted) {
    const pw = await getPassword(rl, 'Password: ');
    const pw2 = await getPassword(rl, 'Confirm: ');
    if (pw !== pw2) throw new Error('Passwords do not match');
    wallet.saveEncrypted(name, pw);
    walletPasswords.set(name, pw);
    console.log(`Encrypted wallet \x1b[33m${name}\x1b[0m created`);
  } else {
    wallet.save(name);
    console.log(`Wallet \x1b[33m${name}\x1b[0m created`);
  }
  console.log(`Address: \x1b[32m${wallet.address}\x1b[0m`);
}

function listWallets() {
  if (!fs.existsSync(WALLET_DIR)) { console.log('No wallets.'); return; }
  const files = fs.readdirSync(WALLET_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.log('No wallets.'); return; }
  for (const f of files) {
    const name = f.replace('.json', '');
    const raw = JSON.parse(fs.readFileSync(path.join(WALLET_DIR, f), 'utf8'));
    const enc = raw.crypto ? '\x1b[33m[encrypted]\x1b[0m' : '';
    console.log(`  \x1b[33m${name}\x1b[0m -> ${raw.address.slice(0, 20)}... ${enc}`);
  }
}

async function mine(walletName, node, rl) {
  if (!walletName) throw new Error('Usage: mine <wallet>');
  const wallet = await loadWalletWithPassword(walletName, rl);

  const txs = [...node.mempool.values()];
  const block = node.chain.createBlock(wallet.address, txs);

  console.log(`Mining #${block.index} (diff ${block.difficulty}, ${txs.length} txs)...`);
  rl.pause();

  await block.mineAsync((nonce, hash) => {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`  nonce: ${nonce}  hash: ${hash.slice(0, 20)}...`);
  });

  console.log('\n');

  if (node.chain.addBlock(block)) {
    console.log(`\x1b[32mBlock #${block.index} mined!\x1b[0m`);
    console.log(`  Hash:   ${block.hash}`);
    console.log(`  Reward: ${toFTM(block.transactions[0].amount)}`);
  } else {
    console.log('\x1b[31mMining failed (chain changed)\x1b[0m');
  }
  rl.resume();
}

async function startMining(walletName, node, rl) {
  if (!walletName) throw new Error('Usage: start-mining <wallet>');
  const wallet = await loadWalletWithPassword(walletName, rl);

  console.log('\x1b[32mContinuous mining started. Press Ctrl+C to stop.\x1b[0m');
  rl.pause();

  let mining = true;
  const stop = () => { mining = false; };
  process.on('SIGINT', stop);

  while (mining) {
    const txs = [...node.mempool.values()];
    const block = node.chain.createBlock(wallet.address, txs);
    console.log(`\nMining #${block.index} (diff ${block.difficulty}, ${txs.length} txs)...`);

    await block.mineAsync((nonce, hash) => {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`  nonce: ${nonce}  hash: ${hash.slice(0, 20)}...`);
    });

    console.log('\n');

    if (node.chain.addBlock(block)) {
      console.log(`\x1b[32mBlock #${block.index} mined!\x1b[0m  Reward: ${toFTM(block.transactions[0].amount)}`);
    } else {
      console.log('\x1b[31mBlock failed (chain updated from peer)\x1b[0m');
    }
  }

  process.removeListener('SIGINT', stop);
  console.log('\nMining stopped.');
  rl.resume();
}

async function send(fromName, toArg, amountStr, node, rl) {
  if (!fromName || !toArg || !amountStr) throw new Error('Usage: send <from> <to> <amount>');
  const amount = parseFTM(amountStr);
  if (amount < COIN) throw new Error('Minimum send is 0.000000000000001 FTM');

  const fromWallet = await loadWalletWithPassword(fromName, rl);
  const toAddress = resolveAddress(toArg);

  const tx = node.chain.createTransaction(
    fromWallet.keypair.privateKey,
    fromWallet.keypair.publicKey,
    toAddress,
    amount
  );

  node.mempool.set(tx.hash(), tx);
  node._broadcast('NEW_TX', tx.toBase64());
  console.log(`Tx created: ${tx.hash().slice(0, 20)}... (${toFTM(amount)} to ${toAddress.slice(0, 20)}...)`);
  console.log('Mine a block to confirm it.');
}

function balance(nameOrAddress, node) {
  if (!nameOrAddress) throw new Error('Usage: balance <name|address>');
  const address = resolveAddress(nameOrAddress);
  const bal = node.chain.getBalance(address);
  const label = address === nameOrAddress ? `\x1b[32m${address}\x1b[0m` : `\x1b[33m${nameOrAddress}\x1b[0m`;
  console.log(`${label}: \x1b[1m${toFTM(bal)}\x1b[0m`);
}

function info(node) {
  const c = node.chain;
  const latest = c.getLatestBlock();
  console.log('\x1b[1mFemtoChain\x1b[0m');
  console.log(`  Blocks:     ${c.getBlockCount()}`);
  console.log(`  Supply:     ${toFTM(c.getSupply())}`);
  console.log(`  Peers:      ${node.peers.size}`);
  console.log(`  Mempool:    ${node.mempool.size} txs`);
  console.log(`  Difficulty: ${c.getDifficulty()}`);
  console.log(`  Reward:     ${toFTM(c.getBlockReward())}/block`);
  console.log(`  Latest:     ${latest.hash.slice(0, 30)}...`);
  console.log(`  Valid:      ${c.isValid() ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`);
}

function printChain(node) {
  for (const block of node.chain.chain) {
    const short = block.hash.slice(0, 12);
    const time = new Date(block.timestamp).toISOString().replace('T', ' ').slice(0, 19);
    const txs = block.transactions.length;
    console.log(`\x1b[90m#${block.index}\x1b[0m [${short}] ${time} \x1b[90m(${txs} txs, diff ${block.difficulty})\x1b[0m`);
    for (const tx of block.transactions) {
      if (tx.isCoinbase()) {
        console.log(`  \x1b[32m+${toFTM(tx.amount)}\x1b[0m -> ${tx.to.slice(0, 16)}...`);
      } else {
        console.log(`  ${tx.from.slice(0, 12)}... -> ${tx.to.slice(0, 12)}... : ${toFTM(tx.amount, false)} (fee ${toFTM(tx.fee, false)})`);
      }
    }
  }
  console.log(`Valid: ${node.chain.isValid() ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`);
}

function connect(host, portStr, node) {
  if (!host || !portStr) throw new Error('Usage: connect <host> <port>');
  node.connectToPeer(host, parseInt(portStr));
  console.log(`Connecting to ${host}:${portStr}...`);
}

function printPeers(node) {
  const peers = node.getPeerList();
  if (peers.length === 0) { console.log('No connected peers.'); return; }
  for (const p of peers) {
    const addr = p.host ? `${p.host}:${p.port}` : 'incoming';
    console.log(`  ${addr}  height: ${p.height}  ${p.connected ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`);
  }
}

function mempoolInfo(node) {
  const size = node.mempool.size;
  if (size === 0) { console.log('Mempool empty.'); return; }
  console.log(`Mempool: ${size} pending transactions`);
  for (const tx of node.mempool.values()) {
    console.log(`  ${tx.hash().slice(0, 16)}...  ${tx.from.slice(0, 12)}... -> ${tx.to.slice(0, 12)}...  ${toFTM(tx.amount)}`);
  }
}

function runCommand(args) {
  const cmd = args[0];
  switch (cmd) {
    case 'create-wallet':
      return runCreateWallet(args);
    case 'wallets':
      return runListWallets();
    default:
      console.log(`Standalone: ${cmd}`);
      console.log('Start a node with: node index.js [port]');
  }
}

function runCreateWallet(args) {
  const encrypted = args[1] === '-e' || args[1] === '--encrypted';
  const name = encrypted ? args[2] : args[1];
  if (!name) throw new Error('Usage: node index.js create-wallet [-e] <name>');

  const wallet = new Wallet(WALLET_DIR);
  wallet.createNew();

  if (encrypted) {
    console.log('Encrypted wallets require interactive mode.');
    console.log('Start a node with: node index.js');
    return;
  }

  wallet.save(name);
  console.log(`Wallet: ${name}`);
  console.log(`Address: ${wallet.address}`);
}

function runListWallets() {
  if (!fs.existsSync(WALLET_DIR)) { console.log('No wallets.'); return; }
  const files = fs.readdirSync(WALLET_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.log('No wallets.'); return; }
  for (const f of files) {
    const name = f.replace('.json', '');
    const raw = JSON.parse(fs.readFileSync(path.join(WALLET_DIR, f), 'utf8'));
    console.log(`  ${name} -> ${raw.address}${raw.crypto ? ' [encrypted]' : ''}`);
  }
}

main();

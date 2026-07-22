'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

function findTorBinary() {
  const candidates = ['/opt/homebrew/bin/tor', '/usr/local/bin/tor', '/usr/bin/tor'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const result = execFileSync('/usr/bin/which', ['tor'], { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {}
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function portOpen(port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function findExistingTorPort() {
  for (const port of [9050, 9150]) {
    if (await portOpen(port)) return port;
  }
  return null;
}

function quoteTorPath(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function startTorRuntime(userDataPath, screenCount = 4, onLog = () => {}) {
  const existingPort = await findExistingTorPort();
  if (existingPort) {
    onLog(`Using existing Tor SOCKS service on 127.0.0.1:${existingPort}`);
    return {
      socksPorts: Array(screenCount).fill(existingPort),
      managed: false,
      logs: [`Existing Tor service detected on port ${existingPort}`],
      getUnsafeDnsAttempts: () => 0,
      stop: () => {},
    };
  }

  const torBinary = findTorBinary();
  if (!torBinary) {
    throw new Error('Tor is not installed. Run: brew install tor');
  }

  const socksPort = await freePort();
  const runId = `${Date.now()}-${process.pid}`;
  const root = path.join(userDataPath, 'relay-tor', runId);
  const dataDirectory = path.join(root, 'data');
  const configPath = path.join(root, 'torrc');
  fs.mkdirSync(dataDirectory, { recursive: true });

  const config = [
    `DataDirectory ${quoteTorPath(dataDirectory)}`,
    'ClientOnly 1',
    'AvoidDiskWrites 1',
    'SafeSocks 1',
    'TestSocks 1',
    'ControlPort 0',
    'DNSPort 0',
    `SocksPort 127.0.0.1:${socksPort} IsolateSOCKSAuth`,
    'SocksPolicy accept 127.0.0.1',
    'SocksPolicy reject *',
    'Log notice stdout',
  ].join('\n');
  fs.writeFileSync(configPath, `${config}\n`);

  onLog(`Starting managed Tor from ${torBinary}`);
  onLog(`Managed Tor SOCKS port: ${socksPort}`);

  const child = spawn(torBinary, ['-f', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: process.env.HOME || userDataPath },
  });

  const logs = [];
  let unsafeDnsAttempts = 0;
  let settled = false;
  let bootstrapped = false;

  const pushLine = (line) => {
    const clean = String(line || '').trim();
    if (!clean) return;
    logs.push(clean);
    if (logs.length > 250) logs.shift();
    onLog(clean);
    if (/unsafe socks|dns.*leak|leaking dns/i.test(clean)) unsafeDnsAttempts += 1;
  };

  const boot = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Tor did not finish bootstrapping. ${logs.slice(-12).join(' | ')}`));
    }, 65000);

    const handle = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        pushLine(line);
        if (!settled && /Bootstrapped 100%/i.test(line)) {
          settled = true;
          bootstrapped = true;
          clearTimeout(timeout);
          resolve();
        }
      }
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      pushLine(`Tor process exited with code ${code ?? 'none'}${signal ? `, signal ${signal}` : ''}`);
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Tor stopped before connecting (exit code ${code ?? 'unknown'}). ${logs.slice(-15).join(' | ')}`));
    });
  });

  try {
    await boot;
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    throw error;
  }

  return {
    socksPorts: Array(screenCount).fill(socksPort),
    managed: true,
    logs,
    getUnsafeDnsAttempts: () => unsafeDnsAttempts,
    stop: () => {
      if (bootstrapped && !child.killed) child.kill('SIGTERM');
    },
  };
}

module.exports = {
  findTorBinary,
  freePort,
  portOpen,
  findExistingTorPort,
  startTorRuntime,
};

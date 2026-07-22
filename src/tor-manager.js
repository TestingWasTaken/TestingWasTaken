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
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
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

function emit(onLog, level, message, detail = '') {
  try { onLog({ level, message, detail }); } catch {}
}

async function startTorRuntime(userDataPath, screenCount = 4, onLog = () => {}) {
  const existingPort = await findExistingTorPort();
  if (existingPort) {
    emit(onLog, 'info', `Using existing Tor SOCKS service on port ${existingPort}`);
    return {
      source: 'existing',
      sourceDescription: `Existing Tor service on 127.0.0.1:${existingPort}`,
      socksPorts: Array(screenCount).fill(existingPort),
      logs: [`Existing Tor service found on port ${existingPort}`],
      getUnsafeDnsAttempts: () => 0,
      stop: () => {},
    };
  }

  const torBinary = findTorBinary();
  if (!torBinary) {
    const error = new Error('Tor is not installed. Run Install Tor.command or: brew install tor');
    error.torLogs = [];
    throw error;
  }

  const socksPorts = [];
  for (let index = 0; index < screenCount; index += 1) socksPorts.push(await freePort());

  const runName = `run-${Date.now()}-${process.pid}`;
  const root = path.join(userDataPath, 'relay-tor', runName);
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
    ...socksPorts.map((port) => `SocksPort 127.0.0.1:${port} IsolateSOCKSAuth`),
    'SocksPolicy accept 127.0.0.1',
    'SocksPolicy reject *',
    'Log notice stdout',
  ].join('\n');
  fs.writeFileSync(configPath, `${config}\n`);

  emit(onLog, 'info', 'Starting a private Tor runtime', `Binary: ${torBinary}\nData: ${dataDirectory}`);
  const child = spawn(torBinary, ['-f', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: process.env.HOME || userDataPath },
  });

  const logs = [];
  let unsafeDnsAttempts = 0;
  let settled = false;
  let lineRemainder = '';

  const handle = (chunk) => {
    const text = lineRemainder + String(chunk);
    const lines = text.split(/\r?\n/);
    lineRemainder = lines.pop() || '';
    for (const line of lines.filter(Boolean)) {
      logs.push(line);
      if (logs.length > 300) logs.shift();
      if (/unsafe socks|dns.*leak|leaking dns/i.test(line)) unsafeDnsAttempts += 1;
      const bootMatch = line.match(/Bootstrapped\s+(\d+)%[^:]*:\s*(.*)$/i);
      if (bootMatch) emit(onLog, 'info', `Tor bootstrap ${bootMatch[1]}%`, bootMatch[2]);
      else if (/warn|error|failed/i.test(line)) emit(onLog, 'warn', 'Tor message', line);
    }
  };

  const boot = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error('Tor did not finish connecting within 75 seconds.');
      error.torLogs = logs.slice(-20);
      reject(error);
    }, 75000);

    const inspectForReady = (chunk) => {
      handle(chunk);
      if (!settled && /Bootstrapped 100%/i.test(String(chunk))) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout.on('data', inspectForReady);
    child.stderr.on('data', inspectForReady);
    child.once('error', (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const error = new Error(`Tor could not be started: ${cause.message}`);
      error.torLogs = logs.slice(-20);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) {
        emit(onLog, code === 0 ? 'info' : 'warn', 'Private Tor process stopped', `Exit code: ${code}; signal: ${signal || 'none'}`);
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const tail = logs.slice(-20);
      const error = new Error(`Tor stopped before connecting (exit code ${code ?? 'unknown'}).`);
      error.torLogs = tail;
      reject(error);
    });
  });

  try {
    await boot;
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    emit(onLog, 'error', error.message, (error.torLogs || []).join('\n'));
    throw error;
  }

  emit(onLog, 'info', 'Private Tor connected', `SOCKS ports: ${socksPorts.join(', ')}`);
  return {
    source: 'private',
    sourceDescription: `Private Tor runtime (${socksPorts.length} isolated listeners)`,
    socksPorts,
    logs,
    getUnsafeDnsAttempts: () => unsafeDnsAttempts,
    stop: () => {
      if (!child.killed) child.kill('SIGTERM');
      setTimeout(() => {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
      }, 1200);
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

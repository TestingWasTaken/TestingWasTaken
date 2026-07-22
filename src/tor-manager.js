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

function quoteTorPath(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function startTorRuntime(userDataPath, screenCount = 4) {
  const torBinary = findTorBinary();
  if (!torBinary) throw new Error('Tor is not installed. Run: brew install tor');

  const socksPorts = [];
  for (let index = 0; index < screenCount; index += 1) socksPorts.push(await freePort());

  const root = path.join(userDataPath, 'relay-tor');
  const dataDirectory = path.join(root, 'data');
  const configPath = path.join(root, 'torrc');
  fs.mkdirSync(dataDirectory, { recursive: true });
  try { fs.rmSync(path.join(dataDirectory, 'lock')); } catch {}

  const config = [
    `DataDirectory ${quoteTorPath(dataDirectory)}`,
    'ClientOnly 1',
    'AvoidDiskWrites 1',
    'SafeSocks 1',
    'TestSocks 1',
    'ControlPort 0',
    'DNSPort 0',
    ...socksPorts.map((port) => `SocksPort 127.0.0.1:${port}`),
    'SocksPolicy accept 127.0.0.1',
    'SocksPolicy reject *',
    'Log notice stdout',
  ].join('\n');
  fs.writeFileSync(configPath, `${config}\n`);

  const child = spawn(torBinary, ['-f', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  let unsafeDnsAttempts = 0;
  let settled = false;

  const boot = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Tor did not finish bootstrapping. ${logs.slice(-6).join(' | ')}`));
    }, 60000);

    const handle = (chunk) => {
      const lines = String(chunk).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        logs.push(line);
        if (logs.length > 200) logs.shift();
        if (/unsafe socks|dns.*leak|leaking dns/i.test(line)) unsafeDnsAttempts += 1;
        if (!settled && /Bootstrapped 100%/i.test(line)) {
          settled = true;
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
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Tor exited before connecting (code ${code}). ${logs.slice(-6).join(' | ')}`));
    });
  });

  try {
    await boot;
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }

  return {
    socksPorts,
    logs,
    getUnsafeDnsAttempts: () => unsafeDnsAttempts,
    stop: () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

module.exports = { findTorBinary, freePort, startTorRuntime };

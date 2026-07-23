'use strict';

const { ipcMain } = require('electron');

const MAX_PANES = 8;
const panes = new Map();

function rememberPane(event, payload) {
  const pane = Number(payload?.paneNumber);
  if (!Number.isInteger(pane) || pane < 1 || pane > MAX_PANES) return;
  panes.set(pane, event.sender);
}

async function fetchWithTimeout(session, url, timeoutMs, asJSON) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await session.fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: asJSON ? 'application/json' : 'text/plain' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return asJSON ? response.json() : response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function cleanIP(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f:.]+$/i.test(text) ? text : '';
}

async function lookupIP(contents) {
  if (!contents || contents.isDestroyed()) return { ok: false, error: 'Screen unavailable' };
  const session = contents.session;
  const attempts = [
    async () => cleanIP((await fetchWithTimeout(session, 'https://api64.ipify.org?format=json', 6000, true))?.ip),
    async () => cleanIP(await fetchWithTimeout(session, 'https://icanhazip.com/', 6000, false)),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const ip = await attempt();
      if (ip) return { ok: true, ip };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, error: lastError?.message || 'IP address unavailable' };
}

ipcMain.on('register-pane-v18', rememberPane);
ipcMain.on('pane-state-v18', rememberPane);

ipcMain.handle('v25-check-ip-fallbacks', async (_event, countValue) => {
  const count = Math.max(1, Math.min(MAX_PANES, Number(countValue) || 4));
  return Promise.all(Array.from({ length: count }, async (_unused, index) => {
    const paneNumber = index + 1;
    const result = await lookupIP(panes.get(paneNumber));
    return { paneNumber, ...result };
  }));
});

module.exports = { cleanIP };

'use strict';

const { ipcMain } = require('electron');
const sync = require('./main-v26-sync');

const MAX_PANES = 8;
const panes = new Map();
const recovery = new Map();
const destroyHooks = new Set();

const live = (contents) => Boolean(contents && !contents.isDestroyed());

function paneNumberFrom(payload) {
  const pane = Number(payload?.paneNumber);
  return Number.isInteger(pane) && pane >= 1 && pane <= MAX_PANES ? pane : 0;
}

function rememberPane(event, payload) {
  const pane = paneNumberFrom(payload);
  if (!pane) return;
  panes.set(pane, event.sender);
  if (destroyHooks.has(event.sender.id)) return;
  destroyHooks.add(event.sender.id);
  event.sender.once('destroyed', () => {
    destroyHooks.delete(event.sender.id);
    if (panes.get(pane)?.id === event.sender.id) panes.delete(pane);
    recovery.delete(pane);
  });
}

function normalizeURL(value) {
  try {
    return new URL(String(value || '')).href;
  } catch {
    return String(value || '').trim();
  }
}

function validTarget(value) {
  const url = normalizeURL(value);
  return /^(https?:|file:|relay:)/i.test(url) ? url : '';
}

function sendRecovery(pane, value) {
  const contents = panes.get(pane);
  if (live(contents)) contents.send('v27-recovery', value);
}

function clearRecovery(pane) {
  if (!recovery.has(pane)) return;
  recovery.delete(pane);
  sendRecovery(pane, { active: false });
}

function clearAllRecovery() {
  for (let pane = 2; pane <= MAX_PANES; pane += 1) clearRecovery(pane);
}

function recoveryMessage(contents, item, score) {
  if (contents.isLoading()) return 'Waiting for the page to finish loading…';
  if (item.mode === 'state' && Number.isFinite(score)) return `Repairing page state · ${score}% synchronized`;
  if (item.attempts === 0) return 'Checking the page against Screen 1…';
  return `Reconnecting to Screen 1 · attempt ${item.attempts}`;
}

function checkFollowers() {
  const health = sync.healthSnapshot();
  const followingEnabled = health?.followingEnabled === true;
  const navigationEnabled = followingEnabled && health?.policy?.navigation === true;
  const targetURL = navigationEnabled ? validTarget(health?.rows?.[0]?.url) : '';

  if (!followingEnabled) {
    clearAllRecovery();
    return;
  }

  const now = Date.now();
  for (let pane = 2; pane <= Number(health.visiblePaneCount || 1); pane += 1) {
    const row = health.rows?.find((item) => item.paneNumber === pane);
    const contents = panes.get(pane);

    if (!row?.registered || row.paused || row.challenge || !live(contents)) {
      clearRecovery(pane);
      continue;
    }

    const actualURL = normalizeURL(contents.getURL());
    const urlBehind = Boolean(targetURL) && actualURL !== targetURL;
    const score = Number(row.syncScore);
    const stateBehind = Number.isFinite(score) && score < 65;

    if (!urlBehind && !stateBehind) {
      clearRecovery(pane);
      continue;
    }

    const mode = urlBehind ? 'url' : 'state';
    const recoveryKey = `${mode}:${targetURL || actualURL}`;
    let item = recovery.get(pane);
    if (!item || item.key !== recoveryKey) {
      item = {
        key: recoveryKey,
        mode,
        targetURL,
        since: now,
        attempts: 0,
        lastAttemptAt: 0,
        nextAttemptAt: now + (urlBehind ? 650 : 1000),
      };
      recovery.set(pane, item);
    }

    const elapsed = now - item.since;
    const displayDelay = item.mode === 'url' ? 450 : 850;
    if (elapsed >= displayDelay) {
      sendRecovery(pane, {
        active: true,
        title: item.mode === 'url' ? 'Catching up' : 'Synchronizing',
        message: recoveryMessage(contents, item, score),
        attempt: item.attempts,
      });
    }

    if (elapsed < displayDelay || now < item.nextAttemptAt) continue;
    if (contents.isLoading() && now - item.lastAttemptAt < 2600) continue;

    item.attempts += 1;
    item.lastAttemptAt = now;
    item.nextAttemptAt = now + Math.min(5000, 900 + (item.attempts * 700));

    if (item.mode === 'url' && item.targetURL) {
      sendRecovery(pane, {
        active: true,
        title: 'Synchronizing',
        message: `Opening the Screen 1 address · attempt ${item.attempts}`,
        attempt: item.attempts,
      });
      try {
        if (contents.isLoading()) contents.stop();
        contents.loadURL(item.targetURL).catch(() => {});
      } catch {}
    } else {
      sendRecovery(pane, {
        active: true,
        title: 'Synchronizing',
        message: `Reapplying Screen 1 state · attempt ${item.attempts}`,
        attempt: item.attempts,
      });
    }

    setTimeout(() => {
      try { sync.fullResync(); } catch {}
    }, 180);
  }
}

ipcMain.on('v26-register', rememberPane);
ipcMain.on('v26-state', rememberPane);

const watchdog = setInterval(checkFollowers, 450);
watchdog.unref?.();

module.exports = { checkFollowers, normalizeURL };

'use strict';

const { BrowserWindow, ipcMain } = require('electron');

const MAX_PANES = 8;
const panes = new Map();
const paused = new Set();
const quality = new Map();
const navigationLocks = new Map();
const pendingActions = new Map();

let visibleCount = 4;
let enabled = false;
let policy = { navigation: false, scrolling: false, typing: false, clicks: false };
let lastHeartbeat = null;
let lastDirectScrollAt = 0;
let actionSequence = 0;
let qualityTimer = null;

const live = (contents) => Boolean(contents && !contents.isDestroyed());

function uiWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
}

function rememberPane(event, payload) {
  const pane = Number(payload?.paneNumber);
  if (!Number.isInteger(pane) || pane < 1 || pane > MAX_PANES) return 0;
  panes.set(pane, event.sender);
  return pane;
}

function activeFollowers() {
  const result = [];
  for (let pane = 2; pane <= visibleCount; pane += 1) {
    const contents = panes.get(pane);
    if (live(contents) && !paused.has(pane)) result.push([pane, contents]);
  }
  return result;
}

function sendConfiguration() {
  for (let pane = 1; pane <= visibleCount; pane += 1) {
    const contents = panes.get(pane);
    if (!live(contents)) continue;
    contents.send('sync-enabled-v25', {
      enabled,
      policy: { ...policy },
      paused: paused.has(pane),
    });
  }
}

function syncScore(ack) {
  if (!ack) return 0;
  const urlPoints = policy.navigation ? (ack.urlMatch ? 45 : 0) : 45;
  const scrollDifference = Math.max(0, Number(ack.scrollDifference) || 0);
  const scrollPoints = policy.scrolling
    ? Math.max(0, 35 - Math.min(35, scrollDifference * 900))
    : 35;
  const total = Math.max(0, Number(ack.controlsTotal) || 0);
  const matched = Math.max(0, Number(ack.controlsMatched) || 0);
  const controlsRatio = total > 0 ? Math.min(1, matched / total) : 1;
  const controlPoints = (policy.typing || policy.clicks) ? 20 * controlsRatio : 20;
  return Math.max(0, Math.min(100, Math.round(urlPoints + scrollPoints + controlPoints)));
}

function qualitySnapshot() {
  const now = Date.now();
  const rows = [];

  for (let pane = 2; pane <= visibleCount; pane += 1) {
    const ack = quality.get(pane);
    const age = ack ? now - ack.receivedAt : null;
    const stale = !ack || age > 1800;
    const score = paused.has(pane) ? null : stale ? 0 : ack.score;
    let status = 'Reconnecting';
    if (paused.has(pane)) status = 'Paused';
    else if (!enabled) status = 'Independent';
    else if (!stale && score >= 96) status = 'Synced';
    else if (!stale && score >= 75) status = 'Catching up';
    else if (!stale) status = 'Resyncing';

    rows.push({
      paneNumber: pane,
      score,
      status,
      ageMs: age,
      urlMatch: Boolean(ack?.urlMatch),
      scrollDifference: ack?.scrollDifference ?? null,
      controlsMatched: ack?.controlsMatched ?? 0,
      controlsTotal: ack?.controlsTotal ?? 0,
    });
  }

  const scored = rows.filter((row) => Number.isFinite(row.score));
  const average = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + row.score, 0) / scored.length)
    : null;

  return {
    enabled,
    visibleCount,
    policy: { ...policy },
    average,
    syncedFollowers: rows.filter((row) => row.status === 'Synced').length,
    rows,
  };
}

function broadcastQuality(delay = 70) {
  clearTimeout(qualityTimer);
  qualityTimer = setTimeout(() => {
    qualityTimer = null;
    uiWindow()?.webContents.send('sync-quality-v25', qualitySnapshot());
  }, delay);
}

function followHeartbeatURL(heartbeat) {
  if (!enabled || !policy.navigation) return;
  const targetURL = String(heartbeat?.state?.url || '');
  if (!targetURL || !/^(https?:|file:|relay:)/i.test(targetURL)) return;

  for (const [pane, contents] of activeFollowers()) {
    if (contents.getURL() === targetURL) continue;
    const lock = navigationLocks.get(pane);
    if (lock?.url === targetURL && Date.now() - lock.time < 1400) continue;
    navigationLocks.set(pane, { url: targetURL, time: Date.now() });
    contents.loadURL(targetURL).catch(() => {});
  }
}

function distributeHeartbeat(heartbeat, force = false) {
  if (!enabled || !heartbeat) return;
  followHeartbeatURL(heartbeat);

  const includeScroll = policy.scrolling && (force || Date.now() - lastDirectScrollAt > 240);
  for (const [_pane, contents] of activeFollowers()) {
    contents.send('sync-heartbeat-v25', {
      ...heartbeat,
      policy: { ...policy },
      includeScroll,
    });
  }
}

function forceHeartbeat() {
  const leader = panes.get(1);
  if (live(leader)) leader.send('force-leader-heartbeat-v25');
  if (lastHeartbeat) distributeHeartbeat(lastHeartbeat, true);
}

function actionCategory(action) {
  if (action?.kind === 'navigate') return 'navigation';
  if (action?.kind === 'click') return 'clicks';
  if (action?.kind === 'input' || action?.kind === 'key') return 'typing';
  return '';
}

ipcMain.on('register-pane-v18', (event, payload) => {
  const pane = rememberPane(event, payload);
  if (!pane) return;
  event.sender.send('sync-enabled-v25', {
    enabled,
    policy: { ...policy },
    paused: paused.has(pane),
  });
  if (enabled && pane > 1) setTimeout(forceHeartbeat, 30);
  broadcastQuality(30);
});

ipcMain.on('pane-state-v18', rememberPane);

ipcMain.on('leader-scroll-direct-v22', (event) => {
  if (event.sender.id === panes.get(1)?.id) lastDirectScrollAt = Date.now();
});

ipcMain.on('leader-heartbeat-v25', (event, payload) => {
  const pane = rememberPane(event, payload);
  if (pane !== 1 || !enabled) return;
  lastHeartbeat = {
    sequence: Number(payload?.sequence) || Date.now(),
    state: payload?.state || {},
    controls: Array.isArray(payload?.controls) ? payload.controls : [],
    sentAt: Date.now(),
  };
  distributeHeartbeat(lastHeartbeat);
});

ipcMain.on('sync-ack-v25', (event, payload) => {
  const pane = rememberPane(event, payload);
  if (pane < 2 || pane > visibleCount) return;
  const ack = {
    urlMatch: payload?.urlMatch === true,
    scrollDifference: Math.max(0, Number(payload?.scrollDifference) || 0),
    controlsMatched: Math.max(0, Number(payload?.controlsMatched) || 0),
    controlsTotal: Math.max(0, Number(payload?.controlsTotal) || 0),
    receivedAt: Date.now(),
  };
  ack.score = syncScore(ack);
  quality.set(pane, ack);
  broadcastQuality();
});

ipcMain.on('leader-action-v25', (event, payload) => {
  if (!enabled || event.sender.id !== panes.get(1)?.id) return;
  const action = payload?.action;
  const category = actionCategory(action);
  if (!category || policy[category] !== true) return;
  if (action.kind === 'navigate') {
    setTimeout(forceHeartbeat, 40);
    return;
  }

  for (const [pane, contents] of activeFollowers()) {
    const actionId = `c25-${++actionSequence}-${pane}`;
    pendingActions.set(actionId, { pane, contents, action, attempts: 1 });
    contents.send('replay-action-v18', { actionId, action });
  }
});

ipcMain.on('replay-result-v18', (event, payload) => {
  const pane = rememberPane(event, payload);
  const actionId = String(payload?.actionId || '');
  const pending = pendingActions.get(actionId);
  if (!pending || pending.pane !== pane) return;

  if (payload?.result?.ok === false && pending.attempts < 2 && live(pending.contents)) {
    pending.attempts += 1;
    setTimeout(() => {
      if (live(pending.contents)) {
        pending.contents.send('replay-action-v18', { actionId, action: pending.action });
      }
    }, 90);
    return;
  }

  pendingActions.delete(actionId);
  if (payload?.result?.ok === false) setTimeout(forceHeartbeat, 30);
});

ipcMain.handle('v25-configure-sync', (_event, next = {}) => {
  if (Number.isFinite(Number(next.visibleCount))) {
    visibleCount = Math.max(1, Math.min(MAX_PANES, Number(next.visibleCount)));
  }
  if (typeof next.enabled === 'boolean') enabled = next.enabled;
  if (next.policy && typeof next.policy === 'object') {
    policy = {
      navigation: next.policy.navigation === true,
      scrolling: next.policy.scrolling === true,
      typing: next.policy.typing === true,
      clicks: next.policy.clicks === true,
    };
  }
  if (next.pause && Number.isInteger(Number(next.pause.pane))) {
    const pane = Number(next.pause.pane);
    if (next.pause.paused) paused.add(pane);
    else paused.delete(pane);
  }
  if (!enabled) quality.clear();
  sendConfiguration();
  if (enabled) setTimeout(forceHeartbeat, 20);
  broadcastQuality(10);
  return qualitySnapshot();
});

ipcMain.handle('v25-resync-followers', async () => {
  navigationLocks.clear();
  quality.clear();
  sendConfiguration();
  for (const delay of [0, 120, 360, 760]) {
    setTimeout(forceHeartbeat, delay);
  }
  broadcastQuality(10);
  return { ok: true, visibleCount, enabled };
});

ipcMain.handle('v25-get-sync-quality', () => qualitySnapshot());

const qualityInterval = setInterval(() => broadcastQuality(0), 700);
qualityInterval.unref?.();

module.exports = { qualitySnapshot, forceHeartbeat };

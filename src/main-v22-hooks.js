'use strict';

const { ipcMain } = require('electron');

const MAX_PANES = 8;
const panes = new Map();
const states = new Map();
const paused = new Set();
const navigationLocks = new Map();

let visibleCount = 4;
let following = false;
let policy = { navigation: false, scrolling: false, typing: false, clicks: false };

const live = (contents) => Boolean(contents && !contents.isDestroyed());

function activeFollowers() {
  const result = [];
  for (let pane = 2; pane <= visibleCount; pane += 1) {
    const contents = panes.get(pane);
    if (live(contents) && !paused.has(pane)) result.push([pane, contents]);
  }
  return result;
}

function rememberPane(event, payload) {
  const pane = Number(payload?.paneNumber);
  if (!Number.isInteger(pane) || pane < 1 || pane > MAX_PANES) return;
  panes.set(pane, event.sender);
}

function followLeaderURL(state, force = false) {
  if (!following || !policy.navigation) return;
  const targetURL = String(state?.url || '');
  if (!targetURL || !/^(https?:|file:|relay:)/i.test(targetURL)) return;

  for (const [pane, contents] of activeFollowers()) {
    if (states.get(pane)?.challenge || contents.getURL() === targetURL) continue;
    const lock = navigationLocks.get(pane);
    if (!force && lock?.url === targetURL && Date.now() - lock.time < 1800) continue;
    navigationLocks.set(pane, { url: targetURL, time: Date.now() });
    contents.loadURL(targetURL).catch(() => {});
  }
}

function sendLeaderScroll(state) {
  if (!following || !policy.scrolling) return;
  for (const [pane, contents] of activeFollowers()) {
    if (!states.get(pane)?.challenge) contents.send('leader-scroll-v18', state || {});
  }
}

function requestAllPaneStates() {
  for (let pane = 1; pane <= visibleCount; pane += 1) {
    const contents = panes.get(pane);
    if (!live(contents)) continue;
    contents.send('sync-policy-v18', policy);
    contents.send('pane-paused-v18', paused.has(pane));
    contents.send('request-pane-state-v18');
  }
}

async function resyncAll() {
  navigationLocks.clear();
  requestAllPaneStates();

  for (const delay of [90, 260, 620]) {
    setTimeout(() => {
      requestAllPaneStates();
      const leader = states.get(1);
      if (!leader) return;
      followLeaderURL(leader, true);
      sendLeaderScroll(leader);
    }, delay);
  }

  return {
    ok: true,
    registered: Array.from({ length: visibleCount }, (_unused, index) => panes.get(index + 1)).filter(live).length,
    visibleCount,
    following,
  };
}

ipcMain.on('register-pane-v18', rememberPane);
ipcMain.on('pane-state-v18', (event, payload) => {
  rememberPane(event, payload);
  const pane = Number(payload?.paneNumber);
  if (!Number.isInteger(pane) || pane < 1 || pane > MAX_PANES) return;
  states.set(pane, { ...(payload?.state || {}), updatedAt: Date.now() });
});

ipcMain.on('leader-scroll-direct-v22', (event, payload) => {
  if (!following || !policy.scrolling || event.sender.id !== panes.get(1)?.id) return;
  sendLeaderScroll(payload?.state || {});
});

ipcMain.handle('v22-sync-state', (_event, next = {}) => {
  if (Number.isFinite(Number(next.visibleCount))) {
    visibleCount = Math.max(1, Math.min(MAX_PANES, Number(next.visibleCount)));
  }
  if (typeof next.following === 'boolean') following = next.following;
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
  return { ok: true, visibleCount, following, policy: { ...policy } };
});

ipcMain.handle('v22-resync-all', resyncAll);

ipcMain.handle('v22-forget-pane', (_event, paneValue) => {
  const pane = Number(paneValue);
  panes.delete(pane);
  states.delete(pane);
  navigationLocks.delete(pane);
  return { ok: true };
});

module.exports = { resyncAll };

'use strict';

const { BrowserWindow, ipcMain } = require('electron');

const MAX_PANES = 8;
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'com.mx', 'co.jp', 'co.in', 'com.sg', 'com.tr',
]);

const panes = new Map();
const states = new Map();
const paused = new Set();
const acknowledgements = new Map();
const navigationLocks = new Map();
const destroyHooks = new Set();
const pendingActions = new Map();
const stagedTargets = new Map();

let visibleCount = 4;
let following = false;
let policy = { navigation: false, scrolling: false, typing: false, clicks: false };
let leaderSnapshot = null;
let actionSequence = 0;
let healthTimer = null;
let stageFlushTimer = null;

const live = (contents) => Boolean(contents && !contents.isDestroyed());
const uiWindow = () => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
const anyPolicy = () => Object.values(policy).some(Boolean);

function followers() {
  const result = [];
  for (let pane = 2; pane <= visibleCount; pane += 1) {
    const contents = panes.get(pane);
    if (live(contents) && !paused.has(pane)) result.push([pane, contents]);
  }
  return result;
}

function paneNumberFrom(payload) {
  const pane = Number(payload?.paneNumber);
  return Number.isInteger(pane) && pane >= 1 && pane <= MAX_PANES ? pane : 0;
}

function parsedURL(value) {
  try { return new URL(String(value || '')); } catch { return null; }
}

function normalizedURL(value) {
  const parsed = parsedURL(value);
  return parsed ? parsed.href : String(value || '').trim();
}

function registrableHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const suffix = parts.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(suffix) ? parts.slice(-3).join('.') : suffix;
}

function siteKey(value) {
  const parsed = parsedURL(value);
  if (!parsed) return '';
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return `${parsed.protocol}//${registrableHost(parsed.hostname)}`;
  }
  if (parsed.protocol === 'relay:') return `relay://${parsed.hostname}`;
  if (parsed.protocol === 'file:') return 'file:';
  return `${parsed.protocol}//${parsed.hostname || ''}`;
}

function mainDomainURL(value) {
  const parsed = parsedURL(value);
  if (!parsed) return '';
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return `${parsed.protocol}//${registrableHost(parsed.hostname)}/`;
  }
  return parsed.href;
}

function validURL(value) {
  const url = normalizedURL(value);
  return /^(https?:|file:|relay:)/i.test(url) ? url : '';
}

function attachDestroyHook(pane, contents) {
  if (!live(contents) || destroyHooks.has(contents.id)) return;
  destroyHooks.add(contents.id);
  contents.once('destroyed', () => {
    destroyHooks.delete(contents.id);
    if (panes.get(pane)?.id === contents.id) panes.delete(pane);
    states.delete(pane);
    acknowledgements.delete(pane);
    navigationLocks.delete(pane);
    stagedTargets.delete(pane);
    scheduleHealth(10);
  });
}

function rememberPane(event, payload) {
  const pane = paneNumberFrom(payload);
  if (!pane) return 0;
  panes.set(pane, event.sender);
  attachDestroyHook(pane, event.sender);
  return pane;
}

function scoreAcknowledgement(ack) {
  if (!ack) return 0;
  const url = policy.navigation ? (ack.urlMatch ? 45 : 0) : 45;
  const scrollDifference = Math.max(0, Number(ack.scrollDifference) || 0);
  const scroll = policy.scrolling ? Math.max(0, 35 - Math.min(35, scrollDifference * 900)) : 35;
  const total = Math.max(0, Number(ack.controlsTotal) || 0);
  const matched = Math.max(0, Number(ack.controlsMatched) || 0);
  const controls = (policy.typing || policy.clicks)
    ? 20 * (total ? Math.min(1, matched / total) : 1)
    : 20;
  return Math.max(0, Math.min(100, Math.round(url + scroll + controls)));
}

function healthSnapshot() {
  const leader = states.get(1);
  const now = Date.now();
  const rows = Array.from({ length: visibleCount }, (_unused, index) => {
    const paneNumber = index + 1;
    const state = states.get(paneNumber);
    const ack = acknowledgements.get(paneNumber);
    const challenged = Boolean(state?.challenge);
    const stale = paneNumber > 1 && !challenged && (!ack || now - ack.receivedAt > 1800);
    const scrollOffset = leader && state
      ? Math.round(Math.abs(Number(leader.scrollYRatio || 0) - Number(state.scrollYRatio || 0)) * 1000)
      : null;
    const syncScore = paneNumber === 1
      ? 100
      : paused.has(paneNumber) || challenged
        ? null
        : stale
          ? 0
          : ack.score;
    return {
      paneNumber,
      registered: live(panes.get(paneNumber)),
      paused: paused.has(paneNumber),
      loading: Boolean(state?.loading),
      challenge: challenged,
      title: state?.title || '',
      url: state?.url || '',
      scrollOffset,
      syncScore,
      caughtUp: paneNumber === 1 || challenged || (!stale && Number(syncScore) >= 95),
    };
  });
  const followerRows = rows.slice(1);
  return {
    followingEnabled: following,
    policy: following ? { ...policy } : { navigation: false, scrolling: false, typing: false, clicks: false },
    visiblePaneCount: visibleCount,
    registeredCount: rows.filter((row) => row.registered).length,
    connectedFollowers: followerRows.filter((row) => row.registered && !row.paused).length,
    caughtUpFollowers: followerRows.filter((row) => row.registered && !row.paused && row.caughtUp).length,
    pausedCount: followerRows.filter((row) => row.paused).length,
    rows,
  };
}

function broadcastHealth() {
  clearTimeout(healthTimer);
  healthTimer = null;
  uiWindow()?.webContents.send('pane-health-v18', healthSnapshot());
}

function scheduleHealth(delay = 55) {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(broadcastHealth, delay);
}

function sendConfiguration(contents, pane) {
  if (!live(contents)) return;
  contents.send('v26-config', { following, policy: { ...policy }, paused: paused.has(pane) });
}

function sendConfigurationToAll() {
  for (const [pane, contents] of panes.entries()) sendConfiguration(contents, pane);
}

function clearFollowerScrollTargets() {
  for (const [_pane, contents] of followers()) contents.send('v26-clear-scroll');
}

function queueNavigation(items, force = false) {
  const ready = items.filter(({ pane, contents, url }) => {
    if (!live(contents) || !url || states.get(pane)?.challenge) return false;
    if (normalizedURL(contents.getURL()) === normalizedURL(url)) return false;
    const lock = navigationLocks.get(pane);
    if (!force && lock?.url === url && Date.now() - lock.time < 1000) return false;
    navigationLocks.set(pane, { url, time: Date.now() });
    return true;
  });
  if (!ready.length) return;
  setTimeout(() => {
    for (const { contents, url } of ready) {
      if (live(contents)) contents.loadURL(url).catch(() => {});
    }
  }, 18);
}

function scheduleStageFlush(delay = 160) {
  clearTimeout(stageFlushTimer);
  stageFlushTimer = setTimeout(flushStagedTargets, delay);
}

function flushStagedTargets() {
  stageFlushTimer = null;
  if (!following || !policy.navigation || !stagedTargets.size) return;
  const now = Date.now();
  const ready = [];
  let waiting = 0;

  for (const [pane, item] of stagedTargets.entries()) {
    const contents = panes.get(pane);
    const state = states.get(pane);
    if (!live(contents) || paused.has(pane)) {
      stagedTargets.delete(pane);
      continue;
    }
    if (state?.challenge) {
      waiting += 1;
      continue;
    }
    const reachedDomain = siteKey(state?.url || contents.getURL()) === item.site;
    if (reachedDomain && !state?.loading) ready.push({ pane, contents, url: item.targetURL });
    else waiting += 1;
  }

  const oldest = Math.min(...[...stagedTargets.values()].map((item) => item.createdAt));
  if (ready.length && (waiting === 0 || now - oldest >= 1800)) {
    queueNavigation(ready, true);
    for (const item of ready) stagedTargets.delete(item.pane);
  }
  if (stagedTargets.size) scheduleStageFlush(320);
}

function followLeaderURL(state, force = false) {
  if (!following || !policy.navigation || state?.challenge) return;
  const targetURL = validURL(state?.url);
  if (!targetURL) return;
  const targetSite = siteKey(targetURL);
  const rootURL = mainDomainURL(targetURL);
  const exact = [];
  const warmup = [];

  for (const [pane, contents] of followers()) {
    const followerState = states.get(pane);
    if (followerState?.challenge) continue;
    if (normalizedURL(contents.getURL()) === normalizedURL(targetURL)) {
      stagedTargets.delete(pane);
      continue;
    }

    const currentSite = siteKey(followerState?.url || contents.getURL());
    const shouldWarm = targetSite && currentSite !== targetSite && rootURL && normalizedURL(rootURL) !== normalizedURL(targetURL);
    if (shouldWarm) {
      stagedTargets.set(pane, { targetURL, site: targetSite, rootURL, createdAt: Date.now() });
      warmup.push({ pane, contents, url: rootURL });
    } else {
      stagedTargets.delete(pane);
      exact.push({ pane, contents, url: targetURL });
    }
  }

  queueNavigation(warmup, force);
  queueNavigation(exact, force);
  if (warmup.length) scheduleStageFlush();
}

function distributeSnapshot(forceNavigation = false) {
  if (!following || !leaderSnapshot || leaderSnapshot.state?.challenge) return;
  followLeaderURL(leaderSnapshot.state, forceNavigation);
  for (const [pane, contents] of followers()) {
    if (states.get(pane)?.challenge) continue;
    contents.send('v26-apply-snapshot', {
      sequence: leaderSnapshot.sequence,
      state: leaderSnapshot.state,
      controls: leaderSnapshot.controls,
      policy: { ...policy },
    });
  }
}

function requestLeaderSnapshot() {
  const leader = panes.get(1);
  if (live(leader)) leader.send('v26-request-snapshot');
}

function fullResync() {
  navigationLocks.clear();
  acknowledgements.clear();
  sendConfigurationToAll();
  for (const delay of [0, 100, 280, 650]) {
    setTimeout(() => {
      requestLeaderSnapshot();
      if (leaderSnapshot) distributeSnapshot(true);
    }, delay);
  }
  scheduleHealth(10);
  return { ok: true, following, visiblePaneCount: visibleCount };
}

ipcMain.on('v26-register', (event, payload) => {
  const pane = rememberPane(event, payload);
  if (!pane) return;
  sendConfiguration(event.sender, pane);
  if (following && pane > 1) setTimeout(() => distributeSnapshot(true), 30);
  scheduleHealth(10);
});

ipcMain.on('v26-state', (event, payload) => {
  const pane = rememberPane(event, payload);
  if (!pane) return;
  const nextState = { ...(payload?.state || {}), updatedAt: Date.now() };
  states.set(pane, nextState);
  if (following && pane === 1 && policy.navigation && !nextState.challenge) followLeaderURL(nextState);
  if (pane > 1 && stagedTargets.has(pane)) scheduleStageFlush(90);
  scheduleHealth();
});

ipcMain.on('v26-leader-scroll', (event, payload) => {
  if (!following || !policy.scrolling || event.sender.id !== panes.get(1)?.id || states.get(1)?.challenge) return;
  const state = payload?.state || {};
  for (const [pane, contents] of followers()) {
    if (!states.get(pane)?.challenge) contents.send('v26-apply-scroll', state);
  }
});

ipcMain.on('v26-leader-action', (event, payload) => {
  if (!following || event.sender.id !== panes.get(1)?.id || states.get(1)?.challenge) return;
  const action = payload?.action;
  const category = action?.kind === 'navigate'
    ? 'navigation'
    : action?.kind === 'click'
      ? 'clicks'
      : action?.kind === 'input' || action?.kind === 'key'
        ? 'typing'
        : '';
  if (!category || policy[category] !== true) return;
  if (category === 'navigation') {
    setTimeout(requestLeaderSnapshot, 30);
    return;
  }
  for (const [pane, contents] of followers()) {
    if (states.get(pane)?.challenge) continue;
    const actionId = `v26-${++actionSequence}-${pane}`;
    pendingActions.set(actionId, { pane, contents, action, attempts: 1 });
    contents.send('v26-apply-action', { actionId, action });
  }
});

ipcMain.on('v26-action-result', (event, payload) => {
  const pane = rememberPane(event, payload);
  const actionId = String(payload?.actionId || '');
  const pending = pendingActions.get(actionId);
  if (!pending || pending.pane !== pane) return;
  if (payload?.result?.ok === false && pending.attempts < 2 && live(pending.contents) && !states.get(pane)?.challenge) {
    pending.attempts += 1;
    setTimeout(() => pending.contents.send('v26-apply-action', { actionId, action: pending.action }), 90);
    return;
  }
  pendingActions.delete(actionId);
  if (payload?.result?.ok === false) setTimeout(requestLeaderSnapshot, 30);
});

ipcMain.on('v26-leader-snapshot', (event, payload) => {
  if (!following || event.sender.id !== panes.get(1)?.id) return;
  const nextState = payload?.state || {};
  states.set(1, { ...nextState, updatedAt: Date.now() });
  if (nextState.challenge) {
    scheduleHealth();
    return;
  }
  leaderSnapshot = {
    sequence: Number(payload?.sequence) || Date.now(),
    state: nextState,
    controls: Array.isArray(payload?.controls) ? payload.controls : [],
  };
  distributeSnapshot();
});

ipcMain.on('v26-ack', (event, payload) => {
  const pane = rememberPane(event, payload);
  if (pane < 2 || pane > visibleCount || states.get(pane)?.challenge) return;
  const ack = {
    urlMatch: payload?.urlMatch === true,
    scrollDifference: Math.max(0, Number(payload?.scrollDifference) || 0),
    controlsMatched: Math.max(0, Number(payload?.controlsMatched) || 0),
    controlsTotal: Math.max(0, Number(payload?.controlsTotal) || 0),
    receivedAt: Date.now(),
  };
  ack.score = scoreAcknowledgement(ack);
  acknowledgements.set(pane, ack);
  scheduleHealth();
});

ipcMain.handle('v18-set-following', (_event, enabled) => {
  following = Boolean(enabled) && anyPolicy();
  if (!following) {
    acknowledgements.clear();
    stagedTargets.clear();
    clearFollowerScrollTargets();
  }
  sendConfigurationToAll();
  if (following) fullResync();
  broadcastHealth();
  return { ok: true, enabled: following, health: healthSnapshot() };
});

ipcMain.handle('v18-set-policy', (_event, next = {}) => {
  policy = {
    navigation: next.navigation === true,
    scrolling: next.scrolling === true,
    typing: next.typing === true,
    clicks: next.clicks === true,
  };
  if (!anyPolicy()) following = false;
  if (!policy.navigation) stagedTargets.clear();
  if (!policy.scrolling) clearFollowerScrollTargets();
  sendConfigurationToAll();
  if (following) fullResync();
  broadcastHealth();
  return { ok: true, policy: { ...policy }, followingEnabled: following };
});

ipcMain.handle('v18-set-pane-count', (_event, count) => {
  visibleCount = Math.max(1, Math.min(MAX_PANES, Number(count) || 4));
  for (const pane of [...paused]) if (pane > visibleCount) paused.delete(pane);
  for (const pane of [...acknowledgements.keys()]) if (pane > visibleCount) acknowledgements.delete(pane);
  for (const pane of [...stagedTargets.keys()]) if (pane > visibleCount) stagedTargets.delete(pane);
  sendConfigurationToAll();
  if (following) fullResync();
  broadcastHealth();
  return { ok: true, visiblePaneCount: visibleCount };
});

ipcMain.handle('v18-set-pane-paused', (_event, value, shouldPause) => {
  const pane = Number(value);
  if (!Number.isInteger(pane) || pane < 2 || pane > visibleCount) {
    return { ok: false, error: 'Choose a visible follower screen.' };
  }
  if (shouldPause) paused.add(pane);
  else paused.delete(pane);
  acknowledgements.delete(pane);
  stagedTargets.delete(pane);
  sendConfiguration(panes.get(pane), pane);
  if (!shouldPause && following) fullResync();
  broadcastHealth();
  return { ok: true, paneNumber: pane, paused: Boolean(shouldPause) };
});

ipcMain.handle('v18-get-health', () => healthSnapshot());
ipcMain.handle('v26-resync-all', () => fullResync());

globalThis.__conduitCoordinatorV21 = {
  forgetPane(value) {
    const pane = Number(value);
    panes.delete(pane);
    states.delete(pane);
    acknowledgements.delete(pane);
    navigationLocks.delete(pane);
    stagedTargets.delete(pane);
    scheduleHealth(10);
  },
  requestPane(value) {
    const contents = panes.get(Number(value));
    if (live(contents)) contents.send('v26-request-state');
  },
};

const healthInterval = setInterval(() => scheduleHealth(0), 700);
healthInterval.unref?.();

module.exports = { healthSnapshot, fullResync, siteKey, mainDomainURL, normalizedURL };

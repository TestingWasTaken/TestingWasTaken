'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const { actionLooksSensitive, pageKey } = require('./core');
const {
  installSessionAdBlocker,
  setEnabled: setAdBlockEnabled,
  snapshot: adBlockSnapshot,
} = require('./adblocker');

const pageContents = new Map();
const challengedScreens = new Set();
const alignmentLocks = new Map();
let syncEnabled = false;
let latestControllerState = null;
let actionSequence = 0;
let sessionNumber = 0;

function timestamp() {
  return new Date().toLocaleTimeString('en-CA', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function sendDiagnostic(level, message) {
  const payload = {
    time: timestamp(),
    level,
    message: String(message || ''),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('diagnostic-log', payload);
  }
}

function screenNumberFor(contents) {
  const partition = contents?.session?.getPartition?.() || '';
  const match = partition.match(/relay-screen-(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function validControllerURL(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:', 'file:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function visibleFollowers() {
  return [...pageContents.entries()]
    .filter(([screenNumber, contents]) => screenNumber > 1 && contents && !contents.isDestroyed())
    .sort(([left], [right]) => left - right);
}

function pushControllerPosition(contents, state, delays = [0, 180, 650]) {
  for (const delay of delays) {
    setTimeout(() => {
      if (!contents.isDestroyed()) contents.send('controller-state-v11', state);
    }, delay);
  }
}

async function alignFollower(screenNumber, contents, state) {
  if (!syncEnabled || challengedScreens.has(screenNumber) || contents.isDestroyed()) return;
  if (!validControllerURL(state.url)) return;

  const sourceKey = pageKey(state.url);
  const targetURL = contents.getURL();
  const targetKey = pageKey(targetURL);

  if (sourceKey && targetKey !== sourceKey) {
    const lock = alignmentLocks.get(screenNumber);
    if (lock && lock.key === sourceKey && Date.now() - lock.time < 5000) return;
    alignmentLocks.set(screenNumber, { key: sourceKey, time: Date.now() });

    try {
      await contents.loadURL(state.url);
      pushControllerPosition(contents, state);
    } catch {
      sendDiagnostic('error', `Screen ${screenNumber} could not catch up.`);
    }
    return;
  }

  pushControllerPosition(contents, state, [0, 120]);
}

function installPageTracking(contents) {
  const screenNumber = screenNumberFor(contents);
  if (!screenNumber) return;

  pageContents.set(screenNumber, contents);
  contents.once('destroyed', () => {
    if (pageContents.get(screenNumber) === contents) pageContents.delete(screenNumber);
    challengedScreens.delete(screenNumber);
  });

  contents.on('did-stop-loading', () => {
    if (screenNumber > 1 && syncEnabled && latestControllerState && !challengedScreens.has(screenNumber)) {
      pushControllerPosition(contents, latestControllerState);
    }
  });
}

app.on('web-contents-created', (_event, contents) => installPageTracking(contents));

app.on('session-created', (createdSession) => {
  sessionNumber += 1;
  installSessionAdBlocker(createdSession, `Screen session ${sessionNumber}`);
});

app.whenReady().then(() => {
  installSessionAdBlocker(session.defaultSession, 'Relay interface');
  sendDiagnostic('success', 'Ready');
});

ipcMain.handle('get-adblock-status', () => adBlockSnapshot());
ipcMain.handle('set-adblock-enabled', (_event, enabled) => {
  const state = setAdBlockEnabled(enabled);
  sendDiagnostic(state.enabled ? 'success' : 'warn', state.enabled ? 'Ad blocker on' : 'Ad blocker off');
  return state;
});

ipcMain.handle('v11-set-sync', (_event, enabled) => {
  syncEnabled = Boolean(enabled);
  if (!syncEnabled) latestControllerState = null;
  sendDiagnostic('success', syncEnabled ? 'Screen 1 control on' : 'Screen 1 control off');
  return { ok: true, enabled: syncEnabled };
});

ipcMain.on('challenge-state-v11', (_event, payload) => {
  const screenNumber = Number(payload?.screenNumber);
  if (!Number.isInteger(screenNumber) || screenNumber < 1) return;
  if (payload?.challenge) challengedScreens.add(screenNumber);
  else challengedScreens.delete(screenNumber);
});

ipcMain.on('controller-action-v11', (event, action) => {
  if (!syncEnabled || actionLooksSensitive(action)) return;
  const controller = pageContents.get(1);
  if (!controller || controller.id !== event.sender.id || challengedScreens.has(1)) return;

  const actionId = `v11-${++actionSequence}`;
  for (const [screenNumber, contents] of visibleFollowers()) {
    if (challengedScreens.has(screenNumber)) continue;
    contents.send('replay-action', { actionId, action });
  }
});

ipcMain.on('controller-state-v11', (event, state) => {
  if (!syncEnabled || !state || !validControllerURL(state.url)) return;
  const controller = pageContents.get(1);
  if (!controller || controller.id !== event.sender.id || challengedScreens.has(1)) return;

  latestControllerState = {
    url: String(state.url),
    scrollXRatio: Math.max(0, Math.min(1, Number(state.scrollXRatio) || 0)),
    scrollYRatio: Math.max(0, Math.min(1, Number(state.scrollYRatio) || 0)),
  };

  for (const [screenNumber, contents] of visibleFollowers()) {
    alignFollower(screenNumber, contents, latestControllerState);
  }
});

require('./main');

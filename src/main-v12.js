'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const {
  installSessionAdBlocker,
  setEnabled: setAdBlockEnabled,
  snapshot: adBlockSnapshot,
} = require('./adblocker');

const MAX_SCREENS = 4;
const screens = new Map();
const challengedScreens = new Set();
const registeredContents = new WeakSet();
const alignmentLocks = new Map();
const pendingActions = new Map();

let syncEnabled = false;
let visibleScreenCount = 4;
let latestControllerState = null;
let actionSequence = 0;
let sessionNumber = 0;
let syncReadyReported = false;

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

function live(contents) {
  return Boolean(contents && !contents.isDestroyed());
}

function canonicalURL(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function activeFollowers() {
  const followers = [];
  for (let screenNumber = 2; screenNumber <= visibleScreenCount; screenNumber += 1) {
    const contents = screens.get(screenNumber);
    if (live(contents)) followers.push([screenNumber, contents]);
  }
  return followers;
}

function registeredFollowerCount() {
  return activeFollowers().length;
}

function reportSyncReadiness() {
  if (!syncEnabled || syncReadyReported) return;
  const controller = screens.get(1);
  const followerCount = registeredFollowerCount();
  if (!live(controller) || followerCount < 1) return;

  syncReadyReported = true;
  sendDiagnostic('success', `Screen 1 connected to ${followerCount} follower${followerCount === 1 ? '' : 's'}`);
}

function pushControllerPosition(contents, state, delays = [0, 120, 360, 900]) {
  for (const delay of delays) {
    setTimeout(() => {
      if (live(contents)) contents.send('controller-state-v12', state);
    }, delay);
  }
}

async function alignFollower(screenNumber, contents, state) {
  if (!syncEnabled || !live(contents) || challengedScreens.has(screenNumber)) return false;

  const sourceURL = canonicalURL(state?.url);
  if (!sourceURL) return false;

  const targetURL = canonicalURL(contents.getURL());
  if (targetURL !== sourceURL) {
    const lock = alignmentLocks.get(screenNumber);
    if (lock && lock.url === sourceURL && Date.now() - lock.time < 3500) return false;
    alignmentLocks.set(screenNumber, { url: sourceURL, time: Date.now() });

    try {
      await contents.loadURL(state.url);
    } catch {
      sendDiagnostic('error', `Screen ${screenNumber} could not catch up`);
      return false;
    }
  }

  pushControllerPosition(contents, state);
  return true;
}

function registerScreen(event, payload) {
  const screenNumber = Number(payload?.screenNumber);
  if (!Number.isInteger(screenNumber) || screenNumber < 1 || screenNumber > MAX_SCREENS) return;

  const contents = event.sender;
  screens.set(screenNumber, contents);

  if (!registeredContents.has(contents)) {
    registeredContents.add(contents);

    contents.once('destroyed', () => {
      if (screens.get(screenNumber) === contents) screens.delete(screenNumber);
      challengedScreens.delete(screenNumber);
      alignmentLocks.delete(screenNumber);
    });

    contents.on('did-stop-loading', () => {
      if (screenNumber === 1) {
        if (syncEnabled && live(contents)) contents.send('request-controller-state-v12');
        return;
      }

      if (syncEnabled && latestControllerState && !challengedScreens.has(screenNumber)) {
        pushControllerPosition(contents, latestControllerState);
      }
    });
  }

  if (screenNumber === 1 && syncEnabled) {
    contents.send('request-controller-state-v12');
  } else if (screenNumber > 1 && syncEnabled && latestControllerState) {
    alignFollower(screenNumber, contents, latestControllerState);
  }

  reportSyncReadiness();
}

function protectedAction(action) {
  if (!action || typeof action !== 'object') return true;
  if (action.protected === true || action.kind === 'protected') return true;
  return ['password', 'file'].includes(String(action.fieldType || '').toLowerCase());
}

function finishPendingAction(actionId) {
  const pending = pendingActions.get(actionId);
  if (!pending) return;
  pendingActions.delete(actionId);

  if (pending.failed > 0) {
    sendDiagnostic('warn', `Sync missed ${pending.failed} screen${pending.failed === 1 ? '' : 's'}`);
  }
}

async function deliverAction(actionId, screenNumber, contents, action) {
  if (!syncEnabled || !live(contents) || challengedScreens.has(screenNumber)) return;

  if (latestControllerState) {
    const sourceURL = canonicalURL(latestControllerState.url);
    const targetURL = canonicalURL(contents.getURL());
    if (sourceURL && targetURL !== sourceURL) {
      await alignFollower(screenNumber, contents, latestControllerState);
    }
  }

  if (!syncEnabled || !live(contents) || challengedScreens.has(screenNumber)) return;
  contents.send('replay-action-v12', { actionId, action });
}

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

ipcMain.handle('v12-set-sync', (_event, enabled) => {
  syncEnabled = Boolean(enabled);

  if (!syncEnabled) {
    latestControllerState = null;
    pendingActions.clear();
    syncReadyReported = false;
    sendDiagnostic('success', 'Screen 1 control off');
    return { ok: true, enabled: false, registeredScreens: screens.size };
  }

  syncReadyReported = false;
  const controller = screens.get(1);
  if (live(controller)) controller.send('request-controller-state-v12');
  reportSyncReadiness();

  const followerCount = registeredFollowerCount();
  if (!live(controller) || followerCount < 1) sendDiagnostic('warn', 'Sync is waiting for the browser screens');
  return {
    ok: live(controller) && followerCount > 0,
    enabled: true,
    registeredScreens: screens.size,
    followerCount,
  };
});

ipcMain.handle('v12-set-screen-count', (_event, count) => {
  visibleScreenCount = Math.max(1, Math.min(MAX_SCREENS, Number(count) || 1));
  return { ok: true, visibleScreenCount };
});

ipcMain.on('register-screen-v12', registerScreen);

ipcMain.on('challenge-state-v12', (_event, payload) => {
  const screenNumber = Number(payload?.screenNumber);
  if (!Number.isInteger(screenNumber) || screenNumber < 1 || screenNumber > MAX_SCREENS) return;

  if (payload?.challenge) challengedScreens.add(screenNumber);
  else challengedScreens.delete(screenNumber);
});

ipcMain.on('controller-state-v12', (event, state) => {
  if (!syncEnabled || !state) return;

  const controller = screens.get(1);
  if (!live(controller) || controller.id !== event.sender.id || challengedScreens.has(1)) return;

  const url = canonicalURL(state.url);
  if (!url) return;

  latestControllerState = {
    url: String(state.url),
    scrollXRatio: Math.max(0, Math.min(1, Number(state.scrollXRatio) || 0)),
    scrollYRatio: Math.max(0, Math.min(1, Number(state.scrollYRatio) || 0)),
    sequence: Number(state.sequence) || Date.now(),
  };

  for (const [screenNumber, contents] of activeFollowers()) {
    alignFollower(screenNumber, contents, latestControllerState);
  }
});

ipcMain.on('controller-action-v12', (event, action) => {
  if (!syncEnabled || protectedAction(action)) return;

  const controller = screens.get(1);
  if (!live(controller) || controller.id !== event.sender.id || challengedScreens.has(1)) return;

  const followers = activeFollowers().filter(([screenNumber]) => !challengedScreens.has(screenNumber));
  if (!followers.length) return;

  const actionId = `v12-${++actionSequence}`;
  pendingActions.set(actionId, {
    expected: followers.length,
    received: 0,
    failed: 0,
  });

  for (const [screenNumber, contents] of followers) {
    deliverAction(actionId, screenNumber, contents, action);
  }

  setTimeout(() => finishPendingAction(actionId), 1800);
});

ipcMain.on('replay-result-v12', (_event, result) => {
  const pending = pendingActions.get(result?.actionId);
  if (!pending) return;

  pending.received += 1;
  if (result?.ok === false && !result?.skipped) pending.failed += 1;

  if (pending.received >= pending.expected) finishPendingAction(result.actionId);
});

require('./main');

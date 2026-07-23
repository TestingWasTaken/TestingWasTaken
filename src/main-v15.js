'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const {
  installSessionAdBlocker,
  setEnabled: setAdBlockEnabled,
  snapshot: adBlockSnapshot,
} = require('./adblocker');

const MAX_SCREENS = 8;
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
let samplerBusy = false;
let lastSampleSignature = '';

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

function screenNumberFromContents(contents) {
  const partition = contents?.session?.getPartition?.() || '';
  const match = partition.match(/relay-screen-(\d+)/i);
  const screenNumber = Number(match?.[1] || 0);
  return Number.isInteger(screenNumber) && screenNumber >= 1 && screenNumber <= MAX_SCREENS
    ? screenNumber
    : 0;
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
  sendDiagnostic('success', `Pane 1 connected to ${followerCount} follower${followerCount === 1 ? '' : 's'}`);
}

function smoothScrollContents(contents, state) {
  if (!live(contents)) return;
  const xRatio = Math.max(0, Math.min(1, Number(state?.scrollXRatio) || 0));
  const yRatio = Math.max(0, Math.min(1, Number(state?.scrollYRatio) || 0));
  const script = `(() => {
    const root = document.scrollingElement || document.documentElement;
    const maxX = Math.max(0, root.scrollWidth - innerWidth);
    const maxY = Math.max(0, root.scrollHeight - innerHeight);
    const targetX = ${JSON.stringify(xRatio)} * maxX;
    const targetY = ${JSON.stringify(yRatio)} * maxY;
    const key = '__conduitFollowerMotion';
    const motion = window[key] || { frame: 0, x: scrollX, y: scrollY, targetX, targetY };
    motion.targetX = targetX;
    motion.targetY = targetY;
    window[key] = motion;

    if (motion.frame) return true;

    const tick = () => {
      const dx = motion.targetX - scrollX;
      const dy = motion.targetY - scrollY;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance < 0.8) {
        window.scrollTo(motion.targetX, motion.targetY);
        motion.frame = 0;
        return;
      }
      const factor = distance > 900 ? 0.28 : distance > 240 ? 0.22 : 0.17;
      window.scrollTo(scrollX + (dx * factor), scrollY + (dy * factor));
      motion.frame = requestAnimationFrame(tick);
    };

    motion.frame = requestAnimationFrame(tick);
    return true;
  })()`;

  contents.executeJavaScript(script, true).catch(() => {});
}

function pushControllerPosition(contents, state, delays = [0, 140, 420]) {
  for (const delay of delays) {
    setTimeout(() => smoothScrollContents(contents, state), delay);
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
      sendDiagnostic('error', `Pane ${screenNumber} could not catch up`);
      return false;
    }
  }

  pushControllerPosition(contents, state);
  return true;
}

function registerContents(contents, screenNumber) {
  if (!live(contents) || !Number.isInteger(screenNumber) || screenNumber < 1 || screenNumber > MAX_SCREENS) return;
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
        pushControllerPosition(contents, latestControllerState, [60, 260, 700]);
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

function registerScreen(event, payload) {
  const screenNumber = Number(payload?.screenNumber);
  registerContents(event.sender, screenNumber);
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
    sendDiagnostic('warn', `Pane mirroring missed ${pending.failed} follower${pending.failed === 1 ? '' : 's'}`);
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

function acceptControllerState(sender, state) {
  if (!syncEnabled || !state) return;
  const controller = screens.get(1);
  if (!live(controller) || controller.id !== sender.id || challengedScreens.has(1)) return;

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
}

async function sampleControllerPosition() {
  if (!syncEnabled || samplerBusy) return;
  const controller = screens.get(1);
  if (!live(controller) || challengedScreens.has(1)) return;

  samplerBusy = true;
  try {
    const state = await controller.executeJavaScript(`(() => {
      const root = document.scrollingElement || document.documentElement;
      const maxX = Math.max(1, root.scrollWidth - innerWidth);
      const maxY = Math.max(1, root.scrollHeight - innerHeight);
      return {
        url: location.href,
        scrollXRatio: Math.max(0, Math.min(1, scrollX / maxX)),
        scrollYRatio: Math.max(0, Math.min(1, scrollY / maxY)),
        sequence: Date.now(),
      };
    })()`, true);

    const signature = `${state.url}|${Number(state.scrollXRatio).toFixed(5)}|${Number(state.scrollYRatio).toFixed(5)}`;
    if (signature !== lastSampleSignature) {
      lastSampleSignature = signature;
      acceptControllerState(controller, state);
    }
  } catch {
    // Navigation can invalidate the execution context between samples.
  } finally {
    samplerBusy = false;
  }
}

app.on('web-contents-created', (_event, contents) => {
  const screenNumber = screenNumberFromContents(contents);
  if (screenNumber) registerContents(contents, screenNumber);
});

app.on('session-created', (createdSession) => {
  sessionNumber += 1;
  installSessionAdBlocker(createdSession, `Conduit pane session ${sessionNumber}`);
});

app.whenReady().then(() => {
  installSessionAdBlocker(session.defaultSession, 'Conduit interface');
  sendDiagnostic('success', 'Conduit initialized');
});

const scrollSampler = setInterval(sampleControllerPosition, 70);
scrollSampler.unref?.();

ipcMain.handle('get-adblock-status', () => adBlockSnapshot());
ipcMain.handle('set-adblock-enabled', (_event, enabled) => {
  const state = setAdBlockEnabled(enabled);
  sendDiagnostic(state.enabled ? 'success' : 'warn', state.enabled ? 'Ad filter on' : 'Ad filter off');
  return state;
});

ipcMain.handle('v12-set-sync', (_event, enabled) => {
  syncEnabled = Boolean(enabled);

  if (!syncEnabled) {
    latestControllerState = null;
    pendingActions.clear();
    syncReadyReported = false;
    lastSampleSignature = '';
    sendDiagnostic('success', 'Pane following off');
    return { ok: true, enabled: false, registeredScreens: screens.size };
  }

  syncReadyReported = false;
  const controller = screens.get(1);
  if (live(controller)) controller.send('request-controller-state-v12');
  reportSyncReadiness();
  sampleControllerPosition();

  const followerCount = registeredFollowerCount();
  if (!live(controller) || followerCount < 1) sendDiagnostic('warn', 'Pane following is waiting for the workspace');
  return {
    ok: live(controller) && followerCount > 0,
    enabled: true,
    registeredScreens: screens.size,
    followerCount,
  };
});

ipcMain.handle('v12-set-screen-count', (_event, count) => {
  visibleScreenCount = Math.max(1, Math.min(MAX_SCREENS, Number(count) || 1));
  syncReadyReported = false;
  reportSyncReadiness();
  return { ok: true, visibleScreenCount };
});

ipcMain.on('register-screen-v12', registerScreen);

ipcMain.on('challenge-state-v12', (_event, payload) => {
  const screenNumber = Number(payload?.screenNumber);
  if (!Number.isInteger(screenNumber) || screenNumber < 1 || screenNumber > MAX_SCREENS) return;

  if (payload?.challenge) challengedScreens.add(screenNumber);
  else challengedScreens.delete(screenNumber);
});

ipcMain.on('controller-state-v12', (event, state) => acceptControllerState(event.sender, state));

ipcMain.on('controller-action-v12', (event, action) => {
  if (!syncEnabled || protectedAction(action)) return;

  const controller = screens.get(1);
  if (!live(controller) || controller.id !== event.sender.id || challengedScreens.has(1)) return;

  // Window scrolling is sampled continuously and eased by the main process.
  if (action?.kind === 'scroll' && action?.selector === '__window__') return;

  const followers = activeFollowers().filter(([screenNumber]) => !challengedScreens.has(screenNumber));
  if (!followers.length) return;

  const actionId = `v15-${++actionSequence}`;
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
'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');

const MAX_PANES = 8;
const panes = new Map();
const paneStates = new Map();
const pausedPanes = new Set();
const pendingActions = new Map();

let visiblePaneCount = 4;
let followingEnabled = false;
let actionSequence = 0;
let policy = {
  navigation: true,
  clicks: true,
  typing: true,
  scrolling: true,
};

function live(contents) {
  return Boolean(contents && !contents.isDestroyed());
}

function toolbarWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
}

function activeFollowers() {
  const result = [];
  for (let paneNumber = 2; paneNumber <= visiblePaneCount; paneNumber += 1) {
    const contents = panes.get(paneNumber);
    if (live(contents) && !pausedPanes.has(paneNumber)) result.push([paneNumber, contents]);
  }
  return result;
}

function classifyAction(action) {
  if (!action) return '';
  if (action.kind === 'click') return 'clicks';
  if (action.kind === 'input' || action.kind === 'key') return 'typing';
  if (action.kind === 'scroll-window') return 'scrolling';
  return '';
}

function healthSnapshot() {
  const leader = paneStates.get(1);
  const rows = [];
  for (let paneNumber = 1; paneNumber <= visiblePaneCount; paneNumber += 1) {
    const state = paneStates.get(paneNumber);
    const registered = live(panes.get(paneNumber));
    const delta = leader && state
      ? Math.round(Math.abs(Number(leader.scrollYRatio || 0) - Number(state.scrollYRatio || 0)) * 1000)
      : null;
    rows.push({
      paneNumber,
      registered,
      paused: pausedPanes.has(paneNumber),
      loading: Boolean(state?.loading),
      challenge: Boolean(state?.challenge),
      url: state?.url || '',
      title: state?.title || '',
      scrollOffset: delta,
      caughtUp: delta !== null && delta <= 8,
    });
  }

  const followers = rows.slice(1);
  return {
    followingEnabled,
    policy: { ...policy },
    visiblePaneCount,
    registeredCount: rows.filter((row) => row.registered).length,
    connectedFollowers: followers.filter((row) => row.registered && !row.paused).length,
    caughtUpFollowers: followers.filter((row) => row.registered && !row.paused && row.caughtUp).length,
    pausedCount: followers.filter((row) => row.paused).length,
    rows,
  };
}

function broadcastHealth() {
  const window = toolbarWindow();
  if (window) window.webContents.send('pane-health-v18', healthSnapshot());
}

function sendPolicy() {
  for (const contents of panes.values()) {
    if (live(contents)) contents.send('sync-policy-v18', policy);
  }
}

function registerPane(event, payload) {
  const paneNumber = Number(payload?.paneNumber);
  if (!Number.isInteger(paneNumber) || paneNumber < 1 || paneNumber > MAX_PANES) return;
  panes.set(paneNumber, event.sender);
  event.sender.send('sync-policy-v18', policy);
  event.sender.send('pane-paused-v18', pausedPanes.has(paneNumber));
  broadcastHealth();
}

function acceptPaneState(event, payload) {
  const paneNumber = Number(payload?.paneNumber);
  if (!Number.isInteger(paneNumber) || paneNumber < 1 || paneNumber > MAX_PANES) return;
  panes.set(paneNumber, event.sender);
  paneStates.set(paneNumber, { ...(payload?.state || {}), updatedAt: Date.now() });

  if (followingEnabled && paneNumber === 1 && policy.scrolling) {
    for (const [_number, contents] of activeFollowers()) {
      contents.send('leader-scroll-v18', payload.state || {});
    }
  }
  broadcastHealth();
}

function forwardLeaderAction(event, payload) {
  if (!followingEnabled || event.sender.id !== panes.get(1)?.id) return;
  const action = payload?.action;
  const category = classifyAction(action);
  if (!category || policy[category] !== true) return;

  const followers = activeFollowers().filter(([paneNumber]) => !paneStates.get(paneNumber)?.challenge);
  if (!followers.length) return;
  const actionId = `c18-${++actionSequence}`;
  pendingActions.set(actionId, { expected: followers.length, received: 0, failed: 0, startedAt: Date.now() });
  for (const [_paneNumber, contents] of followers) {
    contents.send('replay-action-v18', { actionId, action });
  }
  setTimeout(() => {
    pendingActions.delete(actionId);
    broadcastHealth();
  }, 1800);
}

ipcMain.on('register-pane-v18', registerPane);
ipcMain.on('pane-state-v18', acceptPaneState);
ipcMain.on('leader-action-v18', forwardLeaderAction);
ipcMain.on('replay-result-v18', (_event, payload) => {
  const pending = pendingActions.get(payload?.actionId);
  if (!pending) return;
  pending.received += 1;
  if (payload?.result?.ok === false && !payload?.result?.skipped) pending.failed += 1;
  if (pending.received >= pending.expected) pendingActions.delete(payload.actionId);
  broadcastHealth();
});

ipcMain.handle('v18-set-following', (_event, enabled) => {
  followingEnabled = Boolean(enabled);
  if (followingEnabled) panes.get(1)?.send('request-pane-state-v18');
  broadcastHealth();
  return { ok: true, enabled: followingEnabled, health: healthSnapshot() };
});

ipcMain.handle('v18-set-policy', (_event, nextPolicy) => {
  policy = {
    navigation: nextPolicy?.navigation !== false,
    clicks: nextPolicy?.clicks !== false,
    typing: nextPolicy?.typing !== false,
    scrolling: nextPolicy?.scrolling !== false,
  };
  sendPolicy();
  broadcastHealth();
  return { ok: true, policy: { ...policy } };
});

ipcMain.handle('v18-set-pane-count', (_event, count) => {
  visiblePaneCount = Math.max(1, Math.min(MAX_PANES, Number(count) || 1));
  for (const paneNumber of [...pausedPanes]) {
    if (paneNumber > visiblePaneCount) pausedPanes.delete(paneNumber);
  }
  broadcastHealth();
  return { ok: true, visiblePaneCount };
});

ipcMain.handle('v18-set-pane-paused', (_event, paneNumberValue, paused) => {
  const paneNumber = Number(paneNumberValue);
  if (!Number.isInteger(paneNumber) || paneNumber < 2 || paneNumber > visiblePaneCount) {
    return { ok: false, error: 'Choose a visible follower pane.' };
  }
  if (paused) pausedPanes.add(paneNumber);
  else pausedPanes.delete(paneNumber);
  panes.get(paneNumber)?.send('pane-paused-v18', Boolean(paused));
  broadcastHealth();
  return { ok: true, paneNumber, paused: Boolean(paused) };
});

ipcMain.handle('v18-get-health', () => healthSnapshot());

function sendMenuCommand(command, payload = null) {
  toolbarWindow()?.webContents.send('menu-command-v18', { command, payload });
}

function installApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'Conduit',
      submenu: [
        { label: 'About Conduit', click: () => dialog.showMessageBox({ type: 'info', title: 'About Conduit', message: 'Conduit', detail: 'A linked multi-pane browser made by Jujhar.' }) },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => sendMenuCommand('settings') },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Focus Address', accelerator: 'CommandOrControl+L', click: () => sendMenuCommand('focus-address') },
        { label: 'Save Workspace Preset', accelerator: 'CommandOrControl+Shift+S', click: () => sendMenuCommand('save-preset') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Active Pane', accelerator: 'CommandOrControl+R', click: () => sendMenuCommand('reload-active') },
        { label: 'Reload Every Pane', accelerator: 'CommandOrControl+Shift+R', click: () => sendMenuCommand('reload-all') },
        { type: 'separator' },
        ...Array.from({ length: 8 }, (_unused, index) => ({
          label: `Focus Pane ${index + 1}`,
          accelerator: `CommandOrControl+${index + 1}`,
          click: () => sendMenuCommand('focus-pane', index + 1),
        })),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(installApplicationMenu);
app.on('browser-window-created', () => {
  panes.clear();
  paneStates.clear();
  pausedPanes.clear();
  pendingActions.clear();
  setTimeout(broadcastHealth, 800);
});

require('./main');

'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');

const MAX_PANES = 8;
const panes = new Map();
const states = new Map();
const paused = new Set();
let visibleCount = 4;
let following = false;
let sequence = 0;
let policy = { navigation: true, clicks: true, typing: true, scrolling: true };

const live = (contents) => Boolean(contents && !contents.isDestroyed());
const windowForUI = () => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;

function followers() {
  const result = [];
  for (let pane = 2; pane <= visibleCount; pane += 1) {
    const contents = panes.get(pane);
    if (live(contents) && !paused.has(pane)) result.push([pane, contents]);
  }
  return result;
}

function category(action) {
  if (action?.kind === 'click') return 'clicks';
  if (action?.kind === 'input' || action?.kind === 'key') return 'typing';
  if (action?.kind === 'scroll-window') return 'scrolling';
  return '';
}

function snapshot() {
  const leader = states.get(1);
  const rows = Array.from({ length: visibleCount }, (_unused, index) => {
    const paneNumber = index + 1;
    const state = states.get(paneNumber);
    const scrollOffset = leader && state
      ? Math.round(Math.abs(Number(leader.scrollYRatio || 0) - Number(state.scrollYRatio || 0)) * 1000)
      : null;
    return {
      paneNumber,
      registered: live(panes.get(paneNumber)),
      paused: paused.has(paneNumber),
      loading: Boolean(state?.loading),
      challenge: Boolean(state?.challenge),
      title: state?.title || '',
      url: state?.url || '',
      scrollOffset,
      caughtUp: scrollOffset !== null && scrollOffset <= 8,
    };
  });
  const followerRows = rows.slice(1);
  return {
    followingEnabled: following,
    policy: { ...policy },
    visiblePaneCount: visibleCount,
    registeredCount: rows.filter((row) => row.registered).length,
    connectedFollowers: followerRows.filter((row) => row.registered && !row.paused).length,
    caughtUpFollowers: followerRows.filter((row) => row.registered && !row.paused && row.caughtUp).length,
    pausedCount: followerRows.filter((row) => row.paused).length,
    rows,
  };
}

function broadcast() {
  windowForUI()?.webContents.send('pane-health-v18', snapshot());
}

function sendPolicy() {
  for (const contents of panes.values()) if (live(contents)) contents.send('sync-policy-v18', policy);
}

ipcMain.on('register-pane-v18', (event, payload) => {
  const pane = Number(payload?.paneNumber);
  if (!Number.isInteger(pane) || pane < 1 || pane > MAX_PANES) return;
  panes.set(pane, event.sender);
  event.sender.send('sync-policy-v18', policy);
  event.sender.send('pane-paused-v18', paused.has(pane));
  broadcast();
});

ipcMain.on('pane-state-v18', (event, payload) => {
  const pane = Number(payload?.paneNumber);
  if (!Number.isInteger(pane) || pane < 1 || pane > MAX_PANES) return;
  panes.set(pane, event.sender);
  states.set(pane, { ...(payload?.state || {}), updatedAt: Date.now() });
  if (following && pane === 1 && policy.scrolling) {
    for (const [_number, contents] of followers()) contents.send('leader-scroll-v18', payload.state || {});
  }
  broadcast();
});

ipcMain.on('leader-action-v18', (event, payload) => {
  if (!following || event.sender.id !== panes.get(1)?.id) return;
  const action = payload?.action;
  const kind = category(action);
  if (!kind || policy[kind] !== true) return;
  const targets = followers().filter(([pane]) => !states.get(pane)?.challenge);
  const actionId = `c18-${++sequence}`;
  for (const [_pane, contents] of targets) contents.send('replay-action-v18', { actionId, action });
});

ipcMain.handle('v18-set-following', (_event, enabled) => {
  following = Boolean(enabled);
  if (following) panes.get(1)?.send('request-pane-state-v18');
  broadcast();
  return { ok: true, enabled: following, health: snapshot() };
});

ipcMain.handle('v18-set-policy', (_event, next) => {
  policy = {
    navigation: next?.navigation !== false,
    clicks: next?.clicks !== false,
    typing: next?.typing !== false,
    scrolling: next?.scrolling !== false,
  };
  sendPolicy();
  broadcast();
  return { ok: true, policy: { ...policy } };
});

ipcMain.handle('v18-set-pane-count', (_event, count) => {
  visibleCount = Math.max(1, Math.min(MAX_PANES, Number(count) || 1));
  for (const pane of [...paused]) if (pane > visibleCount) paused.delete(pane);
  broadcast();
  return { ok: true, visiblePaneCount: visibleCount };
});

ipcMain.handle('v18-set-pane-paused', (_event, value, shouldPause) => {
  const pane = Number(value);
  if (!Number.isInteger(pane) || pane < 2 || pane > visibleCount) return { ok: false, error: 'Choose a visible follower pane.' };
  if (shouldPause) paused.add(pane); else paused.delete(pane);
  panes.get(pane)?.send('pane-paused-v18', Boolean(shouldPause));
  broadcast();
  return { ok: true, paneNumber: pane, paused: Boolean(shouldPause) };
});

ipcMain.handle('v18-get-health', () => snapshot());

function command(name, payload = null) {
  windowForUI()?.webContents.send('menu-command-v18', { command: name, payload });
}

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: 'Conduit', submenu: [
      { label: 'About Conduit', click: () => dialog.showMessageBox({ type: 'info', title: 'About Conduit', message: 'Conduit', detail: 'A linked multi-pane browser made by Jujhar.' }) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => command('settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'Focus Address', accelerator: 'CommandOrControl+L', click: () => command('focus-address') },
      { label: 'Save Workspace Preset', accelerator: 'CommandOrControl+Shift+S', click: () => command('save-preset') },
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'View', submenu: [
      { label: 'Reload Active Pane', accelerator: 'CommandOrControl+R', click: () => command('reload-active') },
      { label: 'Reload Every Pane', accelerator: 'CommandOrControl+Shift+R', click: () => command('reload-all') },
      { type: 'separator' },
      ...Array.from({ length: 8 }, (_unused, index) => ({ label: `Focus Pane ${index + 1}`, accelerator: `CommandOrControl+${index + 1}`, click: () => command('focus-pane', index + 1) })),
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});

app.on('browser-window-created', () => {
  panes.clear();
  states.clear();
  paused.clear();
  setTimeout(broadcast, 700);
});

require('./workspace-v18');

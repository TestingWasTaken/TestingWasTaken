'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const {
  MAX_SCREENS,
  DEFAULT_URL,
  normalizeURL,
  clampScreenCount,
  clampZoom,
  layoutCells,
  pageBounds,
  labelBounds,
  pageKey,
  actionLooksSensitive,
} = require('./core');
const { startTorRuntime } = require('./tor-manager');
const { startTorHttpBridge } = require('./tor-bridge');

app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

let mainWindow = null;
let views = [];
let sessions = [];
let screenCount = 4;
let zoomFactor = 1;
let currentURL = DEFAULT_URL;
let networkMode = 'direct';
let networkBusy = false;
let syncRequested = false;
let syncHardLock = '';
let statusText = 'Sync off';
let torRuntime = null;
let bridges = [];
let ipResults = Array(MAX_SCREENS).fill(null);
let dnsStatus = 'Direct connection';
let resizeTimer = null;
let stateTimer = null;
let actionSequence = 0;
const pageStates = new Map();
const pendingActions = new Map();

const welcomePath = path.join(__dirname, 'renderer', 'welcome.html');
const welcomeURL = pathToFileURL(welcomePath).href;

function activeViews() {
  return views.slice(0, screenCount);
}

function displayURL(value) {
  return value === welcomeURL || value === DEFAULT_URL ? DEFAULT_URL : value;
}

function actualURL(value) {
  const normalized = normalizeURL(value);
  return normalized === DEFAULT_URL ? welcomeURL : normalized;
}

function sendStateNow() {
  stateTimer = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safety = safetySnapshot();
  mainWindow.webContents.send('browser-state', {
    screenCount,
    zoomFactor,
    currentURL: displayURL(currentURL),
    networkMode,
    networkBusy,
    syncRequested,
    syncReady: syncRequested && !syncHardLock && safety.ready,
    status: syncHardLock ? `${syncHardLock}. Turn Sync activity off and on after checking the screens.` : statusTextFor(safety),
    ips: ipResults,
    dnsStatus,
    canGoBack: views[0]?.webContents.canGoBack() || false,
    canGoForward: views[0]?.webContents.canGoForward() || false,
  });
}

function scheduleState(delay = 40) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendStateNow, delay);
}

function statusTextFor(safety) {
  if (networkBusy) return statusText;
  if (!syncRequested) return statusText === 'Sync off' ? statusText : `${statusText} — Sync off`;
  if (!safety.ready) return `Paused: ${safety.reason}`;
  return statusText && statusText !== 'Sync off' ? statusText : 'Sync ready';
}

function safetySnapshot() {
  const active = activeViews();
  if (active.length < 2) return { ready: false, transient: true, reason: 'choose at least two screens' };
  const states = active.map((view) => pageStates.get(view.webContents.id));
  if (states.some((state) => !state)) return { ready: false, transient: true, reason: 'waiting for page checks' };
  if (states.some((state) => state.loading)) return { ready: false, transient: true, reason: 'waiting for pages to finish loading' };
  const challenged = states.findIndex((state) => state.challenge);
  if (challenged >= 0) {
    return { ready: false, transient: false, reason: `security challenge detected on Screen ${challenged + 1}` };
  }
  const keys = states.map((state) => pageKey(state.url));
  if (!keys.every((key) => key === keys[0])) {
    return { ready: false, transient: true, reason: 'screens are on different pages' };
  }
  return { ready: true, transient: false, reason: 'screens match' };
}

function updateLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const cells = layoutCells(screenCount, width, height);
  const labels = [];

  views.forEach((view, index) => {
    if (index < screenCount) {
      const cell = cells[index];
      const next = pageBounds(cell);
      const previous = view.getBounds();
      view.setVisible(true);
      if (previous.x !== next.x || previous.y !== next.y || previous.width !== next.width || previous.height !== next.height) {
        view.setBounds(next);
      }
      labels.push({ index, ...labelBounds(cell) });
    } else {
      view.setVisible(false);
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  });
  mainWindow.webContents.send('layout-state', { labels });
}

function scheduleLayout() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateLayout, 40);
}

function applyZoom() {
  activeViews().forEach((view) => view.webContents.setZoomFactor(zoomFactor));
}

function requestPageStates() {
  activeViews().forEach((view) => view.webContents.send('request-page-state'));
}

function configureSession(ses) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

function attachViewEvents(view, index) {
  const wc = view.webContents;
  wc.setAudioMuted(index > 0);
  if (index > 0 && typeof wc.setImageAnimationPolicy === 'function') wc.setImageAnimationPolicy('animateOnce');

  wc.on('did-start-loading', () => {
    const existing = pageStates.get(wc.id) || { url: wc.getURL(), challenge: false };
    pageStates.set(wc.id, { ...existing, loading: true });
    scheduleState();
  });
  wc.on('did-stop-loading', () => {
    const existing = pageStates.get(wc.id) || { url: wc.getURL(), challenge: false };
    pageStates.set(wc.id, { ...existing, loading: false });
    wc.send('request-page-state');
    scheduleState(80);
  });
  wc.on('did-navigate', (_event, url) => {
    if (index === 0) currentURL = url;
    scheduleState();
  });
  wc.on('did-navigate-in-page', (_event, url) => {
    if (index === 0) currentURL = url;
    scheduleState();
  });
  wc.on('render-process-gone', (_event, details) => {
    statusText = `Screen ${index + 1} renderer stopped: ${details.reason}`;
    scheduleState();
  });
}

function createView(index) {
  const partition = `persist:relay-screen-${index + 1}`;
  const ses = session.fromPartition(partition, { cache: true });
  configureSession(ses);
  sessions.push(ses);

  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'page-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      additionalArguments: [`--relay-screen=${index + 1}`],
    },
  });
  attachViewEvents(view, index);
  mainWindow.contentView.addChildView(view);
  views.push(view);
  view.webContents.setZoomFactor(zoomFactor);
  setTimeout(() => view.webContents.loadURL(welcomeURL), index * 140);
}

async function closeTorStack() {
  const oldBridges = bridges;
  bridges = [];
  await Promise.allSettled(oldBridges.map((bridge) => bridge.close()));
  if (torRuntime) torRuntime.stop();
  torRuntime = null;
}

async function setSessionsDirect() {
  await Promise.all(sessions.map(async (ses) => {
    await ses.setProxy({ mode: 'direct' });
    await ses.closeAllConnections();
    await ses.clearHostResolverCache();
  }));
}

async function setSessionsTor() {
  torRuntime = await startTorRuntime(app.getPath('userData'), MAX_SCREENS);
  bridges = await Promise.all(torRuntime.socksPorts.map((socksPort) => startTorHttpBridge({ socksPort })));
  await Promise.all(sessions.map(async (ses, index) => {
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: `http://127.0.0.1:${bridges[index].port}`,
      proxyBypassRules: '<local>',
    });
    await ses.closeAllConnections();
    await ses.clearHostResolverCache();
  }));
}

async function changeNetwork(mode) {
  if (networkBusy) return;
  const requested = mode === 'tor' ? 'tor' : 'direct';
  networkBusy = true;
  syncRequested = false;
  syncHardLock = '';
  statusText = requested === 'tor' ? 'Starting Tor and remote-DNS bridges…' : 'Switching to direct connection…';
  dnsStatus = 'Checking network…';
  ipResults = Array(MAX_SCREENS).fill(null);
  sendStateNow();

  try {
    await closeTorStack();
    if (requested === 'tor') {
      await setSessionsTor();
      networkMode = 'tor';
      dnsStatus = 'Remote DNS through Tor bridge; SafeSocks enabled';
      statusText = 'Tor connected';
    } else {
      await setSessionsDirect();
      networkMode = 'direct';
      dnsStatus = 'Direct connection';
      statusText = 'Direct connection';
    }
    await Promise.all(activeViews().map((view) => view.webContents.reload()));
  } catch (error) {
    await closeTorStack();
    await setSessionsDirect();
    networkMode = 'direct';
    dnsStatus = 'Tor setup failed; returned to direct connection';
    statusText = error.message;
  } finally {
    networkBusy = false;
    scheduleState();
  }
}

async function checkIPs() {
  if (networkBusy) return;
  statusText = 'Checking screen IPs and Tor DNS path…';
  scheduleState();
  const results = await Promise.all(activeViews().map(async (_view, index) => {
    const ses = sessions[index];
    try {
      const response = await ses.fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      let isTor = null;
      if (networkMode === 'tor') {
        const torCheck = await ses.fetch('https://check.torproject.org/api/ip', { cache: 'no-store' });
        if (torCheck.ok) isTor = Boolean((await torCheck.json()).IsTor);
      }
      return { ip: String(data.ip || 'Unknown'), ok: true, isTor };
    } catch (error) {
      return { ip: 'Unavailable', ok: false, error: error.message, isTor: false };
    }
  }));

  ipResults = Array(MAX_SCREENS).fill(null);
  results.forEach((result, index) => { ipResults[index] = result; });
  const duplicate = results.some((result, index) => result.ok && results.findIndex((other) => other.ip === result.ip) !== index);
  if (networkMode === 'tor') {
    const unsafe = torRuntime?.getUnsafeDnsAttempts() || 0;
    const allTor = results.every((result) => result.ok && result.isTor === true);
    dnsStatus = unsafe > 0
      ? `Tor blocked ${unsafe} unsafe DNS attempt${unsafe === 1 ? '' : 's'}`
      : allTor
        ? 'DNS guard passed: hostnames resolved through Tor'
        : 'Tor check incomplete; see screen results';
    statusText = duplicate ? 'IPs checked — Tor reused an exit IP on at least two screens' : 'IPs checked';
  } else {
    dnsStatus = 'Direct connection';
    statusText = 'IPs checked';
  }
  scheduleState();
}

function finalizePending(actionId) {
  const pending = pendingActions.get(actionId);
  if (!pending) return;
  pendingActions.delete(actionId);
  const successful = pending.results.filter((result) => result.ok).length;
  if (successful === pending.expected) {
    statusText = `Synced ${pending.kind} to ${successful}/${pending.expected}`;
  } else {
    const firstFailure = pending.results.find((result) => !result.ok);
    statusText = `Synced ${pending.kind} to ${successful}/${pending.expected}${firstFailure?.reason ? ` — ${firstFailure.reason}` : ''}`;
  }
  scheduleState(100);
}

function queueReplay(action) {
  const targets = activeViews().slice(1);
  if (!targets.length) return;
  const actionId = ++actionSequence;
  pendingActions.set(actionId, { kind: action.kind, expected: targets.length, results: [] });
  targets.forEach((view) => view.webContents.send('replay-action', { actionId, action }));
  setTimeout(() => finalizePending(actionId), 1300);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    show: false,
    title: 'Relay',
    backgroundColor: '#d0d0d0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  for (let index = 0; index < MAX_SCREENS; index += 1) createView(index);
  await setSessionsDirect();
  updateLayout();
  sendStateNow();

  mainWindow.on('resize', scheduleLayout);
  mainWindow.on('closed', () => {
    mainWindow = null;
    views = [];
    sessions = [];
    pageStates.clear();
  });
}

ipcMain.handle('navigate', async (_event, value) => {
  const destination = actualURL(value);
  currentURL = destination;
  syncHardLock = '';
  statusText = 'Loading…';
  await Promise.all(activeViews().map((view) => view.webContents.loadURL(destination)));
  scheduleState();
});

ipcMain.handle('go-back', () => activeViews().forEach((view) => view.webContents.canGoBack() && view.webContents.goBack()));
ipcMain.handle('go-forward', () => activeViews().forEach((view) => view.webContents.canGoForward() && view.webContents.goForward()));
ipcMain.handle('reload', () => activeViews().forEach((view) => view.webContents.reload()));

ipcMain.handle('set-screen-count', (_event, value) => {
  screenCount = clampScreenCount(value);
  syncHardLock = '';
  ipResults = Array(MAX_SCREENS).fill(null);
  updateLayout();
  applyZoom();
  requestPageStates();
  scheduleState();
});

ipcMain.handle('set-zoom', (_event, value) => {
  zoomFactor = clampZoom(value);
  applyZoom();
  scheduleState();
});

ipcMain.handle('set-network', (_event, value) => changeNetwork(value));
ipcMain.handle('check-ips', checkIPs);

ipcMain.handle('set-sync', (_event, enabled) => {
  syncRequested = Boolean(enabled);
  syncHardLock = '';
  statusText = syncRequested ? 'Checking screens…' : 'Sync off';
  requestPageStates();
  setTimeout(() => scheduleState(), 120);
});

ipcMain.on('page-state', (event, state) => {
  const viewIndex = views.findIndex((view) => view.webContents.id === event.sender.id);
  if (viewIndex < 0) return;
  const previous = pageStates.get(event.sender.id) || {};
  pageStates.set(event.sender.id, { ...previous, ...state, loading: false, screenNumber: viewIndex + 1 });
  if (syncRequested && state.challenge) syncHardLock = `Security challenge detected on Screen ${viewIndex + 1}`;
  scheduleState(80);
});

ipcMain.on('page-action', (event, action) => {
  const sourceIndex = views.findIndex((view) => view.webContents.id === event.sender.id);
  if (sourceIndex !== 0 || !syncRequested || syncHardLock) return;
  const safety = safetySnapshot();
  if (!safety.ready) {
    statusText = `Not synced: ${safety.reason}`;
    scheduleState(100);
    return;
  }
  if (actionLooksSensitive(action)) {
    syncHardLock = 'Sensitive action was not mirrored';
    scheduleState();
    return;
  }
  queueReplay(action);
});

ipcMain.on('replay-result', (_event, result) => {
  const pending = pendingActions.get(result.actionId);
  if (!pending) return;
  pending.results.push(result);
  if (pending.results.length >= pending.expected) finalizePending(result.actionId);
});

app.whenReady().then(createWindow);
app.on('before-quit', () => {
  if (torRuntime) torRuntime.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

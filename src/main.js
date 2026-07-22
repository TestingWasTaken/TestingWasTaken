'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const {
  SIDEBAR_WIDTH,
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
let statusText = 'Ready';
let torRuntime = null;
let bridges = [];
let ipResults = Array(MAX_SCREENS).fill(null);
let dnsStatus = 'Direct connection';
let resizeTimer = null;
let stateTimer = null;
let actionSequence = 0;
const pageStates = new Map();
const pendingActions = new Map();
let activityLog = [];

const welcomePath = path.join(__dirname, 'renderer', 'welcome.html');
const welcomeURL = pathToFileURL(welcomePath).href;

function timestamp() {
  return new Date().toLocaleTimeString('en-CA', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function logActivity(level, message) {
  const entry = { time: timestamp(), level, message: String(message || '') };
  activityLog.push(entry);
  if (activityLog.length > 300) activityLog = activityLog.slice(-300);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('activity-log', entry);
  }
}

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

function safetySnapshot() {
  const active = activeViews();
  if (active.length < 2) return { ready: false, reason: 'choose at least two screens' };
  const states = active.map((view) => pageStates.get(view.webContents.id));
  if (states.some((state) => !state)) return { ready: false, reason: 'waiting for page checks' };
  if (states.some((state) => state.loading)) return { ready: false, reason: 'waiting for pages to finish loading' };
  const challenged = states.findIndex((state) => state.challenge);
  if (challenged >= 0) return { ready: false, reason: `security challenge detected on Screen ${challenged + 1}` };
  const keys = states.map((state) => pageKey(state.url));
  if (!keys.every((key) => key === keys[0])) return { ready: false, reason: 'screens are on different pages' };
  return { ready: true, reason: 'screens match' };
}

function statusTextFor(safety) {
  if (networkBusy) return statusText;
  if (syncHardLock) return `${syncHardLock}. Turn synchronization off and on after checking the screens.`;
  if (!syncRequested) return statusText;
  if (!safety.ready) return `Paused: ${safety.reason}`;
  return statusText === 'Ready' || statusText === 'Sync off' ? 'Synchronization ready' : statusText;
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
    status: statusTextFor(safety),
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

function updateLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [windowWidth, height] = mainWindow.getContentSize();
  const width = Math.max(0, windowWidth - SIDEBAR_WIDTH);
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
  resizeTimer = setTimeout(updateLayout, 45);
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
    if (index === 0) logActivity('info', 'Screen 1 started loading');
    scheduleState();
  });

  wc.on('did-stop-loading', () => {
    const existing = pageStates.get(wc.id) || { url: wc.getURL(), challenge: false };
    pageStates.set(wc.id, { ...existing, loading: false });
    wc.send('request-page-state');
    if (index === 0) logActivity('success', 'Screen 1 finished loading');
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
    statusText = `Screen ${index + 1} renderer stopped`;
    logActivity('error', `Screen ${index + 1} renderer stopped: ${details.reason}`);
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
  setTimeout(() => view.webContents.loadURL(welcomeURL), index * 130);
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
    if (typeof ses.clearHostResolverCache === 'function') await ses.clearHostResolverCache();
  }));
}

async function setSessionsTor() {
  torRuntime = await startTorRuntime(app.getPath('userData'), MAX_SCREENS, (line) => {
    logActivity(/warn|error|failed/i.test(line) ? 'warn' : 'info', `Tor · ${line}`);
  });

  const identitySeed = `${Date.now()}-${process.pid}`;
  bridges = await Promise.all(torRuntime.socksPorts.map((socksPort, index) => startTorHttpBridge({
    socksPort,
    username: `relay-${identitySeed}-screen-${index + 1}`,
  })));

  await Promise.all(sessions.map(async (ses, index) => {
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: `http://127.0.0.1:${bridges[index].port}`,
      proxyBypassRules: '<local>',
    });
    await ses.closeAllConnections();
    if (typeof ses.clearHostResolverCache === 'function') await ses.clearHostResolverCache();
  }));
}

async function changeNetwork(mode) {
  if (networkBusy) return { ok: false, mode: networkMode, error: 'Network change already in progress' };
  const requested = mode === 'tor' ? 'tor' : 'direct';
  networkBusy = true;
  syncRequested = false;
  syncHardLock = '';
  statusText = requested === 'tor' ? 'Connecting to Tor…' : 'Switching to Direct…';
  dnsStatus = 'Checking network route…';
  ipResults = Array(MAX_SCREENS).fill(null);
  logActivity('info', requested === 'tor' ? 'Tor route requested' : 'Direct route requested');
  sendStateNow();

  try {
    await closeTorStack();
    if (requested === 'tor') {
      await setSessionsTor();
      networkMode = 'tor';
      dnsStatus = 'Hostnames are sent to Tor through bounded SOCKS5 bridges';
      statusText = 'Tor connected';
      logActivity('success', 'Tor connected. Each screen has a separate SOCKS identity.');
    } else {
      await setSessionsDirect();
      networkMode = 'direct';
      dnsStatus = 'Direct connection';
      statusText = 'Direct connection';
      logActivity('success', 'Direct network route active');
    }

    await Promise.allSettled(activeViews().map((view) => view.webContents.reload()));
    return { ok: true, mode: networkMode };
  } catch (error) {
    const message = error?.message || String(error);
    logActivity('error', `Tor setup failed: ${message}`);
    logActivity('warn', 'Falling back to Direct mode. Use the network selector to retry Tor.');
    await closeTorStack();
    await setSessionsDirect();
    networkMode = 'direct';
    dnsStatus = 'Tor failed; Direct mode restored. See Activity Console.';
    statusText = 'Direct fallback active';
    return { ok: false, mode: 'direct', error: message };
  } finally {
    networkBusy = false;
    scheduleState();
  }
}

async function checkIPs() {
  if (networkBusy) return { ok: false, error: 'Network change in progress' };
  statusText = 'Verifying public IPs…';
  logActivity('info', 'Starting public-IP verification');
  scheduleState();

  const results = await Promise.all(activeViews().map(async (_view, index) => {
    const ses = sessions[index];
    try {
      const response = await ses.fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`IP service returned HTTP ${response.status}`);
      const data = await response.json();
      let isTor = null;
      if (networkMode === 'tor') {
        const torCheck = await ses.fetch('https://check.torproject.org/api/ip', { cache: 'no-store' });
        if (torCheck.ok) isTor = Boolean((await torCheck.json()).IsTor);
      }
      const result = { ip: String(data.ip || 'Unknown'), ok: true, isTor };
      logActivity(isTor === false ? 'warn' : 'success', `Screen ${index + 1} · ${result.ip}${isTor === true ? ' · Tor confirmed' : isTor === false ? ' · Tor not confirmed' : ''}`);
      return result;
    } catch (error) {
      logActivity('error', `Screen ${index + 1} IP check failed: ${error.message}`);
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
      ? `Tor reported ${unsafe} unsafe DNS attempt${unsafe === 1 ? '' : 's'}`
      : allTor
        ? 'DNS guard passed: Tor confirmed on every visible screen'
        : 'Tor verification incomplete; inspect the console results';
    statusText = duplicate ? 'IPs verified; Tor reused an exit IP' : 'IP verification complete';
    if (duplicate) logActivity('warn', 'Tor reused an exit IP on at least two screens. Separate identities do not guarantee unique exits.');
  } else {
    dnsStatus = 'Direct connection';
    statusText = 'IP verification complete';
  }

  scheduleState();
  return { ok: results.every((result) => result.ok), results };
}

function finalizePending(actionId) {
  const pending = pendingActions.get(actionId);
  if (!pending) return;
  pendingActions.delete(actionId);
  const successful = pending.results.filter((result) => result.ok).length;
  const firstFailure = pending.results.find((result) => !result.ok);
  statusText = successful === pending.expected
    ? `Synced ${pending.kind} to ${successful}/${pending.expected}`
    : `Synced ${pending.kind} to ${successful}/${pending.expected}${firstFailure?.reason ? ` · ${firstFailure.reason}` : ''}`;
  logActivity(successful === pending.expected ? 'success' : 'warn', statusText);
  scheduleState(100);
}

function queueReplay(action) {
  const targets = activeViews().slice(1);
  if (!targets.length) return;
  const actionId = ++actionSequence;
  pendingActions.set(actionId, { kind: action.kind, expected: targets.length, results: [] });
  logActivity('info', `Screen 1 action captured: ${action.kind}`);
  targets.forEach((view) => view.webContents.send('replay-action', { actionId, action }));
  setTimeout(() => finalizePending(actionId), 1400);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1160,
    minHeight: 680,
    show: false,
    title: 'Relay',
    backgroundColor: '#d7d7d2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('activity-log-reset', activityLog);
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  for (let index = 0; index < MAX_SCREENS; index += 1) createView(index);
  await setSessionsDirect();
  logActivity('success', 'Relay workspace opened in Direct mode');
  logActivity('info', 'Settings and network events will appear in this console');
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
  logActivity('info', `Navigating all visible screens to ${displayURL(destination)}`);
  await Promise.allSettled(activeViews().map((view) => view.webContents.loadURL(destination)));
  scheduleState();
});

ipcMain.handle('go-back', () => {
  logActivity('info', 'Back requested on all visible screens');
  activeViews().forEach((view) => view.webContents.canGoBack() && view.webContents.goBack());
});

ipcMain.handle('go-forward', () => {
  logActivity('info', 'Forward requested on all visible screens');
  activeViews().forEach((view) => view.webContents.canGoForward() && view.webContents.goForward());
});

ipcMain.handle('reload', () => {
  logActivity('info', 'Reloading all visible screens');
  activeViews().forEach((view) => view.webContents.reload());
});

ipcMain.handle('set-screen-count', (_event, value) => {
  screenCount = clampScreenCount(value);
  syncHardLock = '';
  ipResults = Array(MAX_SCREENS).fill(null);
  logActivity('info', `Workspace changed to ${screenCount} screen${screenCount === 1 ? '' : 's'}`);
  updateLayout();
  applyZoom();
  requestPageStates();
  scheduleState();
  return { ok: true, screenCount };
});

ipcMain.handle('set-zoom', (_event, value) => {
  zoomFactor = clampZoom(value);
  applyZoom();
  logActivity('info', `Shared zoom changed to ${Math.round(zoomFactor * 100)}%`);
  scheduleState();
  return { ok: true, zoomFactor };
});

ipcMain.handle('set-network', (_event, value) => changeNetwork(value));
ipcMain.handle('check-ips', checkIPs);

ipcMain.handle('set-sync', (_event, enabled) => {
  syncRequested = Boolean(enabled);
  syncHardLock = '';
  statusText = syncRequested ? 'Checking screens…' : 'Sync off';
  logActivity('info', syncRequested ? 'Synchronization enabled' : 'Synchronization disabled');
  requestPageStates();
  setTimeout(() => scheduleState(), 120);
  return { ok: true, enabled: syncRequested };
});

ipcMain.handle('clear-console', () => {
  activityLog = [];
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('activity-log-reset', []);
  logActivity('info', 'Activity console cleared');
  return { ok: true };
});

ipcMain.on('page-state', (event, state) => {
  const viewIndex = views.findIndex((view) => view.webContents.id === event.sender.id);
  if (viewIndex < 0) return;
  const previous = pageStates.get(event.sender.id) || {};
  pageStates.set(event.sender.id, { ...previous, ...state, loading: false, screenNumber: viewIndex + 1 });
  if (syncRequested && state.challenge) {
    syncHardLock = `Security challenge detected on Screen ${viewIndex + 1}`;
    logActivity('warn', `${syncHardLock}; synchronization paused`);
  }
  scheduleState(80);
});

ipcMain.on('page-action', (event, action) => {
  const sourceIndex = views.findIndex((view) => view.webContents.id === event.sender.id);
  if (sourceIndex !== 0 || !syncRequested || syncHardLock) return;
  const safety = safetySnapshot();
  if (!safety.ready) {
    statusText = `Not synced: ${safety.reason}`;
    logActivity('warn', statusText);
    scheduleState(100);
    return;
  }
  if (actionLooksSensitive(action)) {
    syncHardLock = 'Sensitive action was not mirrored';
    logActivity('warn', syncHardLock);
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

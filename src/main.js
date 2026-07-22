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
let statusText = 'Direct · Sync off';
let dnsStatus = 'Direct connection';
let errorState = false;
let torRuntime = null;
let bridges = [];
let ipResults = Array(MAX_SCREENS).fill(null);
let resizeTimer = null;
let stateTimer = null;
let actionSequence = 0;
let logSequence = 0;
const activityLogs = [];
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

function clockTime() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function logEvent(level, message, detail = '') {
  const entry = {
    id: ++logSequence,
    time: clockTime(),
    level: ['info', 'warn', 'error', 'action'].includes(level) ? level : 'info',
    message: String(message || ''),
    detail: String(detail || ''),
  };
  activityLogs.push(entry);
  while (activityLogs.length > 250) activityLogs.shift();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('activity-log', entry);
  return entry;
}

function statusTextFor(safety) {
  if (networkBusy) return statusText;
  if (errorState) return statusText;
  if (!syncRequested) return networkMode === 'tor' ? 'Tor · Sync off' : 'Direct · Sync off';
  if (!safety.ready) return `Sync paused · ${safety.reason}`;
  return statusText || 'Sync ready';
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
    status: syncHardLock ? `${syncHardLock}. Toggle Sync activity after checking the screens.` : statusTextFor(safety),
    ips: ipResults,
    dnsStatus,
    errorState,
    canGoBack: views[0]?.webContents.canGoBack() || false,
    canGoForward: views[0]?.webContents.canGoForward() || false,
  });
}

function scheduleState(delay = 40) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendStateNow, delay);
}

function safetySnapshot() {
  const active = activeViews();
  if (active.length < 2) return { ready: false, reason: 'choose at least two screens' };
  const states = active.map((view) => pageStates.get(view.webContents.id));
  if (states.some((state) => !state)) return { ready: false, reason: 'waiting for page checks' };
  if (states.some((state) => state.loading)) return { ready: false, reason: 'waiting for pages to finish loading' };
  const challenged = states.findIndex((state) => state.challenge);
  if (challenged >= 0) return { ready: false, reason: `security challenge on Screen ${challenged + 1}` };
  const keys = states.map((state) => pageKey(state.url));
  if (!keys.every((key) => key === keys[0])) return { ready: false, reason: 'screens are on different pages' };
  return { ready: true, reason: 'screens match' };
}

function updateLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const workspaceWidth = Math.max(0, width - SIDEBAR_WIDTH);
  const cells = layoutCells(screenCount, workspaceWidth, height);
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
    scheduleState();
  });
  wc.on('did-stop-loading', () => {
    const existing = pageStates.get(wc.id) || { url: wc.getURL(), challenge: false };
    pageStates.set(wc.id, { ...existing, loading: false });
    wc.send('request-page-state');
    if (index === 0) logEvent('info', 'Page finished loading', displayURL(wc.getURL()));
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
    statusText = `Screen ${index + 1} stopped`;
    errorState = true;
    logEvent('error', `Screen ${index + 1} renderer stopped`, details.reason);
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
  if (torRuntime) {
    try { torRuntime.stop(); } catch {}
  }
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
  torRuntime = await startTorRuntime(app.getPath('userData'), MAX_SCREENS, (entry) => {
    logEvent(entry.level || 'info', entry.message || 'Tor', entry.detail || '');
  });
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  bridges = await Promise.all(torRuntime.socksPorts.map((socksPort, index) => startTorHttpBridge({
    socksPort,
    username: `relay-screen-${index + 1}`,
    password: `${token}-${index + 1}`,
  })));
  await Promise.all(sessions.map(async (ses, index) => {
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: `http://127.0.0.1:${bridges[index].port}`,
      proxyBypassRules: '<local>',
    });
    await ses.closeAllConnections();
    await ses.clearHostResolverCache();
  }));
  logEvent('info', 'Tor routes assigned to all screens', torRuntime.sourceDescription || 'Tor SOCKS routing active');
}

async function restoreDirectAfterFailure(error) {
  try { await closeTorStack(); } catch {}
  try { await setSessionsDirect(); } catch (directError) {
    logEvent('error', 'Direct-mode recovery also reported an error', directError.message);
  }
  networkMode = 'direct';
  dnsStatus = 'Direct connection · Tor retry available in Settings';
  statusText = 'Tor failed · Direct mode active';
  errorState = true;
  const tail = Array.isArray(error?.torLogs) ? error.torLogs.slice(-12).join('\n') : '';
  logEvent('error', 'Tor could not connect; Relay stayed open in Direct mode', [error?.message || String(error), tail].filter(Boolean).join('\n'));
}

async function changeNetwork(mode) {
  if (networkBusy) return { ok: false, busy: true, mode: networkMode };
  const requested = mode === 'tor' ? 'tor' : 'direct';
  networkBusy = true;
  syncRequested = false;
  syncHardLock = '';
  errorState = false;
  statusText = requested === 'tor' ? 'Starting Tor…' : 'Switching to Direct…';
  dnsStatus = 'Changing network route…';
  ipResults = Array(MAX_SCREENS).fill(null);
  logEvent('info', requested === 'tor' ? 'Tor split requested' : 'Direct route requested');
  sendStateNow();

  let result;
  try {
    await closeTorStack();
    if (requested === 'tor') {
      await setSessionsTor();
      networkMode = 'tor';
      dnsStatus = 'Remote DNS through SOCKS5 hostname requests';
      statusText = 'Tor connected · Sync off';
      logEvent('info', 'Tor split connected', 'Use Check screen IPs to verify each route.');
    } else {
      await setSessionsDirect();
      networkMode = 'direct';
      dnsStatus = 'Direct connection';
      statusText = 'Direct · Sync off';
      logEvent('info', 'Direct connection active');
    }
    await Promise.allSettled(activeViews().map((view) => view.webContents.reload()));
    result = { ok: true, mode: networkMode };
  } catch (error) {
    await restoreDirectAfterFailure(error);
    await Promise.allSettled(activeViews().map((view) => view.webContents.reload()));
    result = { ok: false, mode: 'direct', error: error?.message || String(error) };
  } finally {
    networkBusy = false;
    scheduleState();
  }
  return result;
}

async function checkIPs() {
  if (networkBusy) return { ok: false, busy: true };
  statusText = 'Checking screen IPs…';
  errorState = false;
  logEvent('info', 'Checking public IP and Tor status for each screen');
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
      logEvent(isTor === false && networkMode === 'tor' ? 'warn' : 'info', `Screen ${index + 1} IP: ${result.ip}`, networkMode === 'tor' ? `Tor verified: ${isTor === true ? 'yes' : isTor === false ? 'no' : 'unknown'}` : 'Direct route');
      return result;
    } catch (error) {
      logEvent('warn', `Screen ${index + 1} IP check failed`, error.message);
      return { ip: 'Unavailable', ok: false, error: error.message, isTor: false };
    }
  }));

  ipResults = Array(MAX_SCREENS).fill(null);
  results.forEach((result, index) => { ipResults[index] = result; });
  const duplicate = results.some((result, index) => result.ok && results.findIndex((other) => other.ok && other.ip === result.ip) !== index);

  if (networkMode === 'tor') {
    const unsafe = torRuntime?.getUnsafeDnsAttempts() || 0;
    const allTor = results.every((result) => result.ok && result.isTor === true);
    dnsStatus = unsafe > 0
      ? `Tor blocked ${unsafe} unsafe DNS attempt${unsafe === 1 ? '' : 's'}`
      : allTor
        ? 'DNS guard passed · all screens verified through Tor'
        : 'Tor verification incomplete · inspect the console';
    statusText = duplicate ? 'IPs checked · Tor reused an exit IP' : 'IPs checked';
    if (duplicate) logEvent('warn', 'Tor reused an exit IP on multiple screens', 'Separate circuits do not guarantee different exits.');
  } else {
    dnsStatus = 'Direct connection';
    statusText = 'IPs checked';
  }
  scheduleState();
  return { ok: true, results };
}

function finalizePending(actionId) {
  const pending = pendingActions.get(actionId);
  if (!pending) return;
  pendingActions.delete(actionId);
  const successful = pending.results.filter((result) => result.ok).length;
  const firstFailure = pending.results.find((result) => !result.ok);
  statusText = `Synced ${pending.kind} to ${successful}/${pending.expected}`;
  logEvent(successful === pending.expected ? 'action' : 'warn', statusText, firstFailure?.reason || '');
  scheduleState(100);
}

function queueReplay(action) {
  const targets = activeViews().slice(1);
  if (!targets.length) return;
  const actionId = ++actionSequence;
  pendingActions.set(actionId, { kind: action.kind, expected: targets.length, results: [] });
  targets.forEach((view) => view.webContents.send('replay-action', { actionId, action }));
  setTimeout(() => finalizePending(actionId), 1400);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 660,
    show: false,
    title: 'Relay',
    backgroundColor: '#cfd4d1',
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
  logEvent('info', 'Relay workspace ready', 'Direct mode active. Settings and live output are available in the right panel.');
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
  errorState = false;
  statusText = 'Loading…';
  logEvent('info', 'Navigating all screens', displayURL(destination));
  await Promise.allSettled(activeViews().map((view) => view.webContents.loadURL(destination)));
  scheduleState();
  return { ok: true };
});
ipcMain.handle('go-back', () => {
  logEvent('action', 'Back on all available screens');
  activeViews().forEach((view) => view.webContents.canGoBack() && view.webContents.goBack());
});
ipcMain.handle('go-forward', () => {
  logEvent('action', 'Forward on all available screens');
  activeViews().forEach((view) => view.webContents.canGoForward() && view.webContents.goForward());
});
ipcMain.handle('reload', () => {
  logEvent('action', 'Reloading visible screens');
  activeViews().forEach((view) => view.webContents.reload());
});
ipcMain.handle('set-screen-count', (_event, value) => {
  screenCount = clampScreenCount(value);
  syncHardLock = '';
  ipResults = Array(MAX_SCREENS).fill(null);
  updateLayout();
  applyZoom();
  requestPageStates();
  logEvent('info', `Workspace changed to ${screenCount} screen${screenCount === 1 ? '' : 's'}`);
  scheduleState();
  return { ok: true };
});
ipcMain.handle('set-zoom', (_event, value) => {
  zoomFactor = clampZoom(value);
  applyZoom();
  logEvent('info', `Shared zoom set to ${Math.round(zoomFactor * 100)}%`);
  scheduleState();
  return { ok: true };
});
ipcMain.handle('set-network', async (_event, value) => {
  try {
    return await changeNetwork(value);
  } catch (error) {
    await restoreDirectAfterFailure(error);
    networkBusy = false;
    scheduleState();
    return { ok: false, mode: 'direct', error: error.message };
  }
});
ipcMain.handle('check-ips', checkIPs);
ipcMain.handle('get-logs', () => activityLogs.slice());
ipcMain.handle('clear-logs', () => {
  activityLogs.length = 0;
  logSequence = 0;
  return { ok: true };
});
ipcMain.handle('set-sync', (_event, enabled) => {
  syncRequested = Boolean(enabled);
  syncHardLock = '';
  errorState = false;
  statusText = syncRequested ? 'Checking screens…' : `${networkMode === 'tor' ? 'Tor' : 'Direct'} · Sync off`;
  requestPageStates();
  logEvent('info', syncRequested ? 'Activity synchronization enabled' : 'Activity synchronization disabled');
  setTimeout(() => scheduleState(), 120);
  return { ok: true };
});

ipcMain.on('page-state', (event, state) => {
  const viewIndex = views.findIndex((view) => view.webContents.id === event.sender.id);
  if (viewIndex < 0) return;
  const previous = pageStates.get(event.sender.id) || {};
  pageStates.set(event.sender.id, { ...previous, ...state, loading: false, screenNumber: viewIndex + 1 });
  if (syncRequested && state.challenge) {
    syncHardLock = `Security challenge detected on Screen ${viewIndex + 1}`;
    logEvent('warn', syncHardLock, 'Synchronization was stopped.');
  }
  scheduleState(80);
});

ipcMain.on('page-action', (event, action) => {
  const sourceIndex = views.findIndex((view) => view.webContents.id === event.sender.id);
  if (sourceIndex !== 0 || !syncRequested || syncHardLock) return;
  const safety = safetySnapshot();
  if (!safety.ready) {
    statusText = `Not synced · ${safety.reason}`;
    logEvent('warn', 'Action was not synchronized', safety.reason);
    scheduleState(100);
    return;
  }
  if (actionLooksSensitive(action)) {
    syncHardLock = 'Sensitive action was not mirrored';
    logEvent('warn', syncHardLock, action.text || action.ariaLabel || action.kind || 'Blocked action');
    scheduleState();
    return;
  }
  logEvent('action', `Captured ${action.kind} from Screen 1`, action.selector || action.text || '');
  queueReplay(action);
});

ipcMain.on('replay-result', (_event, result) => {
  const pending = pendingActions.get(result.actionId);
  if (!pending) return;
  pending.results.push(result);
  if (pending.results.length >= pending.expected) finalizePending(result.actionId);
});

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});
app.on('before-quit', () => {
  if (torRuntime) {
    try { torRuntime.stop(); } catch {}
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

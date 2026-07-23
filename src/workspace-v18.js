'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const { normalizeURL, clampScreenCount, clampZoom } = require('./core');
const { startTorRuntime } = require('./tor-manager');
const { startTorHttpBridge } = require('./tor-bridge');
const {
  installSessionAdBlocker,
  setEnabled: setAdBlockEnabled,
  snapshot: adBlockSnapshot,
} = require('./adblocker');

const MAX_PANES = 8;
const TOOLBAR_HEIGHT = 82;
const LABEL_HEIGHT = 24;
const GAP = 2;
const DEFAULT_URL = 'relay://welcome';

let mainWindow = null;
let views = [];
let sessions = [];
let screenCount = 4;
let zoomFactor = 0.8;
let currentURL = DEFAULT_URL;
let paneURLs = Array(MAX_PANES).fill(DEFAULT_URL);
let paneLabels = Array.from({ length: MAX_PANES }, (_unused, index) => index === 0 ? 'Main' : `Pane ${index + 1}`);
let focusedPane = 0;
let networkMode = 'direct';
let networkBusy = false;
let setupVisible = false;
let torRuntime = null;
let bridges = Array(MAX_PANES).fill(null);
let ipResults = Array(MAX_PANES).fill(null);
let statusText = 'Ready';
let lastResetAt = null;
let resizeTimer = null;
let stateTimer = null;
let saveTimer = null;
let identitySequence = 0;

const welcomePath = path.join(__dirname, 'renderer', 'welcome-v18.html');
const welcomeURL = pathToFileURL(welcomePath).href;

function workspaceFile() {
  return path.join(app.getPath('userData'), 'workspace-v18.json');
}

function displayURL(value) {
  return value === welcomeURL || value === DEFAULT_URL ? DEFAULT_URL : value;
}

function actualURL(value) {
  const normalized = normalizeURL(value);
  return normalized === DEFAULT_URL ? welcomeURL : normalized;
}

function safeStoredURL(value) {
  const normalized = normalizeURL(value);
  return normalized === DEFAULT_URL ? DEFAULT_URL : normalized;
}

function readWorkspace() {
  try {
    const data = JSON.parse(fs.readFileSync(workspaceFile(), 'utf8'));
    screenCount = clampScreenCount(data.screenCount || 4);
    zoomFactor = clampZoom(data.zoomFactor || 0.8);
    currentURL = safeStoredURL(data.currentURL || DEFAULT_URL);
    paneURLs = Array.from({ length: MAX_PANES }, (_unused, index) => safeStoredURL(data.paneURLs?.[index] || currentURL));
    paneLabels = Array.from({ length: MAX_PANES }, (_unused, index) => String(data.paneLabels?.[index] || (index === 0 ? 'Main' : `Pane ${index + 1}`)).slice(0, 28));
  } catch {
    screenCount = 4;
    zoomFactor = 0.8;
    currentURL = DEFAULT_URL;
    paneURLs = Array(MAX_PANES).fill(DEFAULT_URL);
  }
}

function saveWorkspaceSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(workspaceFile()), { recursive: true });
      fs.writeFileSync(workspaceFile(), JSON.stringify({
        screenCount,
        zoomFactor,
        currentURL: displayURL(currentURL),
        paneURLs: paneURLs.map(displayURL),
        paneLabels,
      }, null, 2));
    } catch {}
  }, 180);
}

function activeViews() {
  return views.slice(0, screenCount);
}

function distribute(total, parts) {
  const usable = Math.max(0, total - (GAP * Math.max(0, parts - 1)));
  const base = Math.floor(usable / parts);
  const extra = usable - (base * parts);
  return Array.from({ length: parts }, (_unused, index) => base + (index < extra ? 1 : 0));
}

function gridShape(count) {
  if (count <= 1) return [1, 1];
  if (count === 2) return [2, 1];
  if (count <= 4) return [2, 2];
  if (count <= 6) return [3, 2];
  return [4, 2];
}

function layoutCells(count, width, height) {
  const [columns, rows] = gridShape(count);
  const widths = distribute(width, columns);
  const heights = distribute(Math.max(0, height - TOOLBAR_HEIGHT), rows);
  const xOffsets = [];
  const yOffsets = [];
  let x = 0;
  let y = TOOLBAR_HEIGHT;
  for (const value of widths) { xOffsets.push(x); x += value + GAP; }
  for (const value of heights) { yOffsets.push(y); y += value + GAP; }
  return Array.from({ length: count }, (_unused, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return { x: xOffsets[column], y: yOffsets[row], width: widths[column], height: heights[row] };
  });
}

function sendStateNow() {
  stateTimer = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('workspace-state-v18', {
    screenCount,
    zoomFactor,
    currentURL: displayURL(currentURL),
    paneURLs: paneURLs.map(displayURL),
    paneLabels,
    focusedPane,
    networkMode,
    networkBusy,
    setupVisible,
    status: statusText,
    ips: ipResults,
    lastResetAt,
    adBlock: adBlockSnapshot(),
    canGoBack: views[0]?.webContents.canGoBack() || false,
    canGoForward: views[0]?.webContents.canGoForward() || false,
  });
}

function scheduleState(delay = 30) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendStateNow, delay);
}

function operationProgress(operation, percent, message) {
  mainWindow?.webContents.send('operation-progress-v18', { operation, percent, message });
}

function updateLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (setupVisible || networkBusy) {
    views.forEach((view) => {
      view.setVisible(false);
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    });
    mainWindow.webContents.send('layout-state-v18', { labels: [] });
    return;
  }

  const [width, height] = mainWindow.getContentSize();
  const labels = [];
  if (focusedPane >= 1 && focusedPane <= screenCount) {
    views.forEach((view, index) => {
      if (index === focusedPane - 1) {
        const cell = { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) };
        view.setVisible(true);
        view.setBounds({ x: cell.x, y: cell.y + LABEL_HEIGHT, width: cell.width, height: Math.max(0, cell.height - LABEL_HEIGHT) });
        labels.push({ index, x: cell.x, y: cell.y, width: cell.width, height: LABEL_HEIGHT });
      } else {
        view.setVisible(false);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    });
  } else {
    const cells = layoutCells(screenCount, width, height);
    views.forEach((view, index) => {
      if (index < screenCount) {
        const cell = cells[index];
        view.setVisible(true);
        view.setBounds({ x: cell.x, y: cell.y + LABEL_HEIGHT, width: cell.width, height: Math.max(0, cell.height - LABEL_HEIGHT) });
        labels.push({ index, x: cell.x, y: cell.y, width: cell.width, height: LABEL_HEIGHT });
      } else {
        view.setVisible(false);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    });
  }
  mainWindow.webContents.send('layout-state-v18', { labels });
}

function scheduleLayout() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateLayout, 30);
}

function applyZoom() {
  activeViews().forEach((view) => view.webContents.setZoomFactor(zoomFactor));
}

function configureSession(ses, index) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  installSessionAdBlocker(ses, `Conduit pane ${index + 1}`);
}

function contextMenuForPane(index) {
  return Menu.buildFromTemplate([
    { label: focusedPane === index + 1 ? 'Show all panes' : `Focus ${paneLabels[index]}`, click: () => setFocusedPane(focusedPane === index + 1 ? 0 : index + 1) },
    { label: 'Reload pane', click: () => views[index]?.webContents.reload() },
    { label: 'Reset pane…', click: () => mainWindow?.webContents.send('menu-command-v18', { command: 'reset-pane', payload: index + 1 }) },
    ...(index > 0 ? [{ label: 'Pause or resume following…', click: () => mainWindow?.webContents.send('menu-command-v18', { command: 'toggle-pause', payload: index + 1 }) }] : []),
    { type: 'separator' },
    { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
  ]);
}

function attachViewEvents(view, index) {
  const wc = view.webContents;
  wc.setAudioMuted(index > 0);
  wc.on('did-start-loading', () => { statusText = `${paneLabels[index]} loading`; scheduleState(); });
  wc.on('did-stop-loading', () => {
    paneURLs[index] = displayURL(wc.getURL());
    if (index === 0) currentURL = paneURLs[0];
    wc.send('request-pane-state-v18');
    statusText = 'Ready';
    saveWorkspaceSoon();
    scheduleState(60);
  });
  wc.on('did-navigate', (_event, url) => {
    paneURLs[index] = displayURL(url);
    if (index === 0) currentURL = paneURLs[0];
    saveWorkspaceSoon();
    scheduleState();
  });
  wc.on('did-navigate-in-page', (_event, url) => {
    paneURLs[index] = displayURL(url);
    if (index === 0) currentURL = paneURLs[0];
    saveWorkspaceSoon();
    scheduleState();
  });
  wc.on('context-menu', () => contextMenuForPane(index).popup({ window: mainWindow }));
  wc.on('render-process-gone', (_event, details) => {
    statusText = `${paneLabels[index]} stopped: ${details.reason}`;
    scheduleState();
  });
}

function createView(index) {
  const partition = `persist:conduit-pane-${index + 1}`;
  const ses = session.fromPartition(partition, { cache: true });
  configureSession(ses, index);
  sessions.push(ses);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'page-preload-v18.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: [`--conduit-pane=${index + 1}`],
    },
  });
  attachViewEvents(view, index);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  views.push(view);
  view.webContents.setZoomFactor(zoomFactor);
  setTimeout(() => view.webContents.loadURL(actualURL(paneURLs[index])), index * 80);
}

async function closeTorStack() {
  await Promise.allSettled(sessions.map((ses) => ses.closeAllConnections()));
  const old = bridges;
  bridges = Array(MAX_PANES).fill(null);
  await Promise.allSettled(old.filter(Boolean).map((bridge) => bridge.close()));
  torRuntime?.stop();
  torRuntime = null;
}

async function setSessionDirect(index) {
  await sessions[index].setProxy({ mode: 'direct' });
  await sessions[index].closeAllConnections();
  await sessions[index].clearHostResolverCache?.();
}

async function setAllDirect() {
  await Promise.all(sessions.map((_ses, index) => setSessionDirect(index)));
}

function nextIdentity(index) {
  identitySequence += 1;
  return `conduit-${Date.now()}-${process.pid}-${identitySequence}-${index + 1}`;
}

async function createBridge(index) {
  if (!torRuntime) throw new Error('The local private route is unavailable.');
  const socksPort = torRuntime.socksPorts[index] || torRuntime.port;
  return startTorHttpBridge({ socksPort, username: nextIdentity(index), password: `pane-${index + 1}-${identitySequence}` });
}

async function applyBridge(index, bridge) {
  await sessions[index].setProxy({ mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${bridge.port}`, proxyBypassRules: '<local>' });
  await sessions[index].closeAllConnections();
  await sessions[index].clearHostResolverCache?.();
}

async function setAllPrivate() {
  torRuntime = await startTorRuntime(app.getPath('userData'), MAX_PANES);
  for (let index = 0; index < MAX_PANES; index += 1) {
    bridges[index] = await createBridge(index);
    await applyBridge(index, bridges[index]);
  }
}

async function changeNetwork(mode) {
  if (networkBusy) return { ok: false, error: 'Another operation is running.' };
  const requested = mode === 'tor' ? 'tor' : 'direct';
  networkBusy = true;
  setupVisible = true;
  statusText = requested === 'tor' ? 'Connecting private routes' : 'Restoring standard route';
  updateLayout();
  scheduleState();
  try {
    await setAllDirect();
    await closeTorStack();
    if (requested === 'tor') {
      await setAllPrivate();
      networkMode = 'tor';
      statusText = 'Private routes active';
    } else {
      await setAllDirect();
      networkMode = 'direct';
      statusText = 'Standard route active';
    }
    await Promise.allSettled(activeViews().map((view, index) => view.webContents.loadURL(actualURL(paneURLs[index]))));
    return { ok: true, mode: networkMode };
  } catch (error) {
    await closeTorStack();
    await setAllDirect();
    networkMode = 'direct';
    statusText = 'Standard route restored';
    return { ok: false, mode: 'direct', error: error?.message || String(error) };
  } finally {
    networkBusy = false;
    updateLayout();
    scheduleState();
  }
}

async function checkIPs() {
  networkBusy = true;
  setupVisible = true;
  updateLayout();
  scheduleState();
  try {
    const results = await Promise.all(activeViews().map(async (_view, index) => {
      try {
        const response = await sessions[index].fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
        const data = await response.json();
        return { ok: response.ok, ip: String(data.ip || 'Unknown') };
      } catch (error) {
        return { ok: false, ip: 'Unavailable', error: error?.message || String(error) };
      }
    }));
    ipResults = Array(MAX_PANES).fill(null);
    results.forEach((result, index) => { ipResults[index] = result; });
    statusText = `${results.filter((item) => item.ok).length}/${results.length} routes verified`;
    return { ok: results.every((item) => item.ok), results };
  } finally {
    networkBusy = false;
    updateLayout();
    scheduleState();
  }
}

async function clearPane(index) {
  await sessions[index].closeAllConnections();
  await Promise.allSettled([sessions[index].clearCache(), sessions[index].clearStorageData()]);
  await sessions[index].clearHostResolverCache?.();
  ipResults[index] = null;
}

async function resetPane(paneNumberValue) {
  const paneNumber = Number(paneNumberValue);
  const index = paneNumber - 1;
  if (!Number.isInteger(index) || index < 0 || index >= screenCount) return { ok: false, error: 'Choose a visible pane.' };
  networkBusy = true;
  setupVisible = true;
  updateLayout();
  operationProgress('reset', 10, `Closing ${paneLabels[index]}`);
  try {
    await clearPane(index);
    operationProgress('reset', 55, 'Browser data cleared');
    if (networkMode === 'tor') {
      if (bridges[index]) await bridges[index].close();
      bridges[index] = await createBridge(index);
      await applyBridge(index, bridges[index]);
    } else await setSessionDirect(index);
    operationProgress('reset', 78, 'Route identity renewed');
    await views[index].webContents.loadURL(actualURL(paneURLs[index]));
    lastResetAt = Date.now();
    statusText = `${paneLabels[index]} reset`;
    operationProgress('reset', 100, 'Pane ready');
    return { ok: true, paneNumber };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    networkBusy = false;
    updateLayout();
    scheduleState();
  }
}

async function restartAll() {
  networkBusy = true;
  setupVisible = true;
  updateLayout();
  operationProgress('restart', 8, 'Closing connections');
  try {
    await setAllDirect();
    await closeTorStack();
    operationProgress('restart', 32, 'Clearing pane sessions');
    for (let index = 0; index < MAX_PANES; index += 1) await clearPane(index);
    operationProgress('restart', 58, 'Rebuilding routes');
    if (networkMode === 'tor') await setAllPrivate();
    else await setAllDirect();
    operationProgress('restart', 82, 'Reloading visible panes');
    await Promise.allSettled(activeViews().map((_view, index) => views[index].webContents.loadURL(actualURL(paneURLs[index]))));
    lastResetAt = Date.now();
    statusText = 'Workspace restarted';
    operationProgress('restart', 100, 'Workspace ready');
    return { ok: true };
  } catch (error) {
    networkMode = 'direct';
    await closeTorStack();
    await setAllDirect();
    return { ok: false, error: error?.message || String(error) };
  } finally {
    networkBusy = false;
    updateLayout();
    scheduleState();
  }
}

function setFocusedPane(value) {
  const paneNumber = Number(value);
  focusedPane = Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= screenCount ? paneNumber : 0;
  updateLayout();
  scheduleState();
  return { ok: true, focusedPane };
}

async function createWindow() {
  readWorkspace();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Conduit',
    backgroundColor: '#d8d7d1',
    webPreferences: {
      preload: path.join(__dirname, 'preload-v18.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index-v18.html'));
  for (let index = 0; index < MAX_PANES; index += 1) createView(index);
  await setAllDirect();
  updateLayout();
  sendStateNow();
  mainWindow.on('resize', scheduleLayout);
  mainWindow.on('closed', () => {
    mainWindow = null;
    views = [];
    sessions = [];
  });
}

ipcMain.handle('v18-navigate', async (_event, value) => {
  if (setupVisible || networkBusy) return { ok: false, error: 'Conduit is applying changes.' };
  const destination = actualURL(value);
  currentURL = displayURL(destination);
  await Promise.allSettled(activeViews().map((view, index) => {
    paneURLs[index] = currentURL;
    return view.webContents.loadURL(destination);
  }));
  saveWorkspaceSoon();
  scheduleState();
  return { ok: true };
});
ipcMain.handle('v18-back', () => { activeViews().forEach((view) => view.webContents.canGoBack() && view.webContents.goBack()); return { ok: true }; });
ipcMain.handle('v18-forward', () => { activeViews().forEach((view) => view.webContents.canGoForward() && view.webContents.goForward()); return { ok: true }; });
ipcMain.handle('v18-reload-all', () => { activeViews().forEach((view) => view.webContents.reload()); return { ok: true }; });
ipcMain.handle('v18-reload-active', () => { views[(focusedPane || 1) - 1]?.webContents.reload(); return { ok: true }; });
ipcMain.handle('v18-set-pane-count-workspace', (_event, value) => {
  screenCount = clampScreenCount(value);
  if (focusedPane > screenCount) focusedPane = 0;
  ipResults = Array(MAX_PANES).fill(null);
  updateLayout();
  applyZoom();
  saveWorkspaceSoon();
  scheduleState();
  return { ok: true, screenCount };
});
ipcMain.handle('v18-set-zoom', (_event, value) => { zoomFactor = clampZoom(value); applyZoom(); saveWorkspaceSoon(); scheduleState(); return { ok: true, zoomFactor }; });
ipcMain.handle('v18-set-network', (_event, value) => changeNetwork(value));
ipcMain.handle('v18-check-ips', checkIPs);
ipcMain.handle('v18-reset-pane', (_event, value) => resetPane(value));
ipcMain.handle('v18-restart-all', restartAll);
ipcMain.handle('v18-focus-pane', (_event, value) => setFocusedPane(value));
ipcMain.handle('v18-set-pane-label', (_event, paneNumberValue, labelValue) => {
  const index = Number(paneNumberValue) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PANES) return { ok: false };
  paneLabels[index] = String(labelValue || `Pane ${index + 1}`).trim().slice(0, 28) || `Pane ${index + 1}`;
  saveWorkspaceSoon();
  updateLayout();
  scheduleState();
  return { ok: true, paneLabels };
});
ipcMain.handle('v18-set-settings-visible', (_event, visible) => {
  if (!visible && networkBusy) return { ok: false, error: 'An operation is still running.' };
  setupVisible = Boolean(visible);
  updateLayout();
  scheduleState();
  return { ok: true, visible: setupVisible };
});
ipcMain.handle('v18-get-workspace', () => ({ screenCount, zoomFactor, currentURL: displayURL(currentURL), paneURLs: paneURLs.map(displayURL), paneLabels, focusedPane, networkMode }));
ipcMain.handle('v18-get-adblock', () => adBlockSnapshot());
ipcMain.handle('v18-set-adblock', (_event, enabled) => { const result = setAdBlockEnabled(enabled); scheduleState(); return result; });

app.whenReady().then(createWindow);
app.on('before-quit', () => { saveWorkspaceSoon(); torRuntime?.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

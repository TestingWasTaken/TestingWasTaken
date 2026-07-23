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
const HOME_URL = 'relay://home';
const LEGACY_HOME_URL = 'relay://welcome';
const AUDIO_MODES = new Set(['leader', 'focused', 'all', 'muted']);

let mainWindow = null;
let views = Array(MAX_PANES).fill(null);
let sessions = Array(MAX_PANES).fill(null);
let screenCount = 4;
let zoomFactor = 0.8;
let currentURL = HOME_URL;
let paneURLs = Array(MAX_PANES).fill(HOME_URL);
let paneLabels = Array.from({ length: MAX_PANES }, (_unused, index) => index === 0 ? 'Main' : `Pane ${index + 1}`);
let focusedPane = 0;
let audioMode = 'leader';
let networkMode = 'direct';
let networkBusy = false;
let setupVisible = false;
let torRuntime = null;
let bridges = Array(MAX_PANES).fill(null);
let ipResults = Array(MAX_PANES).fill(null);
let statusText = 'Starting';
let lastResetAt = null;
let resizeTimer = null;
let stateTimer = null;
let saveTimer = null;
let identitySequence = 0;

const homePath = path.join(__dirname, 'renderer', 'welcome-v18.html');
const homeFileURL = pathToFileURL(homePath).href;

function workspaceFile() {
  return path.join(app.getPath('userData'), 'workspace-v21.json');
}

function isHome(value) {
  return value === HOME_URL || value === LEGACY_HOME_URL || value === homeFileURL;
}

function displayURL(value) {
  return isHome(value) ? HOME_URL : value;
}

function actualURL(value) {
  const normalized = normalizeURL(value);
  return isHome(normalized) ? homeFileURL : normalized;
}

function safeStoredURL(value) {
  const normalized = normalizeURL(value);
  return isHome(normalized) ? HOME_URL : normalized;
}

function readWorkspace() {
  screenCount = 4;
  try {
    const data = JSON.parse(fs.readFileSync(workspaceFile(), 'utf8'));
    zoomFactor = clampZoom(data.zoomFactor || 0.8);
    currentURL = safeStoredURL(data.currentURL || HOME_URL);
    paneURLs = Array.from(
      { length: MAX_PANES },
      (_unused, index) => safeStoredURL(data.paneURLs?.[index] || currentURL),
    );
    paneLabels = Array.from(
      { length: MAX_PANES },
      (_unused, index) => String(
        data.paneLabels?.[index] || (index === 0 ? 'Main' : `Pane ${index + 1}`),
      ).slice(0, 28),
    );
    audioMode = AUDIO_MODES.has(data.audioMode) ? data.audioMode : 'leader';
  } catch {
    zoomFactor = 0.8;
    currentURL = HOME_URL;
    paneURLs = Array(MAX_PANES).fill(HOME_URL);
    paneLabels = Array.from({ length: MAX_PANES }, (_unused, index) => index === 0 ? 'Main' : `Pane ${index + 1}`);
    audioMode = 'leader';
  }
}

function saveWorkspaceSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(workspaceFile()), { recursive: true });
      fs.writeFileSync(workspaceFile(), JSON.stringify({
        zoomFactor,
        currentURL: displayURL(currentURL),
        paneURLs: paneURLs.map(displayURL),
        paneLabels,
        audioMode,
      }, null, 2));
    } catch {}
  }, 220);
}

function existingViews() {
  return views.filter(Boolean);
}

function activeViews() {
  return views.slice(0, screenCount).filter(Boolean);
}

function activeSessions() {
  return sessions.slice(0, screenCount).filter(Boolean);
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
  for (const value of widths) {
    xOffsets.push(x);
    x += value + GAP;
  }
  for (const value of heights) {
    yOffsets.push(y);
    y += value + GAP;
  }

  return Array.from({ length: count }, (_unused, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: xOffsets[column],
      y: yOffsets[row],
      width: widths[column],
      height: heights[row],
    };
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
    audioMode,
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

function scheduleState(delay = 55) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendStateNow, delay);
}

function operationProgress(operation, percent, message) {
  mainWindow?.webContents.send('operation-progress-v18', { operation, percent, message });
}

function hideAllViews() {
  for (const view of existingViews()) {
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

function updateLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (setupVisible || networkBusy) {
    hideAllViews();
    mainWindow.webContents.send('layout-state-v18', { labels: [] });
    return;
  }

  const [width, height] = mainWindow.getContentSize();
  const labels = [];

  if (focusedPane >= 1 && focusedPane <= screenCount) {
    views.forEach((view, index) => {
      if (!view) return;
      if (index === focusedPane - 1) {
        const cell = {
          x: 0,
          y: TOOLBAR_HEIGHT,
          width,
          height: Math.max(0, height - TOOLBAR_HEIGHT),
        };
        view.setVisible(true);
        view.setBounds({
          x: cell.x,
          y: cell.y + LABEL_HEIGHT,
          width: cell.width,
          height: Math.max(0, cell.height - LABEL_HEIGHT),
        });
        labels.push({ index, x: cell.x, y: cell.y, width: cell.width, height: LABEL_HEIGHT });
      } else {
        view.setVisible(false);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    });
  } else {
    const cells = layoutCells(screenCount, width, height);
    views.forEach((view, index) => {
      if (!view) return;
      if (index < screenCount) {
        const cell = cells[index];
        view.setVisible(true);
        view.setBounds({
          x: cell.x,
          y: cell.y + LABEL_HEIGHT,
          width: cell.width,
          height: Math.max(0, cell.height - LABEL_HEIGHT),
        });
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
  resizeTimer = setTimeout(updateLayout, 40);
}

function applyZoom() {
  for (const view of activeViews()) view.webContents.setZoomFactor(zoomFactor);
}

function audiblePaneIndex() {
  if (audioMode === 'focused') return Math.max(0, (focusedPane || 1) - 1);
  return 0;
}

function applyAudioMode() {
  const selected = audiblePaneIndex();
  views.forEach((view, index) => {
    if (!view) return;
    let audible = false;
    if (index < screenCount) {
      if (audioMode === 'all') audible = true;
      else if (audioMode === 'leader') audible = index === 0;
      else if (audioMode === 'focused') audible = index === selected;
    }
    if (audioMode === 'muted') audible = false;
    view.webContents.setAudioMuted(!audible);
  });
}

function configureSession(ses, index) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  installSessionAdBlocker(ses, `Conduit pane ${index + 1}`);
}

function contextMenuForPane(index) {
  return Menu.buildFromTemplate([
    {
      label: focusedPane === index + 1 ? 'Show all panes' : `Focus ${paneLabels[index]}`,
      click: () => setFocusedPane(focusedPane === index + 1 ? 0 : index + 1),
    },
    { label: 'Reload pane', click: () => views[index]?.webContents.reload() },
    {
      label: 'Reset pane…',
      click: () => mainWindow?.webContents.send('menu-command-v18', {
        command: 'reset-pane',
        payload: index + 1,
      }),
    },
    ...(index > 0 ? [{
      label: 'Pause or resume following…',
      click: () => mainWindow?.webContents.send('menu-command-v18', {
        command: 'toggle-pause',
        payload: index + 1,
      }),
    }] : []),
    { type: 'separator' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ]);
}

function attachViewEvents(view, index) {
  const wc = view.webContents;
  wc.setAudioMuted(true);

  wc.on('did-start-loading', () => {
    statusText = `${paneLabels[index]} loading`;
    scheduleState();
  });

  wc.on('did-stop-loading', () => {
    paneURLs[index] = displayURL(wc.getURL());
    if (index === 0) currentURL = paneURLs[0];
    wc.send('request-pane-state-v18');
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.send('request-pane-state-v18');
    }, 420);
    statusText = 'Ready';
    saveWorkspaceSoon();
    applyAudioMode();
    scheduleState(80);
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
    globalThis.__conduitCoordinatorV21?.forgetPane(index + 1);
    scheduleState();
  });
}

function getOrCreateSession(index) {
  if (sessions[index]) return sessions[index];
  const partition = `persist:conduit-pane-${index + 1}`;
  const ses = session.fromPartition(partition, { cache: true });
  configureSession(ses, index);
  sessions[index] = ses;
  return ses;
}

function buildView(index) {
  const partition = `persist:conduit-pane-${index + 1}`;
  getOrCreateSession(index);

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
  view.webContents.setZoomFactor(zoomFactor);
  views[index] = view;
  return view;
}

function ensureView(index) {
  if (views[index] && !views[index].webContents.isDestroyed()) return views[index];
  const view = buildView(index);
  setTimeout(() => {
    if (!view.webContents.isDestroyed()) {
      view.webContents.loadURL(actualURL(paneURLs[index])).catch(() => {});
    }
  }, Math.min(index, 4) * 55);
  return view;
}

function ensureViews(count) {
  for (let index = 0; index < count; index += 1) ensureView(index);
}

async function recreateView(index) {
  const old = views[index];
  globalThis.__conduitCoordinatorV21?.forgetPane(index + 1);

  if (old) {
    try {
      mainWindow.contentView.removeChildView(old);
    } catch {}
    views[index] = null;
    if (!old.webContents.isDestroyed()) old.webContents.close();
  }

  const view = buildView(index);
  await view.webContents.loadURL(actualURL(paneURLs[index]));
  view.webContents.setZoomFactor(zoomFactor);
  applyAudioMode();

  for (const delay of [40, 260, 780, 1500]) {
    setTimeout(() => {
      if (!view.webContents.isDestroyed()) view.webContents.send('request-pane-state-v18');
    }, delay);
  }

  return view;
}

async function closeTorStack() {
  await Promise.allSettled(activeSessions().map((ses) => ses.closeAllConnections()));
  const old = bridges;
  bridges = Array(MAX_PANES).fill(null);
  await Promise.allSettled(old.filter(Boolean).map((bridge) => bridge.close()));
  torRuntime?.stop();
  torRuntime = null;
}

async function setSessionDirect(index) {
  const ses = getOrCreateSession(index);
  await ses.setProxy({ mode: 'direct' });
  await ses.closeAllConnections();
  await ses.clearHostResolverCache?.();
}

async function setAllDirect() {
  await Promise.all(
    sessions.map((ses, index) => (ses ? setSessionDirect(index) : Promise.resolve())),
  );
}

function nextIdentity(index) {
  identitySequence += 1;
  return `conduit-${Date.now()}-${process.pid}-${identitySequence}-${index + 1}`;
}

async function createBridge(index) {
  if (!torRuntime) {
    throw new Error('Multiple IPs requires a compatible local private-route service.');
  }
  const socksPort = torRuntime.socksPorts[index] || torRuntime.port;
  return startTorHttpBridge({
    socksPort,
    username: nextIdentity(index),
    password: `pane-${index + 1}-${identitySequence}`,
  });
}

async function applyBridge(index, bridge) {
  const ses = getOrCreateSession(index);
  await ses.setProxy({
    mode: 'fixed_servers',
    proxyRules: `http://127.0.0.1:${bridge.port}`,
    proxyBypassRules: '<local>',
  });
  await ses.closeAllConnections();
  await ses.clearHostResolverCache?.();
}

async function setPanePrivate(index) {
  if (bridges[index]) await bridges[index].close();
  bridges[index] = await createBridge(index);
  await applyBridge(index, bridges[index]);
}

async function setAllPrivate() {
  torRuntime = await startTorRuntime(app.getPath('userData'), MAX_PANES);
  for (let index = 0; index < screenCount; index += 1) {
    await setPanePrivate(index);
    operationProgress('network', 25 + Math.round(((index + 1) / screenCount) * 55), `Preparing IP ${index + 1} of ${screenCount}`);
  }
}

async function changeNetwork(mode) {
  if (networkBusy) return { ok: false, error: 'Another operation is running.' };

  const requested = mode === 'tor' ? 'tor' : 'direct';
  networkBusy = true;
  setupVisible = true;
  statusText = requested === 'tor' ? 'Connecting Multiple IPs' : 'Connecting Standard';
  operationProgress('network', 8, 'Closing old connections');
  updateLayout();
  scheduleState(10);

  try {
    await setAllDirect();
    await closeTorStack();

    if (requested === 'tor') {
      operationProgress('network', 18, 'Starting private routes');
      await setAllPrivate();
      networkMode = 'tor';
      statusText = 'Multiple IPs active';
    } else {
      operationProgress('network', 58, 'Restoring the normal route');
      await setAllDirect();
      networkMode = 'direct';
      statusText = 'Standard active';
    }

    operationProgress('network', 88, 'Reloading panes');
    await Promise.allSettled(
      activeViews().map((view, index) => view.webContents.loadURL(actualURL(paneURLs[index]))),
    );
    operationProgress('network', 100, 'Connection ready');
    return { ok: true, mode: networkMode };
  } catch (error) {
    await closeTorStack();
    await setAllDirect();
    networkMode = 'direct';
    statusText = 'Standard restored';
    return {
      ok: false,
      mode: 'direct',
      error: error?.message || String(error),
    };
  } finally {
    networkBusy = false;
    setupVisible = false;
    applyAudioMode();
    updateLayout();
    scheduleState(20);
  }
}

async function fetchJSONWithTimeout(ses, url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await ses.fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRoute(data, source) {
  const ip = data?.ip || data?.query;
  if (!ip) return null;

  const city = data.city || '';
  const region = data.region_code || data.region || data.regionName || '';
  const country = data.country_code || data.country_code_iso3 || data.countryCode || data.country || '';
  let location = [city, region, country].filter(Boolean).join(', ');

  if (!location && data.country_name) location = data.country_name;
  if (!location && data.country) location = data.country;

  return {
    ok: true,
    ip: String(ip),
    location: location || 'Location unavailable',
    city: String(city || ''),
    region: String(region || ''),
    country: String(data.country_name || data.country || ''),
    countryCode: String(data.country_code || data.countryCode || ''),
    source,
  };
}

async function fetchRouteDetails(ses) {
  let lastError = null;

  const providers = [
    {
      url: 'https://ipwho.is/',
      source: 'ipwho.is',
      map: (data) => {
        if (data?.success === false) throw new Error(data.message || 'Location lookup failed');
        return normalizeRoute(data, 'ipwho.is');
      },
    },
    {
      url: 'https://ipapi.co/json/',
      source: 'ipapi.co',
      map: (data) => normalizeRoute(data, 'ipapi.co'),
    },
  ];

  for (const provider of providers) {
    try {
      const data = await fetchJSONWithTimeout(ses, provider.url, 10000);
      const route = provider.map(data);
      if (route && route.location !== 'Location unavailable') return route;
      if (route) {
        lastError = new Error('Provider returned no location');
        continue;
      }
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const data = await fetchJSONWithTimeout(ses, 'https://api.ipify.org?format=json', 7000);
    if (!data?.ip) throw new Error('IP lookup failed');
    return {
      ok: true,
      ip: String(data.ip),
      location: 'Location unavailable',
      source: 'api.ipify.org',
    };
  } catch (error) {
    return {
      ok: false,
      ip: 'Unavailable',
      location: '',
      error: error?.message || lastError?.message || String(error),
    };
  }
}

async function checkIPs() {
  if (networkBusy) return { ok: false, error: 'Another operation is running.' };

  networkBusy = true;
  setupVisible = true;
  statusText = 'Checking IP addresses and locations';
  operationProgress('verify', 8, 'Starting route checks');
  updateLayout();
  scheduleState(10);

  try {
    let completed = 0;
    const results = await Promise.all(
      Array.from({ length: screenCount }, async (_unused, index) => {
        const result = await fetchRouteDetails(getOrCreateSession(index));
        ipResults[index] = result;
        completed += 1;
        operationProgress(
          'verify',
          10 + Math.round((completed / screenCount) * 88),
          `Checked ${completed} of ${screenCount} panes`,
        );
        scheduleState(5);
        return result;
      }),
    );

    for (let index = screenCount; index < MAX_PANES; index += 1) ipResults[index] = null;
    statusText = `${results.filter((item) => item.ok).length}/${results.length} locations checked`;
    return { ok: results.every((item) => item.ok), results };
  } finally {
    networkBusy = false;
    setupVisible = false;
    operationProgress('verify', 100, 'Route check complete');
    updateLayout();
    scheduleState(20);
  }
}

async function clearPane(index) {
  const ses = getOrCreateSession(index);
  await ses.closeAllConnections();
  await Promise.allSettled([ses.clearCache(), ses.clearStorageData()]);
  await ses.clearHostResolverCache?.();
  ipResults[index] = null;
}

async function resetPane(paneNumberValue) {
  const paneNumber = Number(paneNumberValue);
  const index = paneNumber - 1;
  if (!Number.isInteger(index) || index < 0 || index >= screenCount) {
    return { ok: false, error: 'Choose a visible pane.' };
  }
  if (networkBusy) return { ok: false, error: 'Another operation is running.' };

  networkBusy = true;
  setupVisible = true;
  updateLayout();
  operationProgress('reset', 8, `Disconnecting ${paneLabels[index]}`);

  try {
    globalThis.__conduitCoordinatorV21?.forgetPane(paneNumber);
    await clearPane(index);
    operationProgress('reset', 40, 'Browser data cleared');

    if (networkMode === 'tor') {
      await setPanePrivate(index);
    } else {
      await setSessionDirect(index);
    }

    operationProgress('reset', 68, 'Rebuilding the pane');
    await recreateView(index);
    operationProgress('reset', 90, 'Reconnecting following');

    lastResetAt = Date.now();
    statusText = `${paneLabels[index]} reset`;
    operationProgress('reset', 100, 'Pane connected');
    return { ok: true, paneNumber };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    networkBusy = false;
    setupVisible = false;
    applyAudioMode();
    updateLayout();
    scheduleState(20);
  }
}

async function restartAll() {
  if (networkBusy) return { ok: false, error: 'Another operation is running.' };

  const requestedNetwork = networkMode;
  networkBusy = true;
  setupVisible = true;
  updateLayout();
  operationProgress('restart', 8, 'Closing connections');

  try {
    await setAllDirect();
    await closeTorStack();

    operationProgress('restart', 30, 'Clearing pane data');
    for (let index = 0; index < screenCount; index += 1) {
      await clearPane(index);
      globalThis.__conduitCoordinatorV21?.forgetPane(index + 1);
    }

    operationProgress('restart', 52, 'Rebuilding connection');
    if (requestedNetwork === 'tor') {
      await setAllPrivate();
      networkMode = 'tor';
    } else {
      await setAllDirect();
      networkMode = 'direct';
    }

    operationProgress('restart', 72, 'Rebuilding panes');
    for (let index = 0; index < screenCount; index += 1) {
      await recreateView(index);
    }

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
    setupVisible = false;
    applyAudioMode();
    updateLayout();
    scheduleState(20);
  }
}

function setFocusedPane(value) {
  const paneNumber = Number(value);
  focusedPane = Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= screenCount
    ? paneNumber
    : 0;
  applyAudioMode();
  updateLayout();
  scheduleState();
  return { ok: true, focusedPane };
}

function setAudioMode(value) {
  audioMode = AUDIO_MODES.has(value) ? value : 'leader';
  applyAudioMode();
  saveWorkspaceSoon();
  scheduleState();
  return { ok: true, audioMode };
}

async function setPaneCount(value) {
  const next = clampScreenCount(value);
  const previous = screenCount;
  ensureViews(next);
  screenCount = next;

  if (focusedPane > screenCount) focusedPane = 0;
  ipResults = Array(MAX_PANES).fill(null);

  if (networkMode === 'tor' && next > previous) {
    networkBusy = true;
    setupVisible = true;
    updateLayout();
    try {
      for (let index = previous; index < next; index += 1) {
        await setPanePrivate(index);
      }
    } finally {
      networkBusy = false;
      setupVisible = false;
    }
  } else if (networkMode === 'tor' && next < previous) {
    for (let index = next; index < previous; index += 1) {
      if (bridges[index]) {
        await bridges[index].close().catch(() => {});
        bridges[index] = null;
      }
      if (sessions[index]) await setSessionDirect(index).catch(() => {});
    }
  }

  applyZoom();
  applyAudioMode();
  updateLayout();
  scheduleState();
  return { ok: true, screenCount };
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
    backgroundColor: '#25272d',
    webPreferences: {
      preload: path.join(__dirname, 'preload-v18.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index-v18.html'));

  ensureViews(4);
  await setAllDirect();
  applyAudioMode();
  statusText = 'Ready';
  updateLayout();
  sendStateNow();

  mainWindow.on('resize', scheduleLayout);
  mainWindow.on('closed', () => {
    mainWindow = null;
    views = Array(MAX_PANES).fill(null);
    sessions = Array(MAX_PANES).fill(null);
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

ipcMain.handle('v18-back', () => {
  activeViews().forEach((view) => view.webContents.canGoBack() && view.webContents.goBack());
  return { ok: true };
});

ipcMain.handle('v18-forward', () => {
  activeViews().forEach((view) => view.webContents.canGoForward() && view.webContents.goForward());
  return { ok: true };
});

ipcMain.handle('v18-reload-all', () => {
  activeViews().forEach((view) => view.webContents.reload());
  return { ok: true };
});

ipcMain.handle('v18-reload-active', () => {
  views[(focusedPane || 1) - 1]?.webContents.reload();
  return { ok: true };
});

ipcMain.handle('v18-set-pane-count-workspace', (_event, value) => setPaneCount(value));

ipcMain.handle('v18-set-zoom', (_event, value) => {
  zoomFactor = clampZoom(value);
  applyZoom();
  saveWorkspaceSoon();
  scheduleState();
  return { ok: true, zoomFactor };
});

ipcMain.handle('v18-set-audio-mode', (_event, value) => setAudioMode(value));
ipcMain.handle('v18-set-network', (_event, value) => changeNetwork(value));
ipcMain.handle('v18-check-ips', checkIPs);
ipcMain.handle('v18-reset-pane', (_event, value) => resetPane(value));
ipcMain.handle('v18-restart-all', restartAll);
ipcMain.handle('v18-focus-pane', (_event, value) => setFocusedPane(value));

ipcMain.handle('v18-set-pane-label', (_event, paneNumberValue, labelValue) => {
  const index = Number(paneNumberValue) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PANES) return { ok: false };
  paneLabels[index] = String(labelValue || `Pane ${index + 1}`).trim().slice(0, 28)
    || `Pane ${index + 1}`;
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

ipcMain.handle('v18-get-workspace', () => ({
  screenCount,
  zoomFactor,
  currentURL: displayURL(currentURL),
  paneURLs: paneURLs.map(displayURL),
  paneLabels,
  focusedPane,
  audioMode,
  networkMode,
  ips: ipResults,
  lastResetAt,
  adBlock: adBlockSnapshot(),
}));

ipcMain.handle('v18-get-adblock', () => adBlockSnapshot());
ipcMain.handle('v18-set-adblock', (_event, enabled) => {
  const result = setAdBlockEnabled(enabled);
  scheduleState();
  return result;
});

app.whenReady().then(createWindow);
app.on('before-quit', () => {
  saveWorkspaceSoon();
  torRuntime?.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

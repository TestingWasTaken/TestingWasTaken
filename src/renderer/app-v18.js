'use strict';

const $ = (selector) => document.querySelector(selector);
const PRESET_KEY = 'conduit.workspace-presets.v18';
const APPEARANCE_KEY = 'conduit.appearance.v18';

const address = $('#address');
const addressForm = $('#address-form');
const back = $('#back');
const forward = $('#forward');
const reload = $('#reload');
const quickPaneCount = $('#quick-pane-count');
const quickFollow = $('#quick-follow');
const openSettingsButton = $('#open-settings');
const homeLink = $('#home-link');
const paneLabelsLayer = $('#pane-labels');

const backdrop = $('#settings-backdrop');
const closeSettingsButton = $('#close-settings');
const cancelSettingsButton = $('#cancel-settings');
const applySettingsButton = $('#apply-settings');
const settingPaneCount = $('#setting-pane-count');
const settingZoom = $('#setting-zoom');
const settingAppearance = $('#setting-appearance');
const settingFollow = $('#setting-follow');
const verifyRoutes = $('#verify-routes');
const adFilter = $('#ad-filter');
const policyNavigation = $('#policy-navigation');
const policyScrolling = $('#policy-scrolling');
const policyTyping = $('#policy-typing');
const policyClicks = $('#policy-clicks');
const presetSelect = $('#preset-select');
const savePresetButton = $('#save-preset');
const deletePresetButton = $('#delete-preset');
const restartAllButton = $('#restart-all');
const highLoadNote = $('#high-load-note');
const lastReset = $('#last-reset');
const topologyList = $('#topology-list');
const topologySummary = $('#topology-summary');
const showAllPanes = $('#show-all-panes');
const jujharLink = $('#jujhar-link');

const operationStrip = $('#operation-strip');
const operationTitle = $('#operation-title');
const operationMessage = $('#operation-message');
const operationPercent = $('#operation-percent');
const progressFill = $('#progress-fill');

let state = null;
let health = null;
let layout = [];
let busy = false;
let requestedNetwork = 'direct';
let pendingPause = new Set();

function appearance(value) {
  const next = ['system', 'light', 'dark'].includes(value) ? value : 'system';
  document.documentElement.dataset.appearance = next;
  settingAppearance.value = next;
  localStorage.setItem(APPEARANCE_KEY, next);
}

function presets() {
  try {
    const value = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storePresets(value) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(value.slice(0, 12)));
  renderPresetOptions();
}

function renderPresetOptions() {
  const selected = presetSelect.value;
  presetSelect.replaceChildren(new Option('Choose a preset…', ''));
  presets().forEach((preset, index) => presetSelect.appendChild(new Option(preset.name, String(index))));
  if ([...presetSelect.options].some((option) => option.value === selected)) presetSelect.value = selected;
}

function currentPolicy() {
  return {
    navigation: policyNavigation.checked,
    scrolling: policyScrolling.checked,
    typing: policyTyping.checked,
    clicks: policyClicks.checked,
  };
}

function selectedNetwork() {
  return document.querySelector('input[name="network"]:checked')?.value || 'direct';
}

function setNetworkControl(value) {
  const input = document.querySelector(`input[name="network"][value="${value}"]`);
  if (input) input.checked = true;
  requestedNetwork = value;
}

function setBusy(value, title = 'Applying changes', message = 'Starting…') {
  busy = Boolean(value);
  document.body.classList.toggle('busy', busy);
  operationStrip.hidden = !busy;
  operationTitle.textContent = title;
  operationMessage.textContent = message;
  operationPercent.textContent = busy ? '0%' : '';
  progressFill.style.width = busy ? '0%' : '0';
  closeSettingsButton.disabled = busy;
  cancelSettingsButton.disabled = busy;
  applySettingsButton.disabled = busy;
}

function progress(percent, message) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  operationPercent.textContent = `${value}%`;
  operationMessage.textContent = message || 'Working…';
  progressFill.style.width = `${value}%`;
}

function updateHighLoadNote() {
  highLoadNote.hidden = Number(settingPaneCount.value) < 7;
}

function formatReset(value) {
  if (!value) return 'No reset this session';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `Last reset ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Last reset ${minutes}m ago`;
}

function updateFacts() {
  if (!state) return;
  const visible = state.screenCount || 1;
  const followerTotal = Math.max(0, visible - 1);
  const verified = (state.ips || []).slice(0, visible).filter((item) => item?.ok).length;
  const blocked = Number(state.adBlock?.totalBlocked || 0);
  $('#fact-panes').textContent = `${visible} pane${visible === 1 ? '' : 's'} open`;
  $('#fact-followers').textContent = `${health?.connectedFollowers || 0}/${followerTotal} followers connected`;
  $('#fact-aligned').textContent = `${health?.caughtUpFollowers || 0} caught up`;
  $('#fact-routes').textContent = verified ? `${verified}/${visible} routes verified` : 'Routes not checked';
  $('#fact-blocked').textContent = `${blocked} requests blocked`;
  lastReset.textContent = formatReset(state.lastResetAt);
}

function rowStatus(row) {
  if (row.paneNumber === 1) return { label: 'Leader', tone: 'good' };
  if (!row.registered) return { label: 'Starting', tone: '' };
  if (row.paused || pendingPause.has(row.paneNumber)) return { label: 'Paused', tone: 'warn' };
  if (row.challenge) return { label: 'Challenge skipped', tone: 'warn' };
  if (row.loading) return { label: 'Loading', tone: '' };
  if (row.caughtUp) return { label: 'Aligned', tone: 'good' };
  if (row.scrollOffset !== null) return { label: `Catching up · ${row.scrollOffset}px`, tone: 'warn' };
  return { label: 'Connected', tone: 'good' };
}

function renderTopology() {
  topologyList.replaceChildren();
  const rows = health?.rows || Array.from({ length: state?.screenCount || 0 }, (_unused, index) => ({ paneNumber: index + 1 }));
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const status = rowStatus(row);
    const item = document.createElement('div');
    item.className = 'topology-row';
    item.dataset.pane = String(row.paneNumber);

    const main = document.createElement('div');
    main.className = 'topology-row-main';
    const dot = document.createElement('span');
    dot.className = `health-dot ${status.tone}`;
    const name = document.createElement('input');
    name.className = 'pane-name-input';
    name.value = state?.paneLabels?.[row.paneNumber - 1] || (row.paneNumber === 1 ? 'Main' : `Pane ${row.paneNumber}`);
    name.dataset.pane = String(row.paneNumber);
    name.setAttribute('aria-label', `Name for pane ${row.paneNumber}`);
    const statusText = document.createElement('span');
    statusText.className = 'pane-state';
    statusText.textContent = status.label;
    main.append(dot, name, statusText);

    const actions = document.createElement('div');
    actions.className = 'topology-actions';
    const focus = document.createElement('button');
    focus.dataset.action = 'focus';
    focus.textContent = state?.focusedPane === row.paneNumber ? 'Show all' : 'Focus';
    const reset = document.createElement('button');
    reset.dataset.action = 'reset';
    reset.textContent = 'Reset';
    actions.append(focus);
    if (row.paneNumber > 1) {
      const pause = document.createElement('button');
      pause.dataset.action = 'pause';
      pause.textContent = row.paused ? 'Resume' : 'Pause';
      actions.append(pause);
    }
    actions.append(reset);
    item.append(main, actions);
    fragment.appendChild(item);
  });
  topologyList.appendChild(fragment);
  const followerTotal = Math.max(0, (state?.screenCount || 1) - 1);
  topologySummary.textContent = health
    ? `${health.connectedFollowers}/${followerTotal} connected · ${health.caughtUpFollowers} aligned${health.pausedCount ? ` · ${health.pausedCount} paused` : ''}`
    : 'Waiting for pane health…';
}

function renderLabels() {
  paneLabelsLayer.replaceChildren();
  const fragment = document.createDocumentFragment();
  layout.forEach((cell) => {
    const label = document.createElement('div');
    label.className = 'pane-label';
    Object.assign(label.style, { left: `${cell.x}px`, top: `${cell.y}px`, width: `${cell.width}px`, height: `${cell.height}px` });
    const strong = document.createElement('strong');
    strong.textContent = state?.paneLabels?.[cell.index] || `Pane ${cell.index + 1}`;
    const detail = document.createElement('span');
    const row = health?.rows?.find((item) => item.paneNumber === cell.index + 1);
    detail.textContent = cell.index === 0 ? 'Leader' : row?.paused ? 'Paused' : row?.caughtUp ? 'Aligned' : 'Following';
    label.append(strong, detail);
    fragment.appendChild(label);
  });
  paneLabelsLayer.appendChild(fragment);
}

function render() {
  if (!state) return;
  if (document.activeElement !== address) address.value = state.currentURL;
  back.disabled = !state.canGoBack || busy;
  forward.disabled = !state.canGoForward || busy;
  reload.disabled = busy;
  quickPaneCount.value = String(state.screenCount);
  quickFollow.setAttribute('aria-pressed', String(Boolean(health?.followingEnabled)));
  settingPaneCount.value = String(state.screenCount);
  settingZoom.value = String(state.zoomFactor);
  settingFollow.checked = Boolean(health?.followingEnabled);
  adFilter.checked = state.adBlock?.enabled !== false;
  setNetworkControl(state.networkMode || requestedNetwork);
  lastReset.textContent = formatReset(state.lastResetAt);
  updateHighLoadNote();
  updateFacts();
  renderTopology();
  renderLabels();
}

async function openSettings() {
  if (busy || !state) return;
  settingPaneCount.value = String(state.screenCount);
  settingZoom.value = String(state.zoomFactor);
  settingFollow.checked = Boolean(health?.followingEnabled);
  policyNavigation.checked = health?.policy?.navigation !== false;
  policyScrolling.checked = health?.policy?.scrolling !== false;
  policyTyping.checked = health?.policy?.typing !== false;
  policyClicks.checked = health?.policy?.clicks !== false;
  adFilter.checked = state.adBlock?.enabled !== false;
  setNetworkControl(state.networkMode);
  updateHighLoadNote();
  backdrop.classList.remove('hidden');
  await window.conduit.setSettingsVisible(true);
}

async function closeSettings() {
  if (busy) return;
  const result = await window.conduit.setSettingsVisible(false);
  if (result?.ok !== false) backdrop.classList.add('hidden');
}

async function applySettings() {
  if (busy) return;
  setBusy(true);
  try {
    progress(8, 'Preparing workspace');
    const paneCount = Number(settingPaneCount.value);
    const zoom = Number(settingZoom.value);
    await Promise.all([
      window.conduit.setPaneCount(paneCount),
      window.conduit.setZoom(zoom),
      window.conduit.setAdBlock(adFilter.checked),
      window.conduit.setPolicy(currentPolicy()),
    ]);
    progress(38, `${paneCount} panes · ${Math.round(zoom * 100)}%`);

    const network = selectedNetwork();
    if (network !== state.networkMode) {
      progress(48, network === 'tor' ? 'Connecting isolated routes' : 'Restoring standard route');
      const result = await window.conduit.setNetwork(network);
      if (result?.ok === false) throw new Error(result.error || 'The route could not be changed.');
    }
    progress(68, 'Updating following');
    await window.conduit.setFollowing(settingFollow.checked);

    if (verifyRoutes.checked) {
      progress(78, 'Verifying IP addresses');
      await window.conduit.checkIPs();
    }
    appearance(settingAppearance.value);
    progress(100, 'Changes applied');
    await new Promise((resolve) => setTimeout(resolve, 280));
    setBusy(false);
    await closeSettings();
  } catch (error) {
    progress(100, error?.message || String(error));
    operationTitle.textContent = 'Could not apply changes';
    setTimeout(() => setBusy(false), 600);
  }
}

async function resetPane(pane) {
  if (busy) return;
  setBusy(true, `Resetting ${state?.paneLabels?.[pane - 1] || `Pane ${pane}`}`, 'Closing connections');
  try {
    const result = await window.conduit.resetPane(pane);
    if (result?.ok === false) throw new Error(result.error || 'Reset failed.');
    progress(100, 'Pane ready');
    await new Promise((resolve) => setTimeout(resolve, 260));
  } catch (error) {
    progress(100, error?.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function restartEverything() {
  if (busy || !window.confirm('Reset every pane? Cookies, cache, storage, and route identities will be cleared.')) return;
  setBusy(true, 'Resetting every pane', 'Closing connections');
  const result = await window.conduit.restartAll();
  if (result?.ok === false) progress(100, result.error || 'Restart finished with an error.');
  else progress(100, 'Workspace ready');
  await new Promise((resolve) => setTimeout(resolve, 320));
  setBusy(false);
}

function savePreset() {
  if (!state) return;
  const name = window.prompt('Preset name', `${state.screenCount} panes`);
  if (!name?.trim()) return;
  const value = presets();
  value.push({
    name: name.trim().slice(0, 32),
    paneCount: Number(settingPaneCount.value),
    zoom: Number(settingZoom.value),
    network: selectedNetwork(),
    following: settingFollow.checked,
    policy: currentPolicy(),
    adFilter: adFilter.checked,
  });
  storePresets(value);
  presetSelect.value = String(value.length - 1);
}

function loadPreset(indexValue) {
  const preset = presets()[Number(indexValue)];
  if (!preset) return;
  settingPaneCount.value = String(preset.paneCount || 4);
  settingZoom.value = String(preset.zoom || .8);
  setNetworkControl(preset.network || 'direct');
  settingFollow.checked = Boolean(preset.following);
  policyNavigation.checked = preset.policy?.navigation !== false;
  policyScrolling.checked = preset.policy?.scrolling !== false;
  policyTyping.checked = preset.policy?.typing !== false;
  policyClicks.checked = preset.policy?.clicks !== false;
  adFilter.checked = preset.adFilter !== false;
  updateHighLoadNote();
}

addressForm.addEventListener('submit', (event) => { event.preventDefault(); window.conduit.navigate(address.value); });
back.addEventListener('click', () => window.conduit.back());
forward.addEventListener('click', () => window.conduit.forward());
reload.addEventListener('click', () => window.conduit.reloadActive());
homeLink.addEventListener('click', (event) => { event.preventDefault(); window.conduit.navigate('relay://welcome'); });
openSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
cancelSettingsButton.addEventListener('click', closeSettings);
applySettingsButton.addEventListener('click', applySettings);
restartAllButton.addEventListener('click', restartEverything);
showAllPanes.addEventListener('click', () => window.conduit.focusPane(0));
quickPaneCount.addEventListener('change', async () => {
  const count = Number(quickPaneCount.value);
  await window.conduit.setPaneCount(count);
  if (count >= 5 && state?.zoomFactor !== .8) await window.conduit.setZoom(.8);
});
quickFollow.addEventListener('click', async () => window.conduit.setFollowing(!health?.followingEnabled));
settingPaneCount.addEventListener('change', () => {
  if (Number(settingPaneCount.value) >= 5) settingZoom.value = '0.8';
  updateHighLoadNote();
});
settingAppearance.addEventListener('change', () => appearance(settingAppearance.value));
savePresetButton.addEventListener('click', savePreset);
presetSelect.addEventListener('change', () => loadPreset(presetSelect.value));
deletePresetButton.addEventListener('click', () => {
  const index = Number(presetSelect.value);
  if (!Number.isInteger(index) || !presets()[index]) return;
  const value = presets();
  value.splice(index, 1);
  storePresets(value);
  presetSelect.value = '';
});
adFilter.addEventListener('change', () => {
  if (!adFilter.checked && !window.confirm('Turn off the ad filter? Some sites may show pop-ups or tracking requests.')) adFilter.checked = true;
});
jujharLink.addEventListener('click', (event) => { event.preventDefault(); window.conduit.openExternal(jujharLink.href); });

topologyList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  const row = event.target.closest('.topology-row');
  if (!button || !row) return;
  const pane = Number(row.dataset.pane);
  if (button.dataset.action === 'focus') await window.conduit.focusPane(state?.focusedPane === pane ? 0 : pane);
  if (button.dataset.action === 'reset') await resetPane(pane);
  if (button.dataset.action === 'pause') {
    const current = health?.rows?.find((item) => item.paneNumber === pane)?.paused;
    pendingPause.add(pane);
    renderTopology();
    await window.conduit.pausePane(pane, !current);
    pendingPause.delete(pane);
  }
});

topologyList.addEventListener('change', (event) => {
  if (!event.target.matches('.pane-name-input')) return;
  window.conduit.setPaneLabel(Number(event.target.dataset.pane), event.target.value);
});

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key === ',') { event.preventDefault(); openSettings(); }
  if (event.key.toLowerCase() === 'l') { event.preventDefault(); address.focus(); address.select(); }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); event.shiftKey ? window.conduit.reloadAll() : window.conduit.reloadActive(); }
  if (/^[1-8]$/.test(event.key)) { event.preventDefault(); window.conduit.focusPane(Number(event.key)); }
});

window.conduit.onState((next) => { state = next; render(); });
window.conduit.onLayout((next) => { layout = next?.labels || []; renderLabels(); });
window.conduit.onHealth((next) => { health = next; render(); });
window.conduit.onProgress((next) => { if (busy) progress(next?.percent, next?.message); });
window.conduit.onMenuCommand(({ command, payload }) => {
  if (command === 'settings') openSettings();
  if (command === 'focus-address') { address.focus(); address.select(); }
  if (command === 'reload-active') window.conduit.reloadActive();
  if (command === 'reload-all') window.conduit.reloadAll();
  if (command === 'focus-pane') window.conduit.focusPane(payload);
  if (command === 'save-preset') { openSettings(); setTimeout(savePreset, 180); }
  if (command === 'reset-pane') resetPane(payload);
  if (command === 'toggle-pause') {
    const current = health?.rows?.find((item) => item.paneNumber === payload)?.paused;
    window.conduit.pausePane(payload, !current);
  }
});

appearance(localStorage.getItem(APPEARANCE_KEY) || 'system');
renderPresetOptions();
window.conduit.getWorkspace().then((initial) => {
  if (!state) state = { ...initial, ips: [], adBlock: { enabled: true, totalBlocked: 0 }, paneLabels: initial.paneLabels || [] };
  settingAppearance.value = document.documentElement.dataset.appearance;
  render();
});
window.conduit.getHealth().then((initial) => { health = initial; render(); });

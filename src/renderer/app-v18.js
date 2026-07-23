'use strict';

const $ = (selector) => document.querySelector(selector);
const policyInputs = () => [policyNavigation, policyScrolling, policyTyping, policyClicks];

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

const bootScreen = $('#boot-screen');
const bootMessage = $('#boot-message');
const bootProgressFill = $('#boot-progress-fill');
const bootProgressLabel = $('#boot-progress-label');

const backdrop = $('#settings-backdrop');
const closeSettingsButton = $('#close-settings');
const cancelSettingsButton = $('#cancel-settings');
const applySettingsButton = $('#apply-settings');
const settingPaneCount = $('#setting-pane-count');
const settingZoom = $('#setting-zoom');
const settingAudio = $('#setting-audio');
const settingFollow = $('#setting-follow');
const verifyRoutes = $('#verify-routes');
const adFilter = $('#ad-filter');
const policyNavigation = $('#policy-navigation');
const policyScrolling = $('#policy-scrolling');
const policyTyping = $('#policy-typing');
const policyClicks = $('#policy-clicks');
const restartAllButton = $('#restart-all');
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
let settingsDraft = null;
let requestedNetwork = 'direct';
let pendingPause = new Set();
let bootDismissed = false;
const bootStartedAt = performance.now();

function settingsOpen() {
  return !backdrop.classList.contains('hidden');
}

function normalizedPolicy(value = {}) {
  return {
    navigation: value.navigation !== false,
    scrolling: value.scrolling !== false,
    typing: value.typing !== false,
    clicks: value.clicks !== false,
  };
}

function currentPolicy() {
  return {
    navigation: policyNavigation.checked,
    scrolling: policyScrolling.checked,
    typing: policyTyping.checked,
    clicks: policyClicks.checked,
  };
}

function anyPolicyEnabled(value = currentPolicy()) {
  return Object.values(value).some(Boolean);
}

function allPolicyEnabled(value = currentPolicy()) {
  return Object.values(value).every(Boolean);
}

function setAllPolicies(enabled) {
  for (const input of policyInputs()) input.checked = Boolean(enabled);
  settingFollow.checked = Boolean(enabled);
}

function updateFollowMaster() {
  settingFollow.checked = allPolicyEnabled();
  settingFollow.indeterminate = false;
}

function selectedNetwork() {
  return document.querySelector('input[name="network"]:checked')?.value || 'direct';
}

function setNetworkControl(value) {
  const next = value === 'tor' ? 'tor' : 'direct';
  const input = document.querySelector(`input[name="network"][value="${next}"]`);
  if (input) input.checked = true;
  requestedNetwork = next;
}

function draftFromState() {
  const policy = normalizedPolicy(health?.policy);
  return {
    paneCount: Number(state?.screenCount || 4),
    zoom: Number(state?.zoomFactor || .8),
    audioMode: state?.audioMode || 'leader',
    network: state?.networkMode === 'tor' ? 'tor' : 'direct',
    policy,
    adFilter: state?.adBlock?.enabled !== false,
    verifyRoutes: true,
  };
}

function populateSettings(draft) {
  settingPaneCount.value = String(draft.paneCount);
  settingZoom.value = String(draft.zoom);
  settingAudio.value = draft.audioMode;
  setNetworkControl(draft.network);
  policyNavigation.checked = draft.policy.navigation;
  policyScrolling.checked = draft.policy.scrolling;
  policyTyping.checked = draft.policy.typing;
  policyClicks.checked = draft.policy.clicks;
  updateFollowMaster();
  adFilter.checked = draft.adFilter;
  verifyRoutes.checked = draft.verifyRoutes;
}

function readDraft() {
  return {
    paneCount: Number(settingPaneCount.value),
    zoom: Number(settingZoom.value),
    audioMode: settingAudio.value,
    network: selectedNetwork(),
    policy: currentPolicy(),
    adFilter: adFilter.checked,
    verifyRoutes: verifyRoutes.checked,
  };
}

function setBusy(value, title = 'Applying changes', message = 'Starting…') {
  busy = Boolean(value);
  document.body.classList.toggle('busy', busy);
  operationStrip.hidden = !busy;
  operationTitle.textContent = title;
  operationMessage.textContent = message;
  operationPercent.textContent = busy ? '0%' : '';
  progressFill.style.width = '0%';
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

function updateBoot() {
  if (bootDismissed) return;
  const visible = Number(state?.screenCount || 4);
  const registered = Number(health?.registeredCount || 0);
  let percent = state ? 28 : 8;
  let message = 'Starting browser sessions…';

  if (state?.networkBusy) {
    percent = 52;
    message = 'Preparing the network route…';
  } else if (registered > 0) {
    percent = 32 + Math.round((Math.min(registered, visible) / Math.max(1, visible)) * 58);
    message = `Opening pane ${Math.min(registered, visible)} of ${visible}…`;
  }

  const ready = Boolean(state && health && registered >= visible && !state.networkBusy);
  if (ready) {
    percent = 100;
    message = 'Workspace ready';
  }

  bootMessage.textContent = message;
  bootProgressFill.style.width = `${percent}%`;
  bootProgressLabel.textContent = `${percent}%`;

  const elapsed = performance.now() - bootStartedAt;
  if (ready && elapsed >= 1100) {
    bootDismissed = true;
    setTimeout(() => bootScreen.classList.add('hidden'), 180);
  } else if (ready) {
    setTimeout(updateBoot, Math.max(80, 1100 - elapsed));
  }
}

setTimeout(() => {
  if (!bootDismissed) {
    bootDismissed = true;
    bootMessage.textContent = 'Workspace ready';
    bootProgressFill.style.width = '100%';
    bootProgressLabel.textContent = '100%';
    setTimeout(() => bootScreen.classList.add('hidden'), 260);
  }
}, 9000);

function formatReset(value) {
  if (!value) return 'No reset this session';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `Last reset ${seconds}s ago`;
  return `Last reset ${Math.round(seconds / 60)}m ago`;
}

function audioLabel(mode) {
  if (mode === 'focused') return 'Focused pane';
  if (mode === 'all') return 'All panes';
  if (mode === 'muted') return 'Muted';
  return 'Pane 1';
}

function routeText(index) {
  const result = state?.ips?.[index];
  if (!result) return 'IP/location not checked';
  if (!result.ok) return result.error ? `Route unavailable · ${result.error}` : 'Route unavailable';
  const location = result.location || 'Location unavailable';
  return `${location} · ${result.ip}`;
}

function updateFacts() {
  if (!state) return;
  const visible = state.screenCount || 4;
  const followerTotal = Math.max(0, visible - 1);
  const verified = (state.ips || []).slice(0, visible).filter((item) => item?.ok);
  const blocked = Number(state.adBlock?.totalBlocked || 0);
  $('#fact-panes').textContent = `${visible} pane${visible === 1 ? '' : 's'} open`;
  $('#fact-followers').textContent = health?.followingEnabled
    ? `${health.connectedFollowers || 0}/${followerTotal} followers active`
    : 'Following off';
  if (verified.length) {
    const firstLocation = verified[0].location || verified[0].ip;
    $('#fact-routes').textContent = `${firstLocation} · ${verified.length}/${visible} checked`;
  } else {
    $('#fact-routes').textContent = 'IP/location not checked';
  }
  $('#fact-audio').textContent = `Sound: ${audioLabel(state.audioMode)}`;
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

function paneHasSound(paneNumber) {
  const mode = state?.audioMode || 'leader';
  if (mode === 'all') return paneNumber <= (state?.screenCount || 1);
  if (mode === 'focused') return paneNumber === (state?.focusedPane || 1);
  if (mode === 'leader') return paneNumber === 1;
  return false;
}

function renderTopology() {
  if (document.activeElement?.classList.contains('pane-name-input')) return;
  topologyList.replaceChildren();
  const rows = health?.rows || Array.from({ length: state?.screenCount || 0 }, (_unused, index) => ({ paneNumber: index + 1 }));
  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const status = rowStatus(row);
    const card = document.createElement('article');
    card.className = `pane-card${state?.focusedPane === row.paneNumber ? ' is-focused' : ''}`;
    card.dataset.pane = String(row.paneNumber);

    const head = document.createElement('div');
    head.className = 'pane-card-head';
    const number = document.createElement('span');
    number.className = 'pane-number';
    number.textContent = String(row.paneNumber).padStart(2, '0');
    const name = document.createElement('input');
    name.className = 'pane-name-input';
    name.value = state?.paneLabels?.[row.paneNumber - 1] || (row.paneNumber === 1 ? 'Main' : `Pane ${row.paneNumber}`);
    name.dataset.pane = String(row.paneNumber);
    name.setAttribute('aria-label', `Name for pane ${row.paneNumber}`);
    const stateLabel = document.createElement('span');
    stateLabel.className = 'pane-state';
    stateLabel.textContent = `${status.label}${paneHasSound(row.paneNumber) ? ' · Sound' : ''}`;
    head.append(number, name, stateLabel);

    const route = document.createElement('p');
    route.className = 'pane-route';
    route.textContent = routeText(row.paneNumber - 1);

    const actions = document.createElement('div');
    actions.className = 'pane-card-actions';
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
    card.append(head, route, actions);
    fragment.appendChild(card);
  });

  topologyList.appendChild(fragment);
  const followerTotal = Math.max(0, (state?.screenCount || 1) - 1);
  topologySummary.textContent = health
    ? `${health.connectedFollowers}/${followerTotal} active · ${health.caughtUpFollowers} aligned${health.pausedCount ? ` · ${health.pausedCount} paused` : ''}`
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
    const route = state?.ips?.[cell.index];
    const status = cell.index === 0 ? 'Leader' : row?.paused ? 'Paused' : row?.caughtUp ? 'Aligned' : 'Following';
    detail.textContent = route?.ok ? `${status} · ${route.location || route.ip}` : status;
    label.append(strong, detail);
    fragment.appendChild(label);
  });
  paneLabelsLayer.appendChild(fragment);
}

function render() {
  if (!state) return;
  if (document.activeElement !== address) address.value = state.currentURL || 'relay://home';
  back.disabled = !state.canGoBack || busy;
  forward.disabled = !state.canGoForward || busy;
  reload.disabled = busy;
  quickPaneCount.value = String(state.screenCount || 4);
  quickFollow.setAttribute('aria-pressed', String(Boolean(health?.followingEnabled)));
  updateFacts();
  renderTopology();
  renderLabels();
  updateBoot();
}

async function openSettings() {
  if (busy || !state) return;
  settingsDraft = draftFromState();
  populateSettings(settingsDraft);
  backdrop.classList.remove('hidden');
  await window.conduit.setSettingsVisible(true);
}

async function closeSettings() {
  if (busy) return;
  const result = await window.conduit.setSettingsVisible(false);
  if (result?.ok !== false) {
    backdrop.classList.add('hidden');
    settingsDraft = null;
  }
}

async function applySettings() {
  if (busy) return;
  const draft = readDraft();
  settingsDraft = draft;
  setBusy(true);
  try {
    progress(8, 'Preparing workspace');
    await window.conduit.setPaneCount(draft.paneCount);
    await window.conduit.setZoom(draft.zoom);
    await window.conduit.setAudioMode(draft.audioMode);
    await window.conduit.setAdBlock(draft.adFilter);
    await window.conduit.setPolicy(draft.policy);
    progress(38, `${draft.paneCount} panes · ${Math.round(draft.zoom * 100)}%`);

    if (draft.network !== state.networkMode) {
      progress(48, draft.network === 'tor' ? 'Connecting isolated routes' : 'Restoring standard route');
      const result = await window.conduit.setNetwork(draft.network);
      if (result?.ok === false) throw new Error(result.error || 'The route could not be changed.');
    }

    progress(68, 'Updating Pane 1 following');
    await window.conduit.setFollowing(anyPolicyEnabled(draft.policy));

    if (draft.verifyRoutes) {
      progress(80, 'Checking IP address and location');
      await window.conduit.checkIPs();
    }

    progress(100, 'Changes applied');
    await new Promise((resolve) => setTimeout(resolve, 320));
    setBusy(false);
    await closeSettings();
  } catch (error) {
    progress(100, error?.message || String(error));
    operationTitle.textContent = 'Could not apply changes';
    setTimeout(() => setBusy(false), 700);
  }
}

async function resetPane(pane) {
  if (busy) return;
  setBusy(true, `Resetting ${state?.paneLabels?.[pane - 1] || `Pane ${pane}`}`, 'Closing connections');
  try {
    const result = await window.conduit.resetPane(pane);
    if (result?.ok === false) throw new Error(result.error || 'Reset failed.');
    progress(100, 'Pane ready');
    await new Promise((resolve) => setTimeout(resolve, 280));
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
  progress(100, result?.ok === false ? (result.error || 'Restart finished with an error.') : 'Workspace ready');
  await new Promise((resolve) => setTimeout(resolve, 340));
  setBusy(false);
}

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  window.conduit.navigate(address.value);
});
address.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    event.stopPropagation();
    address.select();
  }
});
back.addEventListener('click', () => window.conduit.back());
forward.addEventListener('click', () => window.conduit.forward());
reload.addEventListener('click', () => window.conduit.reloadActive());
homeLink.addEventListener('click', (event) => { event.preventDefault(); window.conduit.navigate('relay://home'); });
openSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
cancelSettingsButton.addEventListener('click', closeSettings);
applySettingsButton.addEventListener('click', applySettings);
restartAllButton.addEventListener('click', restartEverything);
showAllPanes.addEventListener('click', () => window.conduit.focusPane(0));

quickPaneCount.addEventListener('change', async () => {
  await window.conduit.setPaneCount(Number(quickPaneCount.value));
});
quickFollow.addEventListener('click', async () => {
  const turnOn = !health?.followingEnabled;
  const policy = { navigation: turnOn, scrolling: turnOn, typing: turnOn, clicks: turnOn };
  await window.conduit.setPolicy(policy);
  await window.conduit.setFollowing(turnOn);
  if (settingsOpen()) populateSettings({ ...readDraft(), policy });
});

settingFollow.addEventListener('change', () => setAllPolicies(settingFollow.checked));
for (const input of policyInputs()) input.addEventListener('change', updateFollowMaster);
adFilter.addEventListener('change', () => {
  if (!adFilter.checked && !window.confirm('Turn off the ad filter? Some sites may show pop-ups or tracking requests.')) adFilter.checked = true;
});
jujharLink.addEventListener('click', (event) => { event.preventDefault(); window.conduit.openExternal(jujharLink.href); });

topologyList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  const card = event.target.closest('.pane-card');
  if (!button || !card) return;
  const pane = Number(card.dataset.pane);
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
  if (event.key.toLowerCase() === 'a' && document.activeElement === address) { event.preventDefault(); address.select(); }
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
  if (command === 'reset-pane') resetPane(payload);
  if (command === 'toggle-pause') {
    const current = health?.rows?.find((item) => item.paneNumber === payload)?.paused;
    window.conduit.pausePane(payload, !current);
  }
});

window.conduit.getWorkspace().then((initial) => {
  if (!state) state = { ...initial, ips: initial.ips || [], adBlock: initial.adBlock || { enabled: true, totalBlocked: 0 }, paneLabels: initial.paneLabels || [] };
  render();
});
window.conduit.getHealth().then((initial) => { health = initial; render(); });

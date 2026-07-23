'use strict';

const address = document.querySelector('#address');
const addressForm = document.querySelector('#address-form');
const back = document.querySelector('#back');
const forward = document.querySelector('#forward');
const reload = document.querySelector('#reload');
const restartAll = document.querySelector('#restart-all');
const openSettings = document.querySelector('#open-settings');
const status = document.querySelector('#status');
const statusDot = document.querySelector('#status-dot');
const dnsStatus = document.querySelector('#dns-status');
const labels = document.querySelector('#labels');
const summaryScreens = document.querySelector('#summary-screens');
const summaryZoom = document.querySelector('#summary-zoom');
const summaryNetwork = document.querySelector('#summary-network');
const summarySync = document.querySelector('#summary-sync');
const summaryProtection = document.querySelector('#summary-protection');

const setupBackdrop = document.querySelector('#setup-backdrop');
const setupDialog = document.querySelector('#setup-dialog');
const setupContent = document.querySelector('#setup-content');
const setupOptions = document.querySelector('#setup-options');
const setupCancel = document.querySelector('#setup-cancel');
const setupBack = document.querySelector('#setup-back');
const setupLaunch = document.querySelector('#setup-launch');
const continueDirect = document.querySelector('#continue-direct');
const setupError = document.querySelector('#setup-error');
const setupEyebrow = document.querySelector('#setup-eyebrow');
const setupTitle = document.querySelector('#setup-title');
const setupIntro = document.querySelector('#setup-intro');
const progressEyebrow = document.querySelector('#progress-eyebrow');
const progressTitle = document.querySelector('#progress-title');
const progressMeterFill = document.querySelector('#progress-meter-fill');
const progressPercent = document.querySelector('#progress-percent');
const progressCurrent = document.querySelector('#progress-current');
const diagnosticConsole = document.querySelector('#diagnostic-console');
const diagnosticIssueCount = document.querySelector('#diagnostic-issue-count');
const clearDiagnostics = document.querySelector('#clear-diagnostics');
const protectionDetail = document.querySelector('#protection-detail');
const setupScreenCount = document.querySelector('#setup-screen-count');
const setupZoom = document.querySelector('#setup-zoom');
const setupCheckIPs = document.querySelector('#setup-check-ips');
const setupSync = document.querySelector('#setup-sync');
const setupAdBlock = document.querySelector('#setup-adblock');
const resetScreenButtons = Array.from(document.querySelectorAll('.screen-reset-button'));
const progressSteps = [0, 1, 2, 3].map((index) => document.querySelector(`#progress-step-${index}`));

const setupControls = [
  setupScreenCount,
  setupZoom,
  setupCheckIPs,
  setupSync,
  setupAdBlock,
  ...Array.from(document.querySelectorAll('input[name="setup-network"]')),
  ...resetScreenButtons,
];

const SETTINGS_STEPS = [
  'Workspace and protection',
  'Connections',
  'Connection check',
  'Screen 1 control',
];

let latestState = null;
let latestLayout = [];
let setupBusy = false;
let hasOpenedWorkspace = false;
let dialogMode = 'settings';
let pendingRecovery = null;
let diagnosticEntries = [];
let issueCount = 0;
let operationName = '';
let lastConnectionState = '';
let adBlockState = { enabled: true, totalBlocked: 0 };
const stepSignatures = new Map();

function cleanStatus(value) {
  const text = String(value || '');
  if (/security challenge/i.test(text)) return latestState?.syncRequested ? 'Screen 1 control active' : 'Ready';
  return text
    .replace(/Tor split/gi, 'Multiple private connections')
    .replace(/Tor connected/gi, 'Private connections active')
    .replace(/Tor route/gi, 'Private route')
    .replace(/Tor was unavailable/gi, 'Private connections unavailable');
}

function compactDiagnostic(message) {
  const text = cleanStatus(message).replace(/\s+/g, ' ').trim();
  if (!text || /security challenge|workspace controls are locked|browser panes are locked/i.test(text)) return '';
  if (/checking local tor|connecting|reconnecting|switching to direct/i.test(text)) return 'Connecting…';
  if (/connected|route verified|connection ready|private connections active/i.test(text)) return 'Connected';
  if (/failed|unavailable|error|stopped|could not/i.test(text)) return 'Connection error';
  if (/ad blocker on|protection.*active|protection.*enabled/i.test(text)) return 'Ad blocker on';
  if (/ad blocker off|protection.*disabled/i.test(text)) return 'Ad blocker off';
  if (/screen 1 control on|synchronization enabled/i.test(text)) return 'Screen 1 control on';
  if (/screen 1 control off|synchronization disabled/i.test(text)) return 'Screen 1 control off';
  if (/workspace unlocked|ready$/i.test(text)) return 'Ready';
  return text.length > 64 ? `${text.slice(0, 61)}…` : text;
}

function renderDiagnostics() {
  diagnosticConsole.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const entry of diagnosticEntries) {
    const row = document.createElement('div');
    row.className = `diagnostic-entry ${entry.level}`;

    const dot = document.createElement('span');
    dot.className = 'diagnostic-dot';

    const message = document.createElement('span');
    message.textContent = entry.message;

    row.append(dot, message);
    fragment.appendChild(row);
  }

  diagnosticConsole.appendChild(fragment);
  diagnosticConsole.scrollTop = diagnosticConsole.scrollHeight;
  diagnosticIssueCount.textContent = issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'All good';
  diagnosticIssueCount.classList.toggle('has-issues', issueCount > 0);
}

function addDiagnostic(level, message) {
  const compact = compactDiagnostic(message);
  if (!compact) return;

  const normalizedLevel = ['success', 'warn', 'error'].includes(level) ? level : 'info';
  const previous = diagnosticEntries.at(-1);
  if (previous?.message === compact && previous?.level === normalizedLevel) return;

  diagnosticEntries.push({ level: normalizedLevel, message: compact });
  if (diagnosticEntries.length > 6) diagnosticEntries = diagnosticEntries.slice(-6);
  if (normalizedLevel === 'warn' || normalizedLevel === 'error') issueCount += 1;
  renderDiagnostics();
}

function clearDiagnosticLog() {
  diagnosticEntries = [];
  issueCount = 0;
  addDiagnostic('info', 'Ready');
}

function setProgress(value, message = '') {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  progressMeterFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressMeterFill.classList.toggle('complete', percent === 100);
  if (message) progressCurrent.textContent = compactDiagnostic(message) || cleanStatus(message);
}

function renderLabels() {
  labels.replaceChildren();
  latestLayout.forEach((item) => {
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.style.left = `${item.x}px`;
    label.style.top = `${item.y}px`;
    label.style.width = `${item.width}px`;
    label.style.height = `${item.height}px`;

    const role = item.index === 0 ? 'Controller' : 'Follower';
    const result = latestState?.ips?.[item.index];
    const ip = result ? ` · ${result.ip}` : '';
    label.textContent = `Screen ${item.index + 1} · ${role}${ip}`;
    labels.appendChild(label);
  });
}

function renderSummary() {
  if (!latestState) return;
  summaryScreens.textContent = `${latestState.screenCount} screen${latestState.screenCount === 1 ? '' : 's'}`;
  summaryZoom.textContent = `${Math.round(latestState.zoomFactor * 100)}% zoom`;
  summaryNetwork.textContent = latestState.networkMode === 'tor' ? 'Multiple private connections' : 'Direct connection';
  summarySync.textContent = latestState.syncRequested ? 'Screen 1 control on' : 'Screen 1 control off';
  summaryProtection.textContent = adBlockState.enabled
    ? `Ad blocker on · ${adBlockState.totalBlocked || 0}`
    : 'Ad blocker off';
  summaryProtection.classList.toggle('protected', adBlockState.enabled);

  resetScreenButtons.forEach((button) => {
    const screenNumber = Number(button.dataset.screen);
    button.disabled = setupBusy || screenNumber > latestState.screenCount;
    button.classList.toggle('unavailable', screenNumber > latestState.screenCount);
  });
}

async function refreshAdBlockStatus({ copyToControl = false } = {}) {
  try {
    const result = await window.relay.getAdBlockStatus();
    adBlockState = {
      enabled: result?.enabled !== false,
      totalBlocked: Number(result?.totalBlocked) || 0,
    };
    if (copyToControl) setupAdBlock.checked = adBlockState.enabled;
    protectionDetail.textContent = adBlockState.enabled
      ? `${adBlockState.totalBlocked} ad or tracker request${adBlockState.totalBlocked === 1 ? '' : 's'} blocked.`
      : 'Protection is off. Some sites may show ads or trackers.';
    renderSummary();
  } catch {
    protectionDetail.textContent = 'Protection status is unavailable.';
  }
}

function selectedSetupNetwork() {
  return document.querySelector('input[name="setup-network"]:checked')?.value || 'direct';
}

function chooseSetupNetwork(value) {
  const input = document.querySelector(`input[name="setup-network"][value="${value}"]`);
  if (input) input.checked = true;
}

function configureProgress(stepLabels, title, eyebrow = 'Progress') {
  progressEyebrow.textContent = eyebrow;
  progressTitle.textContent = title;
  stepSignatures.clear();
  progressSteps.forEach((element, index) => {
    element.className = 'progress-step';
    element.querySelector('.step-icon').textContent = String(index + 1);
    element.querySelector('strong').textContent = stepLabels[index] || `Step ${index + 1}`;
    element.querySelector('small').textContent = 'Waiting';
  });
  setProgress(0, 'Waiting');
}

function setStep(index, state, message) {
  const element = progressSteps[index];
  if (!element) return;

  const cleanMessage = cleanStatus(message);
  element.className = `progress-step ${state}`;
  element.querySelector('small').textContent = cleanMessage;
  const icon = element.querySelector('.step-icon');
  if (state === 'done') icon.textContent = '✓';
  else if (state === 'error') icon.textContent = '!';
  else if (state === 'skipped') icon.textContent = '–';
  else icon.textContent = String(index + 1);

  const percent = state === 'done' || state === 'skipped'
    ? (index + 1) * 25
    : state === 'running'
      ? (index * 25) + 10
      : index * 25;
  setProgress(percent, message);

  const signature = `${state}:${cleanMessage}`;
  if (stepSignatures.get(index) !== signature) {
    stepSignatures.set(index, signature);
    const label = element.querySelector('strong').textContent;
    if (state === 'running') addDiagnostic('info', `${label}…`);
    else if (state === 'done') addDiagnostic('success', `${label} ready`);
    else if (state === 'error') addDiagnostic('error', `${label} error`);
  }
}

function clearError() {
  setupError.hidden = true;
  setupError.textContent = '';
  setupBack.hidden = true;
  continueDirect.hidden = true;
  pendingRecovery = null;
}

function showError(message, { allowDirect = false, recovery = null } = {}) {
  const cleanMessage = cleanStatus(message || 'The operation could not be completed.');
  setupError.hidden = false;
  setupError.textContent = cleanMessage;
  setupBack.hidden = false;
  continueDirect.hidden = !allowDirect;
  pendingRecovery = recovery;
  addDiagnostic('error', cleanMessage);
}

function setSetupBusy(busy) {
  setupBusy = busy;
  setupControls.forEach((control) => { control.disabled = busy; });
  setupLaunch.disabled = busy;
  setupCancel.disabled = busy;
  setupBack.disabled = busy;
  continueDirect.disabled = busy;
  restartAll.disabled = busy;
  openSettings.disabled = busy;
  renderSummary();
}

function setSettingsMode() {
  dialogMode = 'settings';
  operationName = 'Settings';
  setupDialog.classList.remove('operation-mode');
  setupContent.classList.remove('operation-only');
  setupOptions.hidden = false;
  setupEyebrow.textContent = 'Relay 0.11';
  setupTitle.textContent = 'Workspace settings';
  setupIntro.textContent = 'Screen 1 leads the workspace. Changes are finalized before browser access returns.';
  setupLaunch.hidden = false;
  setupLaunch.textContent = 'Apply settings';
  setupCancel.hidden = !hasOpenedWorkspace;
  clearError();
  configureProgress(SETTINGS_STEPS, 'Ready');
}

function setOperationMode({ title, intro, progressTitleText, steps, name }) {
  dialogMode = 'operation';
  operationName = name || title;
  setupDialog.classList.add('operation-mode');
  setupContent.classList.add('operation-only');
  setupOptions.hidden = true;
  setupEyebrow.textContent = 'Relay operation';
  setupTitle.textContent = title;
  setupIntro.textContent = intro;
  setupLaunch.hidden = true;
  setupCancel.hidden = true;
  clearError();
  configureProgress(steps, progressTitleText);
}

async function copyStateIntoSetup() {
  if (!latestState) return;
  setupScreenCount.value = String(latestState.screenCount);
  setupZoom.value = String(latestState.zoomFactor);
  setupSync.checked = Boolean(latestState.syncRequested);
  chooseSetupNetwork(latestState.networkMode);
  await refreshAdBlockStatus({ copyToControl: true });
  renderSummary();
}

async function showBackdrop() {
  setupBackdrop.classList.remove('hidden');
  const result = await window.relay.setSetupVisible(true);
  return result?.ok !== false;
}

async function showSettings(errorMessage = '') {
  if (setupBusy) return;
  await copyStateIntoSetup();
  setSettingsMode();
  if (errorMessage) showError(errorMessage);
  await showBackdrop();
  addDiagnostic('info', 'Ready');
}

async function hideSetup() {
  if (setupBusy) return false;
  const result = await window.relay.setSetupVisible(false);
  if (!result?.ok) {
    showError(result?.error || 'Relay is still finishing the operation.');
    return false;
  }
  setupBackdrop.classList.add('hidden');
  hasOpenedWorkspace = true;
  addDiagnostic('success', 'Ready');
  return true;
}

async function beginOperation(config) {
  setOperationMode(config);
  await showBackdrop();
  setSetupBusy(true);
}

async function completeOperation() {
  setProgress(100, 'Ready');
  addDiagnostic('success', 'Ready');
  await refreshAdBlockStatus();
  await new Promise((resolve) => setTimeout(resolve, 360));
  setSetupBusy(false);
  await hideSetup();
}

async function failOperation(message, options = {}) {
  setSetupBusy(false);
  showError(message, options);
}

async function runSettings(forceDirect = false) {
  if (setupBusy) return;

  const chosenScreens = Number(setupScreenCount.value);
  const chosenZoom = Number(setupZoom.value);
  const chosenNetwork = forceDirect ? 'direct' : selectedSetupNetwork();
  const shouldCheckIPs = setupCheckIPs.checked;
  const shouldSync = setupSync.checked;
  const shouldBlockAds = setupAdBlock.checked;

  await beginOperation({
    name: 'Settings',
    title: 'Applying settings',
    intro: 'Relay is applying the workspace, protection, connection, and Screen 1 control settings.',
    progressTitleText: 'Applying settings',
    steps: SETTINGS_STEPS,
  });

  try {
    setStep(0, 'running', 'Applying workspace and protection…');
    await Promise.all([
      window.relay.setScreenCount(chosenScreens),
      window.relay.setZoom(chosenZoom),
      window.relay.setAdBlockEnabled(shouldBlockAds),
    ]);
    adBlockState.enabled = shouldBlockAds;
    setStep(0, 'done', `${chosenScreens} screens · ${Math.round(chosenZoom * 100)}% · blocker ${shouldBlockAds ? 'on' : 'off'}`);

    setStep(1, 'running', chosenNetwork === 'tor' ? 'Connecting private identities…' : 'Connecting directly…');
    const networkResult = await window.relay.setNetwork(chosenNetwork);
    if (!networkResult?.ok) {
      setStep(1, 'error', 'Connection error');
      await failOperation(networkResult?.error || 'Private connections could not be started.', {
        allowDirect: true,
        recovery: 'settings',
      });
      return;
    }
    setStep(1, 'done', 'Connected');

    if (shouldCheckIPs) {
      setStep(2, 'running', 'Checking connections…');
      const ipResult = await window.relay.checkIPs();
      setStep(2, 'done', ipResult?.ok ? 'Checked' : 'Check finished');
    } else {
      setStep(2, 'skipped', 'Skipped');
    }

    setStep(3, 'running', 'Applying Screen 1 control…');
    await window.relay.setSync(shouldSync);
    setStep(3, 'done', shouldSync ? 'Screen 1 is in control' : 'Control is off');

    await completeOperation();
  } catch (error) {
    await failOperation(error?.message || String(error), { recovery: 'settings' });
  }
}

async function runRestartEverything() {
  if (setupBusy) return;

  await beginOperation({
    name: 'Restart',
    title: 'Restarting everything',
    intro: 'Relay is clearing every isolated session, rebuilding the active connection mode, and reloading all screens.',
    progressTitleText: 'Restarting Relay',
    steps: ['Pause workspace', 'Reset sessions', 'Rebuild connections', 'Reload screens'],
  });

  try {
    const result = await window.relay.restartEverything();
    if (!result?.ok) {
      await failOperation(result?.error || 'Relay restarted with a Direct-connection fallback.', { recovery: 'restart' });
      return;
    }
    await completeOperation();
  } catch (error) {
    await failOperation(error?.message || String(error), { recovery: 'restart' });
  }
}

async function runScreenReset(screenNumber) {
  if (setupBusy) return;

  await beginOperation({
    name: `Screen ${screenNumber} reset`,
    title: `Resetting Screen ${screenNumber}`,
    intro: `Relay is clearing Screen ${screenNumber} while keeping the other sessions intact.`,
    progressTitleText: `Reset Screen ${screenNumber}`,
    steps: [`Pause Screen ${screenNumber}`, 'Clear browser data', 'Renew identity', `Reload Screen ${screenNumber}`],
  });

  try {
    const result = await window.relay.resetScreen(screenNumber);
    if (!result?.ok) {
      await failOperation(result?.error || `Screen ${screenNumber} could not be fully reset.`, { recovery: 'screen' });
      return;
    }
    await completeOperation();
  } catch (error) {
    await failOperation(error?.message || String(error), { recovery: 'screen' });
  }
}

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  window.relay.navigate(address.value);
});
back.addEventListener('click', () => window.relay.back());
forward.addEventListener('click', () => window.relay.forward());
reload.addEventListener('click', () => window.relay.reload());
restartAll.addEventListener('click', runRestartEverything);
openSettings.addEventListener('click', () => showSettings());
clearDiagnostics.addEventListener('click', clearDiagnosticLog);

setupAdBlock.addEventListener('change', () => {
  if (setupAdBlock.checked) return;
  const accepted = window.confirm(
    'Turn off ad blocking? Some websites may interrupt the page, show pop-ups, or sign you out when protection changes.',
  );
  if (!accepted) setupAdBlock.checked = true;
});

setupCancel.addEventListener('click', () => {
  if (hasOpenedWorkspace && !setupBusy && dialogMode === 'settings') hideSetup();
});
setupBack.addEventListener('click', () => showSettings());
setupLaunch.addEventListener('click', () => runSettings(false));
continueDirect.addEventListener('click', () => {
  if (pendingRecovery === 'settings') {
    chooseSetupNetwork('direct');
    runSettings(true);
  }
});

resetScreenButtons.forEach((button) => {
  button.addEventListener('click', () => runScreenReset(Number(button.dataset.screen)));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && hasOpenedWorkspace && !setupBusy && dialogMode === 'settings' && !setupBackdrop.classList.contains('hidden')) {
    hideSetup();
  }
});

window.relay.onState((state) => {
  latestState = state;
  if (document.activeElement !== address) address.value = state.currentURL;
  back.disabled = setupBusy || !state.canGoBack;
  forward.disabled = setupBusy || !state.canGoForward;
  reload.disabled = setupBusy;

  const topStatus = cleanStatus(state.status);
  const topDns = cleanStatus(state.dnsStatus);
  status.textContent = topStatus;
  dnsStatus.textContent = topDns;

  statusDot.className = 'status-dot';
  if (state.networkBusy || setupBusy) statusDot.classList.add('busy');
  else if (state.networkMode === 'tor') statusDot.classList.add('secure');

  const connectionState = /failed|unavailable|error|stopped/i.test(`${topStatus} ${topDns}`)
    ? 'Connection error'
    : /connecting|checking|verifying/i.test(`${topStatus} ${topDns}`)
      ? 'Connecting…'
      : /connected|verified|ready|direct connection/i.test(`${topStatus} ${topDns}`)
        ? 'Connected'
        : '';

  if (connectionState && connectionState !== lastConnectionState) {
    addDiagnostic(connectionState === 'Connection error' ? 'error' : connectionState === 'Connected' ? 'success' : 'info', connectionState);
    lastConnectionState = connectionState;
  }

  renderSummary();
  renderLabels();
});

window.relay.onLayout(({ labels: layout }) => {
  latestLayout = layout;
  renderLabels();
});

window.relay.onOperationProgress((progress) => {
  if (dialogMode !== 'operation') return;
  setStep(Number(progress.step), progress.state || 'running', progress.message || 'Working…');
});

window.relay.onDiagnostic((entry) => {
  addDiagnostic(entry?.level || 'info', entry?.message || '');
  refreshAdBlockStatus();
});

setInterval(() => refreshAdBlockStatus(), 5000);

setSettingsMode();
addDiagnostic('info', 'Ready');
refreshAdBlockStatus({ copyToControl: true });
window.relay.setSetupVisible(true);

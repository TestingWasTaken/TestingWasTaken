'use strict';

const address = document.querySelector('#address');
const addressForm = document.querySelector('#address-form');
const back = document.querySelector('#back');
const forward = document.querySelector('#forward');
const reload = document.querySelector('#reload');
const screenCount = document.querySelector('#screen-count');
const zoom = document.querySelector('#zoom');
const network = document.querySelector('#network');
const checkIPs = document.querySelector('#check-ips');
const sync = document.querySelector('#sync');
const status = document.querySelector('#status');
const statusDot = document.querySelector('#status-dot');
const dnsStatus = document.querySelector('#dns-status');
const labels = document.querySelector('#labels');
const openSettings = document.querySelector('#open-settings');

const setupBackdrop = document.querySelector('#setup-backdrop');
const setupCancel = document.querySelector('#setup-cancel');
const setupLaunch = document.querySelector('#setup-launch');
const continueDirect = document.querySelector('#continue-direct');
const setupError = document.querySelector('#setup-error');
const setupScreenCount = document.querySelector('#setup-screen-count');
const setupZoom = document.querySelector('#setup-zoom');
const setupCheckIPs = document.querySelector('#setup-check-ips');
const setupSync = document.querySelector('#setup-sync');
const setupControls = [setupScreenCount, setupZoom, setupCheckIPs, setupSync];
const steps = {
  workspace: document.querySelector('#step-workspace'),
  network: document.querySelector('#step-network'),
  ip: document.querySelector('#step-ip'),
  sync: document.querySelector('#step-sync'),
};

let latestState = null;
let latestLayout = [];
let setupBusy = false;
let hasOpenedWorkspace = false;

function renderLabels() {
  labels.replaceChildren();
  latestLayout.forEach((item) => {
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.style.left = `${item.x}px`;
    label.style.top = `${item.y}px`;
    label.style.width = `${item.width}px`;
    label.style.height = `${item.height}px`;

    const result = latestState?.ips?.[item.index];
    const ip = result
      ? ` · ${result.ip}${result.isTor === false && latestState.networkMode === 'tor' ? ' · not Tor' : ''}`
      : '';
    label.textContent = `Screen ${item.index + 1}${ip}`;
    labels.appendChild(label);
  });
}

function selectedSetupNetwork() {
  return document.querySelector('input[name="setup-network"]:checked')?.value || 'direct';
}

function chooseSetupNetwork(value) {
  const input = document.querySelector(`input[name="setup-network"][value="${value}"]`);
  if (input) input.checked = true;
}

function setStep(name, state, message) {
  const element = steps[name];
  if (!element) return;
  element.className = `progress-step ${state}`;
  const detail = element.querySelector('small');
  detail.textContent = message;
  const icon = element.querySelector('.step-icon');
  if (state === 'done') icon.textContent = '✓';
  else if (state === 'error') icon.textContent = '!';
  else if (state === 'skipped') icon.textContent = '–';
  else icon.textContent = String(['workspace', 'network', 'ip', 'sync'].indexOf(name) + 1);
}

function resetProgress() {
  setStep('workspace', 'pending', 'Waiting');
  setStep('network', 'pending', 'Waiting');
  setStep('ip', 'pending', 'Waiting');
  setStep('sync', 'pending', 'Waiting');
  setupError.hidden = true;
  setupError.textContent = '';
  continueDirect.hidden = true;
  setupLaunch.textContent = 'Open workspace';
}

function setSetupBusy(busy) {
  setupBusy = busy;
  setupLaunch.disabled = busy;
  continueDirect.disabled = busy;
  setupControls.forEach((control) => { control.disabled = busy; });
  document.querySelectorAll('input[name="setup-network"]').forEach((control) => { control.disabled = busy; });
  setupLaunch.textContent = busy ? 'Preparing…' : 'Open workspace';
}

function copyStateIntoSetup() {
  if (!latestState) return;
  setupScreenCount.value = String(latestState.screenCount);
  setupZoom.value = String(latestState.zoomFactor);
  setupSync.checked = Boolean(latestState.syncRequested);
  chooseSetupNetwork(latestState.networkMode);
}

async function showSetup(errorMessage = '') {
  copyStateIntoSetup();
  resetProgress();
  setupBackdrop.classList.remove('hidden');
  setupCancel.hidden = !hasOpenedWorkspace;
  if (errorMessage) {
    setupError.hidden = false;
    setupError.textContent = errorMessage;
  }
  await window.relay.setSetupVisible(true);
}

async function hideSetup() {
  setupBackdrop.classList.add('hidden');
  hasOpenedWorkspace = true;
  setupCancel.hidden = false;
  await window.relay.setSetupVisible(false);
}

async function runSetup(forceDirect = false) {
  if (setupBusy) return;
  resetProgress();
  setSetupBusy(true);

  try {
    const chosenScreens = Number(setupScreenCount.value);
    const chosenZoom = Number(setupZoom.value);
    const chosenNetwork = forceDirect ? 'direct' : selectedSetupNetwork();

    setStep('workspace', 'running', 'Applying layout and zoom…');
    await Promise.all([
      window.relay.setScreenCount(chosenScreens),
      window.relay.setZoom(chosenZoom),
    ]);
    setStep('workspace', 'done', `${chosenScreens} screen${chosenScreens === 1 ? '' : 's'} · ${Math.round(chosenZoom * 100)}%`);

    setStep('network', 'running', chosenNetwork === 'tor' ? 'Looking for local Tor on ports 9050 and 9150…' : 'Using your normal connection…');
    const networkResult = await window.relay.setNetwork(chosenNetwork);

    if (!networkResult?.ok) {
      setStep('network', 'error', 'Tor service was not available');
      setupError.hidden = false;
      setupError.textContent = networkResult?.error || 'Relay could not connect to a local Tor service.';
      continueDirect.hidden = false;
      setupLaunch.textContent = 'Retry Tor';
      setSetupBusy(false);
      setupLaunch.textContent = 'Retry Tor';
      return;
    }

    setStep('network', 'done', chosenNetwork === 'tor' ? 'Local Tor connected; remote DNS enabled' : 'Direct connection ready');

    if (setupCheckIPs.checked) {
      setStep('ip', 'running', 'Checking every visible screen…');
      const ipResult = await window.relay.checkIPs();
      if (ipResult?.ok) {
        setStep('ip', 'done', ipResult.duplicate ? 'Checked · duplicate exit detected' : 'All visible screens checked');
      } else {
        setStep('ip', 'done', 'Finished with one or more unavailable results');
      }
    } else {
      setStep('ip', 'skipped', 'Skipped');
    }

    setStep('sync', 'running', 'Applying preference…');
    await window.relay.setSync(setupSync.checked);
    setStep('sync', 'done', setupSync.checked ? 'Enabled' : 'Disabled');

    await new Promise((resolve) => setTimeout(resolve, 280));
    await hideSetup();
  } catch (error) {
    setupError.hidden = false;
    setupError.textContent = error?.message || String(error);
  } finally {
    setSetupBusy(false);
  }
}

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  window.relay.navigate(address.value);
});
back.addEventListener('click', () => window.relay.back());
forward.addEventListener('click', () => window.relay.forward());
reload.addEventListener('click', () => window.relay.reload());

screenCount.addEventListener('change', () => window.relay.setScreenCount(Number(screenCount.value)));
zoom.addEventListener('change', () => window.relay.setZoom(Number(zoom.value)));
network.addEventListener('change', async () => {
  const result = await window.relay.setNetwork(network.value);
  if (!result?.ok) await showSetup(result?.error || 'Tor was unavailable.');
});
checkIPs.addEventListener('click', () => window.relay.checkIPs());
sync.addEventListener('change', () => window.relay.setSync(sync.checked));
openSettings.addEventListener('click', () => showSetup());
setupCancel.addEventListener('click', () => {
  if (hasOpenedWorkspace && !setupBusy) hideSetup();
});
setupLaunch.addEventListener('click', () => runSetup(false));
continueDirect.addEventListener('click', () => {
  chooseSetupNetwork('direct');
  runSetup(true);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && hasOpenedWorkspace && !setupBusy && !setupBackdrop.classList.contains('hidden')) {
    hideSetup();
  }
});

window.relay.onState((state) => {
  latestState = state;
  if (document.activeElement !== address) address.value = state.currentURL;
  screenCount.value = String(state.screenCount);
  zoom.value = String(state.zoomFactor);
  network.value = state.networkMode;
  sync.checked = state.syncRequested;
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  network.disabled = state.networkBusy;
  checkIPs.disabled = state.networkBusy;
  sync.disabled = state.networkBusy;
  status.textContent = state.status;
  dnsStatus.textContent = state.dnsStatus;

  statusDot.className = 'status-dot';
  if (state.networkBusy) statusDot.classList.add('busy');
  else if (state.syncRequested && !state.syncReady) statusDot.classList.add('warning');
  else if (state.networkMode === 'tor') statusDot.classList.add('secure');

  renderLabels();
});

window.relay.onLayout(({ labels: layout }) => {
  latestLayout = layout;
  renderLabels();
});

window.relay.setSetupVisible(true);

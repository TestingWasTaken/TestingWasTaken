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
const consoleElement = document.querySelector('#console');
const clearConsole = document.querySelector('#clear-console');

let latestState = null;
let latestLayout = [];
let logEntries = [];

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
  const requested = network.value;
  const result = await window.relay.setNetwork(requested);
  if (result && result.mode) network.value = result.mode;
});
checkIPs.addEventListener('click', () => window.relay.checkIPs());
sync.addEventListener('change', () => window.relay.setSync(sync.checked));
clearConsole.addEventListener('click', () => window.relay.clearConsole());

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

function renderConsole() {
  consoleElement.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const entry of logEntries) {
    const row = document.createElement('div');
    row.className = `console-entry ${entry.level || 'info'}`;

    const time = document.createElement('time');
    time.textContent = entry.time || '';

    const message = document.createElement('span');
    message.textContent = entry.message || '';

    row.append(time, message);
    fragment.appendChild(row);
  }
  consoleElement.appendChild(fragment);
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

function addLog(entry) {
  logEntries.push(entry);
  if (logEntries.length > 300) logEntries = logEntries.slice(-300);
  renderConsole();
}

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

window.relay.onLog(addLog);
window.relay.onLogsReset((entries) => {
  logEntries = Array.isArray(entries) ? entries.slice(-300) : [];
  renderConsole();
});

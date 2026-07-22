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
const topStatus = document.querySelector('#top-status');
const networkIndicator = document.querySelector('#network-indicator');
const dnsStatus = document.querySelector('#dns-status');
const ipSummary = document.querySelector('#ip-summary');
const labels = document.querySelector('#labels');
const consoleLog = document.querySelector('#console-log');
const clearLog = document.querySelector('#clear-log');

let latestState = null;
let latestLayout = [];
const displayedLogIds = new Set();

function appendLog(entry) {
  if (!entry || displayedLogIds.has(entry.id)) return;
  displayedLogIds.add(entry.id);

  const row = document.createElement('div');
  row.className = `log-entry ${entry.level || 'info'}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = entry.time || '--:--:--';

  const level = document.createElement('span');
  level.className = 'log-level';
  level.textContent = entry.level || 'info';

  const message = document.createElement('span');
  message.className = 'log-message';
  message.textContent = entry.message || '';

  row.append(time, level, message);

  if (entry.detail) {
    const detail = document.createElement('div');
    detail.className = 'log-detail';
    detail.textContent = entry.detail;
    row.appendChild(detail);
  }

  consoleLog.appendChild(row);
  while (consoleLog.children.length > 250) consoleLog.firstElementChild.remove();
  consoleLog.scrollTop = consoleLog.scrollHeight;
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

    const result = latestState?.ips?.[item.index];
    let suffix = '';
    if (result) {
      suffix = ` — ${result.ip}`;
      if (latestState.networkMode === 'tor' && result.isTor === false) suffix += ' (not Tor)';
    }
    label.textContent = `Screen ${item.index + 1}${suffix}`;
    labels.appendChild(label);
  });
}

function renderIPs(state) {
  ipSummary.replaceChildren();
  (state.ips || []).slice(0, state.screenCount).forEach((result, index) => {
    if (!result) return;
    const row = document.createElement('div');
    row.className = 'ip-line';
    const title = document.createElement('strong');
    title.textContent = `Screen ${index + 1}`;
    const value = document.createElement('span');
    value.textContent = result.ok ? result.ip : `Unavailable${result.error ? ` — ${result.error}` : ''}`;
    row.append(title, value);
    ipSummary.appendChild(row);
  });
}

addressForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await window.relay.navigate(address.value);
});
back.addEventListener('click', () => window.relay.back());
forward.addEventListener('click', () => window.relay.forward());
reload.addEventListener('click', () => window.relay.reload());
screenCount.addEventListener('change', () => window.relay.setScreenCount(Number(screenCount.value)));
zoom.addEventListener('change', () => window.relay.setZoom(Number(zoom.value)));
sync.addEventListener('change', () => window.relay.setSync(sync.checked));

network.addEventListener('change', async () => {
  network.disabled = true;
  try {
    await window.relay.setNetwork(network.value);
  } finally {
    network.disabled = false;
  }
});

checkIPs.addEventListener('click', () => window.relay.checkIPs());
clearLog.addEventListener('click', async () => {
  await window.relay.clearLogs();
  displayedLogIds.clear();
  consoleLog.replaceChildren();
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
  screenCount.disabled = state.networkBusy;
  zoom.disabled = state.networkBusy;
  network.disabled = state.networkBusy;
  checkIPs.disabled = state.networkBusy;
  sync.disabled = state.networkBusy;

  topStatus.textContent = state.status;
  topStatus.className = 'status-chip';
  if (state.errorState) topStatus.classList.add('error');
  else if (state.syncRequested && !state.syncReady) topStatus.classList.add('paused');

  networkIndicator.textContent = state.networkBusy ? 'Working' : state.networkMode === 'tor' ? 'Tor' : 'Direct';
  networkIndicator.className = `indicator ${state.networkBusy ? 'busy' : state.networkMode}`;
  dnsStatus.textContent = state.dnsStatus;
  renderIPs(state);
  renderLabels();
});

window.relay.onLayout(({ labels: layout }) => {
  latestLayout = layout;
  renderLabels();
});

window.relay.onLog(appendLog);
window.relay.getLogs().then((entries) => entries.forEach(appendLog));

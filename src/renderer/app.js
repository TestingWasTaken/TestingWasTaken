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
const labels = document.querySelector('#labels');
let latestState = null;
let latestLayout = [];

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  window.relay.navigate(address.value);
});
back.addEventListener('click', () => window.relay.back());
forward.addEventListener('click', () => window.relay.forward());
reload.addEventListener('click', () => window.relay.reload());
screenCount.addEventListener('change', () => window.relay.setScreenCount(Number(screenCount.value)));
zoom.addEventListener('change', () => window.relay.setZoom(Number(zoom.value)));
network.addEventListener('change', () => window.relay.setNetwork(network.value));
checkIPs.addEventListener('click', () => window.relay.checkIPs());
sync.addEventListener('change', () => window.relay.setSync(sync.checked));

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
    const ip = result ? ` — ${result.ip}${result.isTor === false && latestState.networkMode === 'tor' ? ' (not Tor)' : ''}` : '';
    label.textContent = `Screen ${item.index + 1}${ip}`;
    labels.appendChild(label);
  });
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
  status.textContent = `${state.status} · ${state.dnsStatus}`;
  status.className = state.syncRequested && !state.syncReady ? 'paused' : '';
  renderLabels();
});

window.relay.onLayout(({ labels: layout }) => {
  latestLayout = layout;
  renderLabels();
});

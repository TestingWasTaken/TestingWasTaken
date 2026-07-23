'use strict';

require('./page-preload-v26');

const { ipcRenderer } = require('electron');

const argument = process.argv.find((value) => value.startsWith('--conduit-pane='))
  || process.argv.find((value) => value.startsWith('--relay-screen='));
const paneNumber = Number(argument?.split('=')[1] || 0);
const isFollower = Number.isInteger(paneNumber) && paneNumber > 1 && paneNumber <= 8;

let overlay = null;
let overlayTitle = null;
let overlayMessage = null;

function selectEditable(target) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const length = String(target.value || '').length;
    target.setSelectionRange?.(0, length);
    return true;
  }

  const editable = target instanceof Element ? target.closest('[contenteditable="true"]') : null;
  if (editable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  return false;
}

function selectPage() {
  const root = document.body || document.documentElement;
  if (!root) return;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(root);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
  event.preventDefault();
  event.stopPropagation();
  if (!selectEditable(event.target)) selectPage();
}, true);

function installOverlay() {
  if (!isFollower || overlay) return overlay;

  const style = document.createElement('style');
  style.textContent = `
    #conduit-recovery-v27 {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: none;
      place-items: center;
      padding: 24px;
      background: rgba(29, 34, 42, .58);
      backdrop-filter: blur(12px) saturate(1.08);
      -webkit-backdrop-filter: blur(12px) saturate(1.08);
      color: #f5f7fa;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      pointer-events: auto;
    }
    #conduit-recovery-v27[data-active="true"] { display: grid; }
    #conduit-recovery-v27 .conduit-recovery-card {
      width: min(320px, 100%);
      padding: 19px 20px 18px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 13px;
      background: rgba(61, 68, 81, .78);
      box-shadow: 0 20px 55px rgba(0,0,0,.28);
      text-align: center;
    }
    #conduit-recovery-v27 .conduit-recovery-spinner {
      width: 22px;
      height: 22px;
      margin: 0 auto 12px;
      border: 2px solid rgba(255,255,255,.2);
      border-top-color: #8fc0ff;
      border-radius: 50%;
      animation: conduit-recovery-spin .8s linear infinite;
    }
    #conduit-recovery-v27 strong { display: block; margin-bottom: 4px; font-size: 14px; }
    #conduit-recovery-v27 span { color: rgba(235,239,246,.72); font-size: 11px; }
    @keyframes conduit-recovery-spin { to { transform: rotate(360deg); } }
  `;

  overlay = document.createElement('div');
  overlay.id = 'conduit-recovery-v27';
  overlay.dataset.active = 'false';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="conduit-recovery-card">
      <div class="conduit-recovery-spinner" aria-hidden="true"></div>
      <strong>Catching up</strong>
      <span>Checking this screen against Screen 1…</span>
    </div>
  `;
  overlayTitle = overlay.querySelector('strong');
  overlayMessage = overlay.querySelector('span');

  (document.head || document.documentElement).appendChild(style);
  (document.body || document.documentElement).appendChild(overlay);
  return overlay;
}

function setRecovery(value = {}) {
  if (!isFollower) return;
  const element = installOverlay();
  if (!element) return;

  const active = value.active === true;
  element.dataset.active = String(active);
  element.setAttribute('aria-hidden', String(!active));
  if (active) {
    overlayTitle.textContent = String(value.title || 'Catching up');
    overlayMessage.textContent = String(value.message || 'Synchronizing with Screen 1…');
  }
}

ipcRenderer.on('v27-recovery', (_event, value) => setRecovery(value));

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installOverlay, { once: true });
} else {
  installOverlay();
}

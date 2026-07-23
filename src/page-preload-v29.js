'use strict';

require('./page-preload-v28');

const { ipcRenderer } = require('electron');

const argument = process.argv.find((value) => value.startsWith('--conduit-pane='))
  || process.argv.find((value) => value.startsWith('--relay-screen='));
const paneNumber = Number(argument?.split('=')[1] || 0);
const isFollower = Number.isInteger(paneNumber) && paneNumber > 1 && paneNumber <= 8;

let currentURL = null;
let targetURL = null;
let actions = null;
let resetButton = null;
let manualButton = null;
let statusMessage = null;

function installRecoveryControls() {
  if (!isFollower) return null;
  const overlay = document.querySelector('#conduit-recovery-v27');
  const card = overlay?.querySelector('.conduit-recovery-card');
  if (!overlay || !card) return null;

  if (!document.querySelector('#conduit-recovery-v29-style')) {
    const style = document.createElement('style');
    style.id = 'conduit-recovery-v29-style';
    style.textContent = `
      #conduit-recovery-v27[data-recovery-mode="failed"] {
        inset: 12px 12px auto auto;
        width: min(340px, calc(100vw - 24px));
        height: auto;
        padding: 0;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        pointer-events: none;
      }
      #conduit-recovery-v27[data-active="true"][data-recovery-mode="failed"] { display: block; }
      #conduit-recovery-v27[data-recovery-mode="failed"] .conduit-recovery-card {
        width: 100%;
        box-sizing: border-box;
        padding: 15px;
        border-radius: 12px;
        background: rgba(48, 54, 65, .94);
        box-shadow: 0 14px 42px rgba(0, 0, 0, .34);
        text-align: left;
        pointer-events: auto;
      }
      #conduit-recovery-v27[data-recovery-mode="failed"] .conduit-recovery-spinner { display: none; }
      #conduit-recovery-v27 .conduit-recovery-v29-details { display: none; margin-top: 12px; }
      #conduit-recovery-v27[data-recovery-mode="failed"] .conduit-recovery-v29-details { display: block; }
      #conduit-recovery-v27 .conduit-recovery-v29-label {
        display: block;
        margin: 10px 0 3px;
        color: rgba(235, 239, 246, .58);
        font-size: 10px;
        font-weight: 650;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      #conduit-recovery-v27 .conduit-recovery-v29-url {
        display: block;
        max-height: 52px;
        overflow: hidden;
        color: rgba(248, 250, 253, .92);
        font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        overflow-wrap: anywhere;
      }
      #conduit-recovery-v27 .conduit-recovery-v29-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 14px;
      }
      #conduit-recovery-v27 .conduit-recovery-v29-actions button {
        min-height: 34px;
        padding: 7px 9px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 8px;
        background: rgba(255, 255, 255, .08);
        color: #f5f7fa;
        font: 600 11px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
        cursor: pointer;
      }
      #conduit-recovery-v27 .conduit-recovery-v29-actions button:hover { background: rgba(255, 255, 255, .13); }
      #conduit-recovery-v27 .conduit-recovery-v29-actions button:disabled { cursor: wait; opacity: .55; }
      #conduit-recovery-v27 .conduit-recovery-v29-actions .manual { background: rgba(80, 145, 235, .24); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  let details = card.querySelector('.conduit-recovery-v29-details');
  if (!details) {
    details = document.createElement('div');
    details.className = 'conduit-recovery-v29-details';
    details.innerHTML = `
      <span class="conduit-recovery-v29-label">Currently showing</span>
      <code class="conduit-recovery-v29-url current"></code>
      <span class="conduit-recovery-v29-label">Screen 1 target</span>
      <code class="conduit-recovery-v29-url target"></code>
      <div class="conduit-recovery-v29-actions">
        <button type="button" class="reset">Reset screen</button>
        <button type="button" class="manual">Manual control</button>
      </div>
    `;
    card.appendChild(details);
  }

  currentURL = details.querySelector('.current');
  targetURL = details.querySelector('.target');
  actions = details.querySelector('.conduit-recovery-v29-actions');
  resetButton = details.querySelector('.reset');
  manualButton = details.querySelector('.manual');
  statusMessage = card.querySelector('span:not(.conduit-recovery-v29-label)');

  if (!resetButton.dataset.bound) {
    resetButton.dataset.bound = 'true';
    resetButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetButton.disabled = true;
      manualButton.disabled = true;
      const title = card.querySelector('strong');
      if (title) title.textContent = 'Resetting screen';
      if (statusMessage) statusMessage.textContent = 'Clearing this screen and rebuilding its connection…';

      try {
        const result = await ipcRenderer.invoke('v18-reset-pane', paneNumber);
        if (result?.ok === false) throw new Error(result.error || 'Reset failed.');
        await ipcRenderer.invoke('v26-resync-all').catch(() => null);
      } catch (error) {
        if (title) title.textContent = 'Reset failed';
        if (statusMessage) statusMessage.textContent = error?.message || String(error);
        resetButton.disabled = false;
        manualButton.disabled = false;
      }
    });
  }

  if (!manualButton.dataset.bound) {
    manualButton.dataset.bound = 'true';
    manualButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetButton.disabled = true;
      manualButton.disabled = true;

      try {
        const result = await ipcRenderer.invoke('v18-set-pane-paused', paneNumber, true);
        if (result?.ok === false) throw new Error(result.error || 'Manual control could not be enabled.');
        overlay.dataset.active = 'false';
        overlay.setAttribute('aria-hidden', 'true');
      } catch (error) {
        const title = card.querySelector('strong');
        if (title) title.textContent = 'Could not enable manual control';
        if (statusMessage) statusMessage.textContent = error?.message || String(error);
        resetButton.disabled = false;
        manualButton.disabled = false;
      }
    });
  }

  return overlay;
}

function applyRecoveryMode(value = {}) {
  if (!isFollower) return;
  setTimeout(() => {
    const overlay = installRecoveryControls();
    if (!overlay) return;

    const failed = value.failed === true || value.mode === 'failed';
    overlay.dataset.recoveryMode = failed ? 'failed' : 'blocking';

    if (!failed) {
      resetButton.disabled = false;
      manualButton.disabled = false;
      return;
    }

    const shown = String(value.currentURL || location.href || 'Address unavailable');
    const target = String(value.targetURL || 'Screen 1 address unavailable');
    currentURL.textContent = shown;
    currentURL.title = shown;
    targetURL.textContent = target;
    targetURL.title = target;
    resetButton.disabled = false;
    manualButton.disabled = false;
  }, 0);
}

ipcRenderer.on('v27-recovery', (_event, value) => applyRecoveryMode(value));

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installRecoveryControls, { once: true });
} else {
  installRecoveryControls();
}

'use strict';

(() => {
  const THEME_KEY = 'conduit.interface-theme';
  const THEMES = new Set(['mineral', 'graphite', 'dune', 'moss']);

  const root = document.documentElement;
  const backdrop = document.querySelector('#setup-backdrop');
  const dialog = document.querySelector('#setup-dialog');
  const setupTitle = document.querySelector('#setup-title');
  const setupIntro = document.querySelector('#setup-intro');
  const setupEyebrow = document.querySelector('#setup-eyebrow');
  const setupCount = document.querySelector('#setup-screen-count');
  const quickCount = document.querySelector('#quick-screen-count');
  const themeInputs = [...document.querySelectorAll('input[name="conduit-theme"]')];
  const resetButtons = [...document.querySelectorAll('.screen-reset-button')];
  const creditLink = document.querySelector('#jujhar-link');

  let latestState = null;

  function applyTheme(value, { persist = true } = {}) {
    const theme = THEMES.has(value) ? value : 'mineral';
    root.dataset.conduitTheme = theme;
    themeInputs.forEach((input) => { input.checked = input.value === theme; });
    if (persist) localStorage.setItem(THEME_KEY, theme);
  }

  function currentPaneChoice() {
    const settingsVisible = backdrop && !backdrop.classList.contains('hidden') && !dialog?.classList.contains('operation-mode');
    if (settingsVisible) return Math.max(1, Math.min(8, Number(setupCount?.value) || 1));
    return Math.max(1, Math.min(8, Number(latestState?.screenCount) || Number(setupCount?.value) || 4));
  }

  function syncResetButtons() {
    const count = currentPaneChoice();
    const operationActive = dialog?.classList.contains('operation-mode');

    resetButtons.forEach((button) => {
      const pane = Number(button.dataset.screen);
      const unavailable = pane > count;
      button.classList.toggle('unavailable', unavailable);
      button.disabled = operationActive || unavailable;
    });

    root.classList.toggle('conduit-high-load', count > 4);
  }

  function syncSettingsHeader() {
    if (!dialog || dialog.classList.contains('operation-mode')) return;
    if (setupEyebrow && setupEyebrow.textContent !== 'Conduit 0.16') setupEyebrow.textContent = 'Conduit 0.16';
    if (setupTitle && setupTitle.textContent !== 'Settings') setupTitle.textContent = 'Settings';
    const copy = 'Configure the workspace, route, appearance, and session tools.';
    if (setupIntro && setupIntro.textContent !== copy) setupIntro.textContent = copy;
  }

  const storedTheme = localStorage.getItem(THEME_KEY);
  applyTheme(storedTheme || 'mineral', { persist: false });

  themeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) applyTheme(input.value);
    });
  });

  setupCount?.addEventListener('change', syncResetButtons);
  quickCount?.addEventListener('change', () => {
    root.classList.toggle('conduit-high-load', Number(quickCount.value) > 4);
  });

  creditLink?.addEventListener('click', (event) => {
    event.preventDefault();
    window.relay.openExternal?.(creditLink.href);
  });

  if (dialog) {
    new MutationObserver(() => {
      syncSettingsHeader();
      syncResetButtons();
      const operationActive = dialog.classList.contains('operation-mode');
      themeInputs.forEach((input) => { input.disabled = operationActive; });
    }).observe(dialog, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  }

  window.relay.onState((state) => {
    latestState = state;
    const count = Math.max(1, Math.min(8, Number(state?.screenCount) || 4));
    if (quickCount && document.activeElement !== quickCount) quickCount.value = String(count);
    if (setupCount && dialog?.classList.contains('operation-mode')) setupCount.value = String(count);
    syncResetButtons();
  });

  syncSettingsHeader();
  syncResetButtons();
})();

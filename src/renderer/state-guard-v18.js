'use strict';

(() => {
  const originalState = window.conduit.onState;
  const originalHealth = window.conduit.onHealth;
  let dirty = false;
  let deferredState = null;
  let deferredHealth = null;
  let stateCallback = null;
  let healthCallback = null;

  function settingsOpen() {
    return !document.querySelector('#settings-backdrop')?.classList.contains('hidden');
  }

  function editingName() {
    return document.activeElement?.classList?.contains('pane-name-input');
  }

  function operationRunning() {
    return document.body.classList.contains('busy');
  }

  function shouldDefer() {
    return settingsOpen() && !operationRunning() && (dirty || editingName());
  }

  function flush() {
    if (shouldDefer()) return;
    if (deferredState && stateCallback) {
      const value = deferredState;
      deferredState = null;
      stateCallback(value);
    }
    if (deferredHealth && healthCallback) {
      const value = deferredHealth;
      deferredHealth = null;
      healthCallback(value);
    }
  }

  window.conduit.onState = (callback) => {
    stateCallback = callback;
    originalState((value) => {
      if (shouldDefer()) deferredState = value;
      else callback(value);
    });
  };

  window.conduit.onHealth = (callback) => {
    healthCallback = callback;
    originalHealth((value) => {
      if (shouldDefer()) deferredHealth = value;
      else callback(value);
    });
  };

  window.addEventListener('DOMContentLoaded', () => {
    const backdrop = document.querySelector('#settings-backdrop');
    const settings = document.querySelector('.settings-sections');

    settings?.addEventListener('change', (event) => {
      if (event.isTrusted && !operationRunning()) dirty = true;
    }, true);

    document.addEventListener('focusout', () => setTimeout(flush, 0), true);

    for (const selector of ['#apply-settings', '#cancel-settings', '#close-settings']) {
      document.querySelector(selector)?.addEventListener('click', () => {
        dirty = false;
        setTimeout(flush, 0);
      }, true);
    }

    if (backdrop) {
      new MutationObserver(() => {
        if (backdrop.classList.contains('hidden')) dirty = false;
        flush();
      }).observe(backdrop, { attributes: true, attributeFilter: ['class'] });
    }
  }, { once: true });
})();

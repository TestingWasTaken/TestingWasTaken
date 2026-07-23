'use strict';

(() => {
  const api = window.conduit;
  if (!api) return;

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const DEFAULT_POLICY = { navigation: false, scrolling: false, typing: false, clicks: false };
  let applyPending = false;
  let settingsStartCount = 4;
  let paneTask = null;

  function clampPaneCount(value) {
    return Math.max(1, Math.min(8, Number(value) || 4));
  }

  function defaultPaneName(index) {
    return index === 0 ? 'Main screen' : `Follower ${String.fromCharCode(64 + index)}`;
  }

  function installStyles() {
    const style = document.createElement('style');
    style.id = 'conduit-v23-fixes';
    style.textContent = `
      #close-settings, #show-all-panes, .pane-number, .pane-index,
      button[data-action="focus"] { display: none !important; }
      .settings-header { justify-content: flex-start !important; }
      .settings-sheet { width: min(980px, calc(100vw - 32px)) !important; height: min(860px, calc(100vh - 32px)) !important; }
      .settings-sections { padding-bottom: 34px !important; }
      #topology-list { display: grid !important; grid-template-columns: 1fr !important; gap: 8px !important; }
      .pane-card, .pane-row, .pane-row-v22 {
        display: grid !important;
        grid-template-columns: minmax(230px, .9fr) minmax(190px, 1fr) auto !important;
        align-items: center !important;
        gap: 12px !important;
        min-height: 64px !important;
        padding: 10px 12px 10px 17px !important;
        overflow: hidden !important;
      }
      .pane-card-head { display: grid !important; grid-template-columns: minmax(0, 1fr) auto !important; align-items: center !important; gap: 8px !important; }
      .pane-name-input { min-width: 0 !important; width: 100% !important; }
      .pane-route { min-width: 0 !important; margin: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
      .pane-card-actions, .pane-actions { display: flex !important; justify-content: flex-end !important; gap: 6px !important; white-space: nowrap !important; }
      .settings-footer { position: relative !important; z-index: 3 !important; }
      @media (max-width: 820px) {
        .pane-card, .pane-row, .pane-row-v22 { grid-template-columns: 1fr auto !important; }
        .pane-route { grid-column: 1 / -1 !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function cleanPaneUI() {
    document.querySelector('#close-settings')?.remove();
    document.querySelector('#show-all-panes')?.remove();
    const apply = document.querySelector('#apply-settings');
    if (apply) apply.textContent = 'Apply and close';

    const list = document.querySelector('#topology-list');
    if (!list) return;
    list.querySelectorAll('.pane-number, .pane-index, button[data-action="focus"]').forEach((element) => element.remove());
    list.querySelectorAll('.pane-card, .pane-row').forEach((element) => element.classList.add('pane-row-v22'));
  }

  async function resyncBurst() {
    for (const delay of [0, 220, 700]) {
      if (delay) await wait(delay);
      try { await api.resyncAll(); } catch {}
    }
  }

  async function ensurePaneCount(value, shouldResync = true) {
    const count = clampPaneCount(value);
    if (paneTask) await paneTask;
    paneTask = (async () => {
      let result = await api.setPaneCount(count);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await wait(180 + (attempt * 180));
        const state = await api.getWorkspace().catch(() => null);
        if (Number(state?.screenCount) === count) break;
        result = await api.setPaneCount(count);
      }
      try { await api.syncV22State({ visibleCount: count }); } catch {}
      if (shouldResync) await resyncBurst();
      return result;
    })();
    try {
      return await paneTask;
    } finally {
      paneTask = null;
    }
  }

  async function freshStart() {
    try { await api.setSettingsVisible(false); } catch {}
    await ensurePaneCount(4, false);
    await api.setZoom(0.8).catch(() => {});
    await api.setAudioMode('leader').catch(() => {});
    await api.setPolicy(DEFAULT_POLICY).catch(() => {});
    await api.setFollowing(false).catch(() => {});
    await api.focusPane(0).catch(() => {});
    for (let index = 0; index < 8; index += 1) {
      await api.setPaneLabel(index + 1, defaultPaneName(index)).catch(() => {});
    }
    let navigation = await api.navigate('relay://welcome').catch(() => ({ ok: false }));
    if (navigation?.ok === false) {
      await wait(260);
      try { await api.setSettingsVisible(false); } catch {}
      navigation = await api.navigate('relay://welcome').catch(() => ({ ok: false }));
    }
    try {
      await api.syncV22State({ visibleCount: 4, following: false, policy: DEFAULT_POLICY });
    } catch {}
    await resyncBurst();

    const quick = document.querySelector('#quick-pane-count');
    const setting = document.querySelector('#setting-pane-count');
    const zoom = document.querySelector('#setting-zoom');
    if (quick) quick.value = '4';
    if (setting) setting.value = '4';
    if (zoom) zoom.value = '0.8';

    setTimeout(() => document.querySelector('#open-settings')?.click(), 80);
  }

  function installInteractions() {
    const quickCount = document.querySelector('#quick-pane-count');
    const settingCount = document.querySelector('#setting-pane-count');
    const apply = document.querySelector('#apply-settings');
    const cancel = document.querySelector('#cancel-settings');
    const backdrop = document.querySelector('#settings-backdrop');

    quickCount?.addEventListener('change', () => ensurePaneCount(quickCount.value), false);

    settingCount?.addEventListener('change', async () => {
      await ensurePaneCount(settingCount.value, false);
      cleanPaneUI();
    }, false);

    apply?.addEventListener('click', () => {
      applyPending = true;
      const desired = clampPaneCount(settingCount?.value);
      setTimeout(() => ensurePaneCount(desired, false), 120);
    }, true);

    cancel?.addEventListener('click', () => {
      applyPending = false;
      setTimeout(() => ensurePaneCount(settingsStartCount), 80);
    }, true);

    if (backdrop) {
      let wasVisible = !backdrop.classList.contains('hidden');
      new MutationObserver(async () => {
        const visible = !backdrop.classList.contains('hidden');
        if (visible && !wasVisible) {
          const state = await api.getWorkspace().catch(() => null);
          settingsStartCount = clampPaneCount(state?.screenCount);
        }
        if (!visible && wasVisible && applyPending) {
          applyPending = false;
          const desired = clampPaneCount(settingCount?.value);
          await ensurePaneCount(desired, true);
        }
        wasVisible = visible;
      }).observe(backdrop, { attributes: true, attributeFilter: ['class'] });
    }

    const list = document.querySelector('#topology-list');
    if (list) new MutationObserver(cleanPaneUI).observe(list, { childList: true, subtree: true });
  }

  window.addEventListener('DOMContentLoaded', async () => {
    installStyles();
    cleanPaneUI();
    installInteractions();
    await freshStart();
    cleanPaneUI();
  }, { once: true });
})();

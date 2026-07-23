'use strict';

(() => {
  const api = window.conduit;
  if (!api) return;

  const original = {
    navigate: api.navigate,
    setPaneCount: api.setPaneCount,
    setPolicy: api.setPolicy,
    setFollowing: api.setFollowing,
    pausePane: api.pausePane,
    resetPane: api.resetPane,
    setSettingsVisible: api.setSettingsVisible,
    getWorkspace: api.getWorkspace,
    onState: api.onState,
    onHealth: api.onHealth,
  };

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const DEFAULT_POLICY = { navigation: false, scrolling: false, typing: false, clicks: false };

  let latestState = null;
  let latestHealth = null;
  let initializing = true;
  let navigationPromise = null;
  let paneTask = null;
  let lastPaneMarkup = '';

  function clampPaneCount(value) {
    return Math.max(1, Math.min(8, Number(value) || 4));
  }

  function defaultPaneName(index) {
    return index === 0 ? 'Main screen' : `Follower ${index}`;
  }

  function normalizePaneName(value, index) {
    const text = String(value || '').trim();
    if (index === 0 && (!text || /^(main|main screen|pane 1)$/i.test(text))) return 'Main screen';
    if (index > 0 && (!text || /^pane \d+$/i.test(text) || /^follower [a-g]$/i.test(text))) {
      return `Follower ${index}`;
    }
    return text || defaultPaneName(index);
  }

  function normalizeRoute(item) {
    if (!item || typeof item !== 'object' || !item.ok) return item;
    const location = String(item.location || '').trim();
    if (!location || /^location unavailable$/i.test(location)) {
      return { ...item, location: 'IP swapped · location unavailable' };
    }
    return item;
  }

  function mapState(state) {
    if (!state || typeof state !== 'object') return state;
    return {
      ...state,
      paneLabels: Array.isArray(state.paneLabels)
        ? state.paneLabels.map(normalizePaneName)
        : state.paneLabels,
      ips: Array.isArray(state.ips) ? state.ips.map(normalizeRoute) : state.ips,
    };
  }

  function anyPolicy(policy = {}) {
    return Object.values(policy).some(Boolean);
  }

  function soundEnabled(paneNumber) {
    const mode = latestState?.audioMode || 'leader';
    if (mode === 'all') return paneNumber <= Number(latestState?.screenCount || 1);
    if (mode === 'focused') return paneNumber === Number(latestState?.focusedPane || 1);
    if (mode === 'leader') return paneNumber === 1;
    return false;
  }

  function statusForPane(paneNumber) {
    if (paneNumber === 1) return 'Screen 1 leads';
    const row = latestHealth?.rows?.find((entry) => entry.paneNumber === paneNumber);
    if (!row?.registered) return 'Starting';
    if (row.paused) return 'Paused';
    if (row.challenge) return 'Skipped';
    if (row.loading) return 'Loading';
    if (row.caughtUp) return 'Aligned';
    if (row.scrollOffset !== null && row.scrollOffset !== undefined) return 'Catching up';
    return 'Connected';
  }

  function routeForPane(paneNumber) {
    return latestState?.ips?.[paneNumber - 1] || null;
  }

  function paneMeta(paneNumber) {
    const parts = [statusForPane(paneNumber)];
    const route = routeForPane(paneNumber);
    if (paneNumber > 1) parts.push(route?.ok && route.ip ? route.ip : 'IP not checked');
    if (soundEnabled(paneNumber)) parts.push('Sound enabled');
    return parts.join(' · ');
  }

  function paneLocation(paneNumber) {
    const route = routeForPane(paneNumber);
    if (!route) return paneNumber === 1 ? 'IP address not checked' : '';
    if (!route.ok) return route.error ? `IP unavailable · ${route.error}` : 'IP unavailable';
    return route.location || route.ip || 'IP address unavailable';
  }

  async function clearFollowerTargets() {
    try { await api.clearScrollTargets(); } catch {}
  }

  async function resyncBurst() {
    try { await api.requestPaneStates(); } catch {}
    for (const delay of [0, 180, 520]) {
      if (delay) await wait(delay);
      try { await api.resyncAll(); } catch {}
    }
  }

  async function verifiedPaneCount(value, shouldResync = false) {
    const count = clampPaneCount(value);
    if (paneTask) await paneTask;

    paneTask = (async () => {
      let result = await original.setPaneCount(count);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await wait(160 + (attempt * 170));
        const current = await original.getWorkspace().catch(() => null);
        if (Number(current?.screenCount) === count) break;
        result = await original.setPaneCount(count);
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

  api.getWorkspace = async () => mapState(await original.getWorkspace());

  api.onState = (callback) => original.onState((state) => {
    latestState = mapState(state);
    callback(latestState);
    queueMicrotask(patchPaneUI);
  });

  api.onHealth = (callback) => original.onHealth((health) => {
    latestHealth = health;
    callback(health);
    queueMicrotask(patchPaneUI);
  });

  api.setPaneCount = (value) => verifiedPaneCount(value, false);

  api.setPolicy = async (policy) => {
    const result = await original.setPolicy(policy);
    try { await api.syncV22State({ policy: policy || {} }); } catch {}
    if (!policy?.scrolling) await clearFollowerTargets();
    return result;
  };

  api.setFollowing = async (enabled) => {
    const result = await original.setFollowing(enabled);
    try { await api.syncV22State({ following: Boolean(enabled) }); } catch {}
    if (!enabled) await clearFollowerTargets();
    return result;
  };

  api.pausePane = async (pane, paused) => {
    const result = await original.pausePane(pane, paused);
    if (result?.ok !== false) {
      try { await api.syncV22State({ pause: { pane: Number(pane), paused: Boolean(paused) } }); } catch {}
    }
    return result;
  };

  api.navigate = async (value) => {
    const destination = String(value || '').trim() || 'relay://welcome';
    if (navigationPromise) return navigationPromise;

    navigationPromise = (async () => {
      const go = document.querySelector('#go');
      const previous = go?.textContent || 'Go';
      if (go) {
        go.disabled = true;
        go.textContent = 'Opening…';
      }

      try {
        let result = await original.navigate(destination);
        if (result?.ok === false) {
          await wait(240);
          result = await original.navigate(destination);
        }
        if (result?.ok === false && go) {
          go.title = result.error || 'The address could not be opened.';
          go.textContent = 'Try again';
          await wait(650);
        }
        return result;
      } catch (error) {
        if (go) {
          go.title = error?.message || String(error);
          go.textContent = 'Try again';
          await wait(650);
        }
        return { ok: false, error: error?.message || String(error) };
      } finally {
        if (go) {
          go.disabled = false;
          go.textContent = previous;
        }
        navigationPromise = null;
      }
    })();

    return navigationPromise;
  };

  api.resetPane = async (pane) => {
    try { await api.forgetPaneV22(Number(pane)); } catch {}
    const result = await original.resetPane(pane);
    if (result?.ok !== false) await resyncBurst();
    return result;
  };

  api.setSettingsVisible = async (visible) => {
    const result = await original.setSettingsVisible(visible);
    if (visible === false && result?.ok !== false && !initializing) {
      setTimeout(() => resyncBurst(), 0);
    }
    return result;
  };

  function patchPaneRows() {
    const list = document.querySelector('#topology-list');
    if (!list) return;

    list.querySelectorAll('.pane-number, .pane-index, button[data-action="focus"]').forEach((element) => element.remove());
    document.querySelector('#show-all-panes')?.remove();

    const rows = [...list.querySelectorAll('.pane-row, .pane-card')];
    for (const [index, row] of rows.entries()) {
      const paneNumber = Number(row.dataset.pane || index + 1);
      row.classList.add('pane-row-v24');

      const name = row.querySelector('.pane-name-input');
      if (name && document.activeElement !== name) name.value = normalizePaneName(name.value, paneNumber - 1);

      const meta = row.querySelector('.pane-meta');
      if (meta) meta.textContent = paneMeta(paneNumber);

      const route = row.querySelector('.pane-route');
      if (route) route.textContent = paneLocation(paneNumber);
    }
  }

  function patchPaneLabels() {
    const labels = [...document.querySelectorAll('#pane-labels .pane-label')];
    for (const [index, label] of labels.entries()) {
      const paneNumber = index + 1;
      const title = label.querySelector('strong');
      const detail = label.querySelector('span');
      if (title) title.textContent = defaultPaneName(index);
      if (detail) detail.textContent = paneMeta(paneNumber);
    }
  }

  function patchPaneUI() {
    const apply = document.querySelector('#apply-settings');
    if (apply) apply.textContent = 'Apply and close';
    document.querySelector('#close-settings')?.remove();
    patchPaneRows();
    patchPaneLabels();

    const signature = `${latestState?.screenCount}|${latestState?.audioMode}|${JSON.stringify(latestState?.ips || [])}|${JSON.stringify(latestHealth || {})}`;
    lastPaneMarkup = signature;
  }

  function installDraftNote() {
    const select = document.querySelector('#setting-pane-count');
    if (!select || document.querySelector('#pane-draft-note')) return;
    const note = document.createElement('small');
    note.id = 'pane-draft-note';
    note.textContent = 'Applied only after Apply and close.';
    select.closest('label')?.appendChild(note);
  }

  async function freshStart() {
    initializing = true;
    try { await original.setSettingsVisible(false); } catch {}
    await verifiedPaneCount(4, false);
    await api.setZoom(0.8).catch(() => {});
    await api.setAudioMode('leader').catch(() => {});
    await api.setPolicy(DEFAULT_POLICY).catch(() => {});
    await api.setFollowing(false).catch(() => {});
    await api.focusPane(0).catch(() => {});

    for (let index = 0; index < 8; index += 1) {
      await api.setPaneLabel(index + 1, defaultPaneName(index)).catch(() => {});
    }

    await api.navigate('relay://welcome').catch(() => {});
    try {
      await api.syncV22State({ visibleCount: 4, following: false, policy: DEFAULT_POLICY });
    } catch {}
    await clearFollowerTargets();
    await resyncBurst();

    const quick = document.querySelector('#quick-pane-count');
    const setting = document.querySelector('#setting-pane-count');
    const zoom = document.querySelector('#setting-zoom');
    if (quick) quick.value = '4';
    if (setting) setting.value = '4';
    if (zoom) zoom.value = '0.8';

    initializing = false;
    setTimeout(() => document.querySelector('#open-settings')?.click(), 90);
  }

  window.addEventListener('DOMContentLoaded', async () => {
    document.querySelector('#close-settings')?.remove();
    installDraftNote();

    const paneCount = document.querySelector('#setting-pane-count');
    paneCount?.addEventListener('change', () => {
      const summary = document.querySelector('#topology-summary');
      if (summary) summary.textContent = `${paneCount.value} screens selected · waiting for Apply and close`;
    }, true);

    const list = document.querySelector('#topology-list');
    if (list) new MutationObserver(patchPaneRows).observe(list, { childList: true, subtree: true });
    const labels = document.querySelector('#pane-labels');
    if (labels) new MutationObserver(patchPaneLabels).observe(labels, { childList: true, subtree: true });

    await freshStart();
    patchPaneUI();
  }, { once: true });
})();

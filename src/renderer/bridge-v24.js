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
    checkIPs: api.checkIPs,
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
  let patchQueued = false;
  const fallbackIPs = new Map();

  function clampPaneCount(value) {
    return Math.max(1, Math.min(8, Number(value) || 4));
  }

  function defaultPaneName(index) {
    return index === 0 ? 'Main screen' : `Follower ${index}`;
  }

  function normalizePaneName(value, index) {
    const text = String(value || '').trim();
    if (index === 0 && (!text || /^(main|main screen|pane 1)$/i.test(text))) return 'Main screen';
    if (index > 0 && (!text || /^pane \d+$/i.test(text) || /^follower [a-g]$/i.test(text))) return `Follower ${index}`;
    return text || defaultPaneName(index);
  }

  function normalizeRoute(item) {
    if (!item || typeof item !== 'object') return item;
    const ip = String(item.ip || '').trim();
    const location = String(item.location || '').trim();
    if (item.ok && (!location || /^location unavailable$/i.test(location) || /^ip swapped/i.test(location))) {
      return { ...item, ip, location: ip ? `IP address · ${ip}` : 'IP address unavailable' };
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

  function routeForPane(paneNumber) {
    const route = normalizeRoute(latestState?.ips?.[paneNumber - 1]);
    const existingIP = String(route?.ip || '').trim();
    if (existingIP && existingIP !== 'Unavailable') return route;
    const fallback = fallbackIPs.get(paneNumber);
    return fallback ? { ok: true, ip: fallback, location: `IP address · ${fallback}` } : route;
  }

  function statusForPane(paneNumber) {
    if (paneNumber === 1) return 'Screen 1 leads';
    const row = latestHealth?.rows?.find((entry) => entry.paneNumber === paneNumber);
    if (!row?.registered) return 'Starting';
    if (row.paused) return 'Paused';
    if (row.challenge) return 'Skipped';
    if (!latestHealth?.followingEnabled) return 'Independent';
    const score = Number(row.syncScore);
    if (Number.isFinite(score) && score >= 95) return `Synced ${score}%`;
    if (Number.isFinite(score) && score >= 70) return `Catching up ${score}%`;
    if (Number.isFinite(score)) return `Resyncing ${score}%`;
    return row.loading ? 'Loading' : 'Connecting sync';
  }

  function soundEnabled(paneNumber) {
    const mode = latestState?.audioMode || 'leader';
    if (mode === 'all') return paneNumber <= Number(latestState?.screenCount || 1);
    if (mode === 'focused') return paneNumber === Number(latestState?.focusedPane || 1);
    return mode === 'leader' && paneNumber === 1;
  }

  function paneMeta(paneNumber) {
    const parts = [statusForPane(paneNumber)];
    const route = routeForPane(paneNumber);
    if (paneNumber > 1) parts.push(route?.ip && route.ip !== 'Unavailable' ? route.ip : 'IP not checked');
    if (soundEnabled(paneNumber)) parts.push('Sound enabled');
    return parts.join(' · ');
  }

  function paneLocation(paneNumber) {
    const route = routeForPane(paneNumber);
    if (!route) return paneNumber === 1 ? 'IP address not checked' : '';
    const ip = String(route.ip || '').trim();
    const location = String(route.location || '').trim();
    if (!route.ok) return ip && ip !== 'Unavailable' ? `IP address · ${ip}` : 'IP address unavailable';
    if (!location || /^location unavailable$/i.test(location) || /^IP address\s*·/i.test(location)) {
      return ip ? `IP address · ${ip}` : 'IP address unavailable';
    }
    return ip ? `${location} · ${ip}` : location;
  }

  async function verifiedPaneCount(value) {
    const count = clampPaneCount(value);
    if (paneTask) await paneTask;
    paneTask = (async () => {
      let result = await original.setPaneCount(count);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await wait(140 + attempt * 160);
        const current = await original.getWorkspace().catch(() => null);
        if (Number(current?.screenCount) === count) break;
        result = await original.setPaneCount(count);
      }
      return result;
    })();
    try {
      return await paneTask;
    } finally {
      paneTask = null;
    }
  }

  async function resync() {
    try { return await api.resyncV26(); } catch { return null; }
  }

  api.getWorkspace = async () => mapState(await original.getWorkspace());

  api.onState = (callback) => original.onState((state) => {
    latestState = mapState(state);
    callback(latestState);
    queuePatch();
  });

  api.onHealth = (callback) => original.onHealth((health) => {
    latestHealth = health;
    callback(health);
    queuePatch();
  });

  api.setPaneCount = verifiedPaneCount;
  api.setPolicy = (next) => original.setPolicy(next || DEFAULT_POLICY);
  api.setFollowing = async (enabled) => {
    const result = await original.setFollowing(Boolean(enabled));
    if (result?.enabled) await resync();
    return result;
  };
  api.pausePane = async (pane, shouldPause) => {
    const result = await original.pausePane(pane, shouldPause);
    if (result?.ok !== false && !shouldPause && latestHealth?.followingEnabled) await resync();
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
          await wait(180);
          result = await original.navigate(destination);
        }
        if (result?.ok !== false && latestHealth?.followingEnabled) setTimeout(resync, 80);
        return result;
      } catch (error) {
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
    const result = await original.resetPane(pane);
    if (result?.ok !== false && latestHealth?.followingEnabled) await resync();
    return result;
  };

  api.setSettingsVisible = async (visible) => {
    const result = await original.setSettingsVisible(visible);
    if (visible === false && result?.ok !== false && !initializing && latestHealth?.followingEnabled) {
      setTimeout(resync, 30);
    }
    return result;
  };

  api.checkIPs = async () => {
    const result = await original.checkIPs();
    const results = Array.isArray(result?.results) ? result.results : [];
    const count = Number(latestState?.screenCount || results.length || 4);
    const missing = Array.from({ length: count }, (_unused, index) => {
      const route = results[index] || latestState?.ips?.[index];
      const ip = String(route?.ip || '').trim();
      return ip && ip !== 'Unavailable' ? null : index + 1;
    }).filter(Boolean);
    if (missing.length) {
      const fallbacks = await api.checkIPFallbacksV25(missing).catch(() => []);
      for (const item of Array.isArray(fallbacks) ? fallbacks : []) {
        if (item?.ok && item.ip) fallbackIPs.set(Number(item.paneNumber), String(item.ip));
      }
    }
    queuePatch();
    return result;
  };

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function patchRows() {
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
      setText(row.querySelector('.pane-meta'), paneMeta(paneNumber));
      setText(row.querySelector('.pane-route'), paneLocation(paneNumber));
    }
    const summary = document.querySelector('#topology-summary');
    const followers = Math.max(0, Number(latestState?.screenCount || latestHealth?.visiblePaneCount || 1) - 1);
    if (!latestHealth?.followingEnabled) setText(summary, `${followers} screens independent`);
    else setText(summary, `${latestHealth?.caughtUpFollowers || 0}/${followers} synced`);
  }

  function patchLabels() {
    const labels = [...document.querySelectorAll('#pane-labels .pane-label')];
    for (const [index, label] of labels.entries()) {
      const paneNumber = index + 1;
      setText(label.querySelector('strong'), defaultPaneName(index));
      setText(label.querySelector('span'), paneMeta(paneNumber));
    }
  }

  function patchUI() {
    patchQueued = false;
    document.querySelector('#close-settings')?.remove();
    const apply = document.querySelector('#apply-settings');
    if (apply) apply.textContent = 'Apply and close';
    patchRows();
    patchLabels();
  }

  function queuePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(patchUI);
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
    await verifiedPaneCount(4);
    await api.setZoom(0.8).catch(() => {});
    await api.setAudioMode('leader').catch(() => {});
    await original.setPolicy(DEFAULT_POLICY).catch(() => {});
    await original.setFollowing(false).catch(() => {});
    await api.focusPane(0).catch(() => {});
    for (let index = 0; index < 8; index += 1) {
      await api.setPaneLabel(index + 1, defaultPaneName(index)).catch(() => {});
    }
    await api.navigate('relay://welcome').catch(() => {});
    await resync();
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
    installDraftNote();
    document.querySelector('#bookmark-checkmyip')?.addEventListener('click', () => api.navigate('https://myip.wtf'));
    const paneCount = document.querySelector('#setting-pane-count');
    paneCount?.addEventListener('change', () => {
      const summary = document.querySelector('#topology-summary');
      if (summary) summary.textContent = `${paneCount.value} screens selected · waiting for Apply and close`;
    }, true);
    const list = document.querySelector('#topology-list');
    if (list) new MutationObserver(queuePatch).observe(list, { childList: true, subtree: true });
    const labels = document.querySelector('#pane-labels');
    if (labels) new MutationObserver(queuePatch).observe(labels, { childList: true, subtree: true });
    await freshStart();
    queuePatch();
  }, { once: true });
})();

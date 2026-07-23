'use strict';

(() => {
  const api = window.conduit;
  if (!api) return;

  const original = {
    getWorkspace: api.getWorkspace,
    onState: api.onState,
    onHealth: api.onHealth,
    setPaneCount: api.setPaneCount,
    setPolicy: api.setPolicy,
    setFollowing: api.setFollowing,
    pausePane: api.pausePane,
    resyncAll: api.resyncAll,
  };

  let latestState = null;
  let latestHealth = null;
  let latestQuality = null;
  let currentPolicy = { navigation: false, scrolling: false, typing: false, clicks: false };
  let currentFollowing = false;
  let patchQueued = false;
  let lastConfiguration = '';

  function anyPolicy(policy = {}) {
    return Object.values(policy).some(Boolean);
  }

  function normalizeRoute(route) {
    if (!route || typeof route !== 'object') return route;
    const ip = String(route.ip || '').trim();
    if (!route.ok) return route;
    const location = String(route.location || '').trim();
    const missing = !location
      || /^location unavailable$/i.test(location)
      || /^ip swapped\s*·\s*location unavailable$/i.test(location);
    return {
      ...route,
      ip,
      location: missing ? (ip ? `IP address · ${ip}` : 'IP address unavailable') : location,
    };
  }

  function mapState(state) {
    if (!state || typeof state !== 'object') return state;
    return {
      ...state,
      ips: Array.isArray(state.ips) ? state.ips.map(normalizeRoute) : state.ips,
    };
  }

  function configure(extra = {}) {
    const payload = {
      visibleCount: Number(latestState?.screenCount || latestHealth?.visiblePaneCount || 4),
      enabled: currentFollowing && anyPolicy(currentPolicy),
      policy: { ...currentPolicy },
      ...extra,
    };
    const signature = JSON.stringify(payload);
    if (!extra.pause && signature === lastConfiguration) return Promise.resolve(null);
    lastConfiguration = signature;
    return api.configureSyncV25(payload).catch(() => null);
  }

  api.getWorkspace = async () => {
    latestState = mapState(await original.getWorkspace());
    return latestState;
  };

  api.onState = (callback) => original.onState((state) => {
    latestState = mapState(state);
    callback(latestState);
    configure({ visibleCount: Number(latestState?.screenCount || 4) });
    queuePatch();
  });

  api.onHealth = (callback) => original.onHealth((health) => {
    latestHealth = health;
    currentFollowing = Boolean(health?.followingEnabled);
    if (currentFollowing && health?.policy) {
      currentPolicy = { ...currentPolicy, ...health.policy };
    }
    callback(health);
    configure();
    queuePatch();
  });

  api.setPaneCount = async (value) => {
    const result = await original.setPaneCount(value);
    await configure({ visibleCount: Number(value) || 4 });
    return result;
  };

  api.setPolicy = async (policy) => {
    currentPolicy = {
      navigation: policy?.navigation === true,
      scrolling: policy?.scrolling === true,
      typing: policy?.typing === true,
      clicks: policy?.clicks === true,
    };
    const result = await original.setPolicy(currentPolicy);
    lastConfiguration = '';
    await configure();
    if (currentFollowing && anyPolicy(currentPolicy)) await api.resyncFollowersV25().catch(() => {});
    return result;
  };

  api.setFollowing = async (enabled) => {
    currentFollowing = Boolean(enabled) && anyPolicy(currentPolicy);
    lastConfiguration = '';
    await configure({ enabled: currentFollowing });
    const result = await original.setFollowing(currentFollowing);
    if (currentFollowing) await api.resyncFollowersV25().catch(() => {});
    queuePatch();
    return result;
  };

  api.pausePane = async (pane, paused) => {
    const result = await original.pausePane(pane, paused);
    await configure({ pause: { pane: Number(pane), paused: Boolean(paused) } });
    lastConfiguration = '';
    if (!paused && currentFollowing) await api.resyncFollowersV25().catch(() => {});
    return result;
  };

  api.resyncAll = async () => {
    const result = await original.resyncAll();
    await api.resyncFollowersV25().catch(() => {});
    return result;
  };

  function routeForPane(paneNumber) {
    return normalizeRoute(latestState?.ips?.[paneNumber - 1]);
  }

  function ipText(paneNumber) {
    const route = routeForPane(paneNumber);
    if (!route) return 'IP not checked';
    if (route.ok && route.ip) return route.ip;
    if (route.ip && route.ip !== 'Unavailable') return route.ip;
    return 'IP unavailable';
  }

  function locationText(paneNumber) {
    const route = routeForPane(paneNumber);
    if (!route) return 'IP address not checked';
    if (!route.ok) return route.ip && route.ip !== 'Unavailable'
      ? `IP address · ${route.ip}`
      : 'IP address unavailable';
    const location = String(route.location || '').trim();
    if (!location || location === route.ip || /^IP address\s*·/i.test(location)) {
      return route.ip ? `IP address · ${route.ip}` : 'IP address unavailable';
    }
    return route.ip ? `${location} · ${route.ip}` : location;
  }

  function qualityForPane(paneNumber) {
    return latestQuality?.rows?.find((row) => row.paneNumber === paneNumber) || null;
  }

  function soundEnabled(paneNumber) {
    const mode = latestState?.audioMode || 'leader';
    if (mode === 'all') return paneNumber <= Number(latestState?.screenCount || 1);
    if (mode === 'focused') return paneNumber === Number(latestState?.focusedPane || 1);
    return mode === 'leader' && paneNumber === 1;
  }

  function statusText(paneNumber) {
    if (paneNumber === 1) return 'Screen 1 leads';
    const healthRow = latestHealth?.rows?.find((row) => row.paneNumber === paneNumber);
    if (healthRow?.paused) return 'Paused';
    if (!currentFollowing) return 'Independent';
    const row = qualityForPane(paneNumber);
    if (!row) return 'Connecting sync';
    if (row.status === 'Synced') return `Synced ${row.score}%`;
    if (row.status === 'Catching up') return `Catching up ${row.score}%`;
    if (row.status === 'Resyncing') return `Resyncing ${row.score}%`;
    return row.status || 'Reconnecting';
  }

  function paneMeta(paneNumber) {
    const parts = [statusText(paneNumber)];
    if (paneNumber > 1) parts.push(ipText(paneNumber));
    if (soundEnabled(paneNumber)) parts.push('Sound enabled');
    return parts.join(' · ');
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function patchRows() {
    const list = document.querySelector('#topology-list');
    if (!list) return;
    const rows = [...list.querySelectorAll('.pane-row, .pane-card')];
    for (const [index, row] of rows.entries()) {
      const paneNumber = Number(row.dataset.pane || index + 1);
      setText(row.querySelector('.pane-meta'), paneMeta(paneNumber));
      setText(row.querySelector('.pane-route'), locationText(paneNumber));
    }

    const summary = document.querySelector('#topology-summary');
    const followerCount = Math.max(0, Number(latestState?.screenCount || latestHealth?.visiblePaneCount || 1) - 1);
    if (!currentFollowing) {
      setText(summary, `${followerCount} screens independent`);
    } else if (latestQuality) {
      const average = Number.isFinite(latestQuality.average) ? `${latestQuality.average}% average` : 'measuring sync';
      setText(summary, `${latestQuality.syncedFollowers}/${followerCount} synced · ${average}`);
    }
  }

  function patchLabels() {
    const labels = [...document.querySelectorAll('#pane-labels .pane-label')];
    for (const [index, label] of labels.entries()) {
      setText(label.querySelector('span'), paneMeta(index + 1));
    }
  }

  function patchUI() {
    patchQueued = false;
    patchRows();
    patchLabels();
  }

  function queuePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(patchUI);
  }

  api.onSyncQualityV25((quality) => {
    latestQuality = quality;
    queuePatch();
  });

  window.addEventListener('DOMContentLoaded', () => {
    const topology = document.querySelector('#topology-list');
    if (topology) new MutationObserver(queuePatch).observe(topology, { childList: true, subtree: true });
    const labels = document.querySelector('#pane-labels');
    if (labels) new MutationObserver(queuePatch).observe(labels, { childList: true, subtree: true });

    api.getSyncQualityV25().then((quality) => {
      latestQuality = quality;
      queuePatch();
    }).catch(() => {});
  }, { once: true });
})();

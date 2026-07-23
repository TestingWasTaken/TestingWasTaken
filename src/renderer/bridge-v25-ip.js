'use strict';

(() => {
  const api = window.conduit;
  if (!api) return;

  const originalCheckIPs = api.checkIPs;
  const originalOnState = api.onState;
  let latestState = null;
  let fallbackIPs = new Map();
  let patchQueued = false;

  api.onState = (callback) => originalOnState((state) => {
    latestState = state;
    callback(state);
    queuePatch();
  });

  api.checkIPs = async () => {
    const result = await originalCheckIPs();
    const count = Number(latestState?.screenCount || result?.results?.length || 4);
    const fallbacks = await api.checkIPFallbacksV25(count).catch(() => []);
    fallbackIPs = new Map(
      (Array.isArray(fallbacks) ? fallbacks : [])
        .filter((item) => item?.ok && item.ip)
        .map((item) => [Number(item.paneNumber), String(item.ip)]),
    );
    queuePatch();
    return result;
  };

  function routeForPane(paneNumber) {
    return latestState?.ips?.[paneNumber - 1] || null;
  }

  function fallbackForPane(paneNumber) {
    const route = routeForPane(paneNumber);
    const routeIP = String(route?.ip || '').trim();
    if (routeIP && routeIP !== 'Unavailable') return routeIP;
    return fallbackIPs.get(paneNumber) || '';
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function patchRow(row, index) {
    const paneNumber = Number(row.dataset.pane || index + 1);
    const ip = fallbackForPane(paneNumber);
    if (!ip) return;

    const route = routeForPane(paneNumber);
    const location = String(route?.location || '').trim();
    const hasLocation = route?.ok
      && location
      && !/^location unavailable$/i.test(location)
      && !/^ip swapped\s*·\s*location unavailable$/i.test(location)
      && !/^IP address\s*·/i.test(location);

    const routeText = hasLocation ? `${location} · ${ip}` : `IP address · ${ip}`;
    setText(row.querySelector('.pane-route'), routeText);

    const meta = row.querySelector('.pane-meta');
    if (meta) {
      const parts = meta.textContent.split(' · ').filter(Boolean);
      if (paneNumber > 1) {
        if (parts.length >= 2) parts[1] = ip;
        else parts.push(ip);
      }
      setText(meta, parts.join(' · '));
    }
  }

  function patchLabels() {
    const labels = [...document.querySelectorAll('#pane-labels .pane-label')];
    for (const [index, label] of labels.entries()) {
      const paneNumber = index + 1;
      if (paneNumber === 1) continue;
      const ip = fallbackForPane(paneNumber);
      const detail = label.querySelector('span');
      if (!ip || !detail) continue;
      const parts = detail.textContent.split(' · ').filter(Boolean);
      if (parts.length >= 2) parts[1] = ip;
      else parts.push(ip);
      setText(detail, parts.join(' · '));
    }
  }

  function patchUI() {
    patchQueued = false;
    const rows = [...document.querySelectorAll('#topology-list .pane-row, #topology-list .pane-card')];
    rows.forEach(patchRow);
    patchLabels();
  }

  function queuePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(patchUI);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const topology = document.querySelector('#topology-list');
    if (topology) new MutationObserver(queuePatch).observe(topology, { childList: true, subtree: true });
    const labels = document.querySelector('#pane-labels');
    if (labels) new MutationObserver(queuePatch).observe(labels, { childList: true, subtree: true });
  }, { once: true });
})();

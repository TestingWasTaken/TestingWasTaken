'use strict';

(() => {
  const backdrop = document.querySelector('#setup-backdrop');
  const eventStream = document.querySelector('#event-stream');
  const quickCount = document.querySelector('#quick-screen-count');
  const setupCount = document.querySelector('#setup-screen-count');

  let latestState = null;
  let ledgerBusy = false;
  let ledgerScheduled = false;
  let ledgerObserver = null;
  let committingHidden = false;
  let exitInProgress = false;
  let exitTimer = null;
  const geoCache = new Map();
  const geoRequests = new Set();

  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-6);
  }

  function cleanLedgerMessage(value) {
    return String(value || '')
      .replace(/Screen 1 connected to (\d+) followers?/i, 'pane 1 → $1 followers')
      .replace(/Pane 1 connected to (\d+) followers?/i, 'pane 1 → $1 followers')
      .replace(/leader 1\s*·\s*(\d+) followers?/i, 'pane 1 → $1 followers')
      .replace(/(\d+)\/(\d+) addresses\s*·\s*(\d+) unique/i, '$1/$2 exits · $3 unique')
      .replace(/isolated\s*·\s*isolated route verified; hostnames are resolved through tor/i, 'isolated · remote DNS · verified')
      .replace(/isolated route verified; hostnames are resolved through tor/i, 'remote DNS · verified')
      .replace(/ad blocker on/i, 'enabled')
      .replace(/ad blocker off/i, 'disabled · compatibility mode')
      .replace(/pane-link=on/i, 'pane 1 → followers enabled')
      .replace(/pane-link=off/i, 'pane following disabled')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeKind(value) {
    const kind = String(value || '').trim().toUpperCase();
    const map = {
      BOOT: 'SESSION',
      LAYOUT: 'MATRIX',
      ROUTE: 'EGRESS',
      VERIFY: 'EGRESS',
      LINK: 'MIRROR',
      FILTER: 'ADFILTER',
      APPLY: 'COMMIT',
      ERROR: 'FAULT',
    };
    return map[kind] || kind;
  }

  function validIP(value) {
    const ip = String(value || '').trim();
    return ip && ip !== 'Unavailable' && ip !== 'Unknown';
  }

  function geoLabel(ip) {
    const geo = geoCache.get(ip);
    if (!geo) return '';
    return [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
  }

  function requestGeo(ip) {
    if (!validIP(ip) || geoCache.has(ip) || geoRequests.has(ip)) return;
    geoRequests.add(ip);

    fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data || data.success === false) return;
        geoCache.set(ip, {
          city: data.city || '',
          region: data.region_code || data.region || '',
          country: data.country_code || data.country || '',
        });
      })
      .catch(() => {})
      .finally(() => {
        geoRequests.delete(ip);
        scheduleLedgerPass();
      });
  }

  function createEgressRow(screenNumber, result) {
    const row = document.createElement('div');
    row.className = `trace-row conduit-egress-row ${result?.ok === false ? 'warn' : 'success'}`;
    row.dataset.conduitKey = `egress:${screenNumber}:${result?.ip || 'unavailable'}`;

    const token = document.createElement('code');
    token.textContent = `#${stableHash(row.dataset.conduitKey)}`;

    const kind = document.createElement('span');
    kind.className = 'trace-kind';
    kind.textContent = `P${screenNumber}`;

    const message = document.createElement('span');
    message.className = 'trace-message';
    const ip = result?.ip || 'Unavailable';
    const location = validIP(ip) ? geoLabel(ip) : '';
    message.textContent = location ? `${ip} · ${location}` : ip;
    message.title = message.textContent;

    row.append(token, kind, message);
    return row;
  }

  function observeLedger() {
    if (!ledgerObserver || !eventStream) return;
    ledgerObserver.observe(eventStream, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function processLedger() {
    ledgerScheduled = false;
    if (!eventStream || ledgerBusy) return;
    ledgerBusy = true;
    ledgerObserver?.disconnect();

    try {
      eventStream.querySelectorAll('.conduit-egress-row').forEach((row) => row.remove());

      const seen = new Set();
      for (const row of [...eventStream.querySelectorAll('.trace-row')]) {
        const kindElement = row.querySelector('.trace-kind');
        const messageElement = row.querySelector('.trace-message');
        if (!kindElement || !messageElement) continue;

        const rawKind = String(kindElement.textContent || '').trim().toUpperCase();
        if (rawKind === 'REQUEST') {
          row.remove();
          continue;
        }

        const kind = normalizeKind(rawKind);
        const message = cleanLedgerMessage(messageElement.textContent);

        if (kind === 'EGRESS' && /\d+\/\d+ exits/i.test(message) && Array.isArray(latestState?.ips)) {
          row.remove();
          continue;
        }

        const key = `${kind}|${message}`;
        if (seen.has(key)) {
          row.remove();
          continue;
        }
        seen.add(key);

        kindElement.textContent = kind;
        messageElement.textContent = message;
        messageElement.title = message;
      }

      const results = Array.isArray(latestState?.ips) ? latestState.ips : [];
      results.slice(0, Number(latestState?.screenCount || 0)).forEach((result, index) => {
        if (!result) return;
        if (validIP(result.ip)) requestGeo(result.ip);
        eventStream.appendChild(createEgressRow(index + 1, result));
      });

      eventStream.scrollTop = eventStream.scrollHeight;
    } finally {
      ledgerBusy = false;
      observeLedger();
    }
  }

  function scheduleLedgerPass() {
    if (ledgerScheduled) return;
    ledgerScheduled = true;
    requestAnimationFrame(processLedger);
  }

  function playEntrance() {
    if (!backdrop || backdrop.classList.contains('hidden') || exitInProgress) return;
    clearTimeout(exitTimer);
    backdrop.classList.remove('conduit-exiting');
    backdrop.classList.remove('conduit-entering');
    void backdrop.offsetWidth;
    backdrop.classList.add('conduit-entering');
    setTimeout(() => backdrop.classList.remove('conduit-entering'), 760);
  }

  function playExit() {
    if (!backdrop || committingHidden || exitInProgress) return;
    exitInProgress = true;
    clearTimeout(exitTimer);
    backdrop.classList.remove('hidden', 'conduit-entering');
    backdrop.classList.add('conduit-exiting');

    exitTimer = setTimeout(() => {
      committingHidden = true;
      backdrop.classList.add('hidden');
      backdrop.classList.remove('conduit-exiting');
      requestAnimationFrame(() => {
        committingHidden = false;
        exitInProgress = false;
      });
    }, 470);
  }

  function updatePerformanceState() {
    const selected = Math.max(Number(quickCount?.value || 0), Number(setupCount?.value || 0));
    document.documentElement.classList.toggle('conduit-high-load', selected > 4);
  }

  if (eventStream) {
    ledgerObserver = new MutationObserver(scheduleLedgerPass);
    observeLedger();
  }

  if (backdrop) {
    new MutationObserver((mutations) => {
      if (committingHidden || exitInProgress) return;
      const mutation = mutations.at(-1);
      const oldClasses = new Set(String(mutation?.oldValue || '').split(/\s+/).filter(Boolean));
      const wasHidden = oldClasses.has('hidden');
      const isHidden = backdrop.classList.contains('hidden');

      if (!wasHidden && isHidden) playExit();
      else if (wasHidden && !isHidden) playEntrance();
    }).observe(backdrop, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class'],
    });
  }

  quickCount?.addEventListener('change', updatePerformanceState);
  setupCount?.addEventListener('change', updatePerformanceState);

  window.relay.onState((state) => {
    latestState = state;
    updatePerformanceState();
    scheduleLedgerPass();
  });

  playEntrance();
  updatePerformanceState();
  scheduleLedgerPass();
})();
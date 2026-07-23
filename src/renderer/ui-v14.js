'use strict';

(() => {
  const quickControls = document.querySelector('.quick-controls');
  const quickScreenCount = document.querySelector('#quick-screen-count');
  const quickZoom = document.querySelector('#quick-zoom');
  const quickNetwork = document.querySelector('#quick-network');
  const quickSync = document.querySelector('#quick-sync');
  const quickAdBlock = document.querySelector('#quick-adblock');

  const openSettings = document.querySelector('#open-settings');
  const setupBackdrop = document.querySelector('#setup-backdrop');
  const setupLaunch = document.querySelector('#setup-launch');
  const setupCancel = document.querySelector('#setup-cancel');
  const setupError = document.querySelector('#setup-error');
  const setupScreenCount = document.querySelector('#setup-screen-count');
  const setupZoom = document.querySelector('#setup-zoom');
  const setupSync = document.querySelector('#setup-sync');
  const setupAdBlock = document.querySelector('#setup-adblock');
  const setupEyebrow = document.querySelector('#setup-eyebrow');
  const setupTitle = document.querySelector('#setup-title');
  const setupIntro = document.querySelector('#setup-intro');
  const progressTitle = document.querySelector('#progress-title');
  const progressCurrent = document.querySelector('#progress-current');
  const eventStream = document.querySelector('#event-stream');
  const status = document.querySelector('#status');
  const dnsStatus = document.querySelector('#dns-status');
  const statusDot = document.querySelector('#status-dot');

  const quickInputs = [quickScreenCount, quickZoom, quickNetwork, quickSync, quickAdBlock].filter(Boolean);
  const traceEntries = [];
  const progressSignatures = new Set();

  let latestState = null;
  let filterState = { enabled: true, totalBlocked: 0 };
  let quickBusy = false;
  let eventSequence = 0;
  let lastLayoutSignature = '';
  let lastRouteSignature = '';
  let lastSyncSignature = '';
  let lastIPSignature = '';
  let lastErrorSignature = '';
  let lastFilterSignature = '';

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitFor(predicate, timeout = 2000, interval = 25) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await sleep(interval);
    }
    return false;
  }

  function shortHash(seed) {
    let hash = 2166136261;
    const input = `${seed}|${++eventSequence}|${Date.now()}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-6);
  }

  function cleanMessage(value) {
    return String(value || '')
      .replace(/Relay/gi, 'Conduit')
      .replace(/Screen 1 control/gi, 'Pane linking')
      .replace(/Multiple private connections/gi, 'Isolated routes')
      .replace(/Private connections/gi, 'Isolated routes')
      .replace(/Tor route/gi, 'Isolated route')
      .replace(/Tor connected/gi, 'Isolated route active')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function renderTrace() {
    if (!eventStream) return;
    eventStream.replaceChildren();
    const fragment = document.createDocumentFragment();

    for (const entry of traceEntries) {
      const row = document.createElement('div');
      row.className = `trace-row ${entry.level}`;

      const hash = document.createElement('code');
      hash.textContent = `#${entry.hash}`;

      const kind = document.createElement('span');
      kind.className = 'trace-kind';
      kind.textContent = entry.kind;

      const message = document.createElement('span');
      message.className = 'trace-message';
      message.textContent = entry.message;
      message.title = entry.message;

      row.append(hash, kind, message);
      fragment.appendChild(row);
    }

    eventStream.appendChild(fragment);
    eventStream.scrollTop = eventStream.scrollHeight;
  }

  function pushTrace(kind, message, level = 'info', dedupeKey = '') {
    const normalized = cleanMessage(message);
    if (!normalized) return;

    const previous = traceEntries.at(-1);
    const key = dedupeKey || `${kind}:${normalized}`;
    if (previous?.key === key) return;

    traceEntries.push({
      key,
      hash: shortHash(key),
      kind: String(kind || 'EVENT').toUpperCase().slice(0, 8),
      message: normalized,
      level: ['success', 'warn', 'error'].includes(level) ? level : 'info',
    });

    if (traceEntries.length > 9) traceEntries.splice(0, traceEntries.length - 9);
    renderTrace();
  }

  function setQuickBusy(value) {
    quickBusy = Boolean(value);
    quickControls?.classList.toggle('is-busy', quickBusy);
    for (const control of quickInputs) control.disabled = quickBusy;
  }

  function setPressed(button, enabled, onText = 'On', offText = 'Off') {
    if (!button) return;
    button.setAttribute('aria-pressed', String(Boolean(enabled)));
    const value = button.querySelector('strong');
    if (value) value.textContent = enabled ? onText : offText;
  }

  function selectNetwork(value) {
    const radio = document.querySelector(`input[name="setup-network"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function updateQuickControls(state = latestState) {
    if (!state || quickBusy) return;
    quickScreenCount.value = String(state.screenCount || 1);
    quickZoom.value = String(state.zoomFactor || 1);
    quickNetwork.value = state.networkMode === 'tor' ? 'tor' : 'direct';
    setPressed(quickSync, Boolean(state.syncRequested), 'On', 'Off');
    setPressed(quickAdBlock, filterState.enabled !== false, 'On', 'Off');
  }

  async function openConfigurationForQuickChange() {
    if (!setupBackdrop.classList.contains('hidden')) return true;
    openSettings.click();
    return waitFor(() => !setupBackdrop.classList.contains('hidden'), 2500);
  }

  async function applyQuickChange(mutator, traceMessage) {
    if (quickBusy) return;
    setQuickBusy(true);

    try {
      const opened = await openConfigurationForQuickChange();
      if (!opened) throw new Error('Configuration sheet did not open');

      const proceed = await mutator();
      if (proceed === false) {
        if (!setupCancel.hidden) setupCancel.click();
        return;
      }

      pushTrace('REQUEST', traceMessage, 'info');
      setupLaunch.click();

      await waitFor(
        () => setupBackdrop.classList.contains('hidden') || !setupError.hidden,
        45000,
        50,
      );
    } catch (error) {
      pushTrace('ERROR', error?.message || String(error), 'error');
    } finally {
      setQuickBusy(false);
      updateQuickControls();
    }
  }

  function meaningfulStatus(state) {
    if (state.networkBusy) return ['Negotiating routes', 'Applying network changes'];
    if (state.syncRequested) {
      return [
        'Pane 1 linked',
        state.networkMode === 'tor' ? 'Isolated routes · private name resolution' : 'Standard route · followers aligned',
      ];
    }
    return [
      'Workspace online',
      state.networkMode === 'tor' ? 'Isolated routes active' : 'Standard routing',
    ];
  }

  function uniqueIPs(state) {
    const results = Array.isArray(state?.ips) ? state.ips.filter(Boolean) : [];
    const addresses = results.map((entry) => entry?.ip).filter(Boolean);
    return {
      available: addresses.length,
      unique: new Set(addresses).size,
      addresses,
    };
  }

  function recordState(state) {
    const layoutSignature = `${state.screenCount}:${state.zoomFactor}`;
    if (layoutSignature !== lastLayoutSignature) {
      lastLayoutSignature = layoutSignature;
      pushTrace('LAYOUT', `${state.screenCount} pane${state.screenCount === 1 ? '' : 's'} · ${Math.round(state.zoomFactor * 100)}% scale`, 'success', `layout:${layoutSignature}`);
    }

    const routeName = state.networkMode === 'tor' ? 'isolated' : 'standard';
    const routeSignature = `${state.networkMode}:${state.networkBusy}:${state.dnsStatus}`;
    if (routeSignature !== lastRouteSignature) {
      lastRouteSignature = routeSignature;
      const routeMessage = state.networkBusy
        ? `${routeName} · negotiating`
        : `${routeName} · ${cleanMessage(state.dnsStatus || 'route active').toLowerCase()}`;
      pushTrace('ROUTE', routeMessage, state.networkBusy ? 'info' : 'success', `route:${routeSignature}`);
    }

    const followerCount = Math.max(0, Number(state.screenCount || 1) - 1);
    const syncSignature = `${state.syncRequested}:${followerCount}`;
    if (syncSignature !== lastSyncSignature) {
      lastSyncSignature = syncSignature;
      pushTrace(
        'LINK',
        state.syncRequested ? `leader 1 · ${followerCount} follower${followerCount === 1 ? '' : 's'}` : 'disabled',
        state.syncRequested ? 'success' : 'info',
        `sync:${syncSignature}`,
      );
    }

    const ips = uniqueIPs(state);
    const ipSignature = ips.addresses.join('|');
    if (ipSignature && ipSignature !== lastIPSignature) {
      lastIPSignature = ipSignature;
      pushTrace('VERIFY', `${ips.available}/${state.screenCount} addresses · ${ips.unique} unique`, ips.available === state.screenCount ? 'success' : 'warn', `ips:${ipSignature}`);
    }

    const rawStatus = `${state.status || ''} ${state.dnsStatus || ''}`;
    if (/failed|unavailable|error|stopped|could not/i.test(rawStatus)) {
      const errorSignature = cleanMessage(rawStatus);
      if (errorSignature !== lastErrorSignature) {
        lastErrorSignature = errorSignature;
        pushTrace('ERROR', errorSignature.slice(0, 110), 'error', `error:${errorSignature}`);
      }
    }
  }

  async function refreshFilterState({ record = false } = {}) {
    try {
      const result = await window.relay.getAdBlockStatus();
      filterState = {
        enabled: result?.enabled !== false,
        totalBlocked: Number(result?.totalBlocked) || 0,
      };
      setPressed(quickAdBlock, filterState.enabled, 'On', 'Off');

      const signature = `${filterState.enabled}:${filterState.totalBlocked}`;
      if (record && signature !== lastFilterSignature) {
        lastFilterSignature = signature;
        pushTrace(
          'FILTER',
          filterState.enabled ? `enabled · ${filterState.totalBlocked} blocked` : 'disabled · compatibility mode',
          filterState.enabled ? 'success' : 'warn',
          `filter:${signature}`,
        );
      }
    } catch (error) {
      if (record) pushTrace('FILTER', `state unavailable · ${error.message}`, 'warn');
    }
  }

  function normalizeCopy() {
    if (setupEyebrow && setupEyebrow.textContent !== 'Conduit 0.14') setupEyebrow.textContent = 'Conduit 0.14';

    if (setupTitle) {
      setupTitle.textContent = setupTitle.textContent
        .replace(/Workspace settings/i, 'Workspace')
        .replace(/Restarting everything/i, 'Restarting workspace')
        .replace(/Resetting Screen/gi, 'Resetting pane');
    }

    if (setupIntro) {
      setupIntro.textContent = cleanMessage(setupIntro.textContent)
        .replace(/Screen 1 leads the workspace\. Changes are finalized before browser access returns\./i, 'Tune the workspace, routes, filtering, and pane resets.')
        .replace(/screen/gi, 'pane');
    }

    if (progressTitle) {
      progressTitle.textContent = progressTitle.textContent
        .replace(/^Ready$/i, 'Idle')
        .replace(/Relay/gi, 'Conduit')
        .replace(/Screen/gi, 'Pane');
    }

    if (progressCurrent && /^Waiting$/i.test(progressCurrent.textContent.trim())) {
      progressCurrent.textContent = 'No pending changes';
    }

    const labelMap = new Map([
      ['Workspace and protection', 'Layout and filter'],
      ['Connections', 'Route negotiation'],
      ['Connection check', 'Route verification'],
      ['Screen 1 control', 'Pane linking'],
    ]);

    document.querySelectorAll('.progress-step strong').forEach((element) => {
      const replacement = labelMap.get(element.textContent.trim());
      if (replacement) element.textContent = replacement;
    });
  }

  quickScreenCount?.addEventListener('change', () => {
    const next = quickScreenCount.value;
    applyQuickChange(() => {
      setupScreenCount.value = next;
      return true;
    }, `panes=${next}`);
  });

  quickZoom?.addEventListener('change', () => {
    const next = quickZoom.value;
    applyQuickChange(() => {
      setupZoom.value = next;
      return true;
    }, `scale=${Math.round(Number(next) * 100)}%`);
  });

  quickNetwork?.addEventListener('change', () => {
    const next = quickNetwork.value;
    applyQuickChange(() => {
      selectNetwork(next);
      return true;
    }, `route=${next === 'tor' ? 'isolated' : 'standard'}`);
  });

  quickSync?.addEventListener('click', () => {
    const next = !Boolean(latestState?.syncRequested);
    applyQuickChange(() => {
      setupSync.checked = next;
      return true;
    }, `pane-link=${next ? 'on' : 'off'}`);
  });

  quickAdBlock?.addEventListener('click', () => {
    const next = filterState.enabled === false;
    applyQuickChange(() => {
      setupAdBlock.checked = next;
      setupAdBlock.dispatchEvent(new Event('change', { bubbles: true }));
      return setupAdBlock.checked === next;
    }, `filter=${next ? 'on' : 'off'}`);
  });

  window.relay.onState((state) => {
    latestState = state;
    updateQuickControls(state);
    recordState(state);

    const [headline, detail] = meaningfulStatus(state);
    status.textContent = headline;
    dnsStatus.textContent = detail;

    statusDot.className = 'status-dot';
    if (state.networkBusy) statusDot.classList.add('busy');
    else if (state.networkMode === 'tor') statusDot.classList.add('secure');
  });

  window.relay.onOperationProgress((progress) => {
    const state = progress?.state || 'running';
    const step = Number(progress?.step) + 1;
    const message = cleanMessage(progress?.message || 'working');
    const signature = `${step}:${state}:${message}`;
    if (progressSignatures.has(signature)) return;
    progressSignatures.add(signature);

    if (state === 'running') pushTrace('APPLY', `step ${step} · ${message}`, 'info', signature);
    else if (state === 'done') pushTrace('APPLY', `step ${step} committed · ${message}`, 'success', signature);
    else if (state === 'error') pushTrace('APPLY', `step ${step} failed · ${message}`, 'error', signature);
  });

  window.relay.onDiagnostic((entry) => {
    const message = cleanMessage(entry?.message || '');
    if (!message || /^(ready|connected|workspace unlocked)$/i.test(message)) return;

    if (/control on|followers|sync missed|link/i.test(message)) {
      pushTrace('LINK', message, /missed|error|waiting/i.test(message) ? 'warn' : 'success');
      return;
    }

    if (/ad blocker|filter/i.test(message)) {
      pushTrace('FILTER', message, /off|disabled/i.test(message) ? 'warn' : 'success');
      return;
    }

    if (/failed|error|unavailable|could not/i.test(message)) {
      pushTrace('ERROR', message, 'error');
      return;
    }

    if (/route|connect|network|dns/i.test(message)) {
      pushTrace('ROUTE', message, entry?.level === 'warn' ? 'warn' : 'info');
    }
  });

  const copyObserver = new MutationObserver(normalizeCopy);
  if (setupBackdrop) copyObserver.observe(setupBackdrop, { childList: true, subtree: true, characterData: true });

  normalizeCopy();
  pushTrace('BOOT', 'Conduit session initialized', 'success', 'boot');
  refreshFilterState({ record: true });
  setInterval(() => refreshFilterState({ record: true }), 5000);
})();

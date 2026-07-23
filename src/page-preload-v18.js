'use strict';

const { ipcRenderer } = require('electron');

const argument = process.argv.find((value) => value.startsWith('--conduit-pane='))
  || process.argv.find((value) => value.startsWith('--relay-screen='));
const paneNumber = Number(argument?.split('=')[1] || 0);
const isLeader = paneNumber === 1;
const validPane = Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= 8;

let syncPolicy = { navigation: true, clicks: true, typing: true, scrolling: true };
let syncEnabled = false;
let paused = false;
let stateSequence = 0;
let heartbeatSequence = 0;
let lastStateSignature = '';
let stateTimer = null;
let inputTimer = null;
let heartbeatTimer = null;
let scrollFramePending = false;

const PROTECTED = /captcha|recaptcha|hcaptcha|turnstile|security\s*check|checkout|purchase|payment|credit\s*card|debit\s*card|send\s*money|vote|delete\s*account|close\s*account/i;

function send(channel, payload = {}) {
  if (!validPane) return;
  ipcRenderer.send(channel, { paneNumber, ...payload });
}

function challengePresent() {
  return Boolean(document.querySelector([
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '.g-recaptcha',
    '.h-captcha',
    '.cf-turnstile',
    '#challenge-running',
    '#challenge-form',
  ].join(',')));
}

function safeTarget(element) {
  if (!(element instanceof Element)) return false;
  const field = element.closest('input, textarea, select, button, a, label, [role="button"], [contenteditable="true"]') || element;
  const type = String(field.type || '').toLowerCase();
  if (type === 'password' || type === 'file') return false;
  const text = [
    field.innerText,
    type === 'password' ? '' : field.value,
    field.getAttribute?.('aria-label'),
    field.getAttribute?.('href'),
    field.closest?.('form')?.innerText,
    field.closest?.('form')?.getAttribute?.('action'),
  ].filter(Boolean).join(' ');
  return !PROTECTED.test(text);
}

function escapeCSS(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
}

function selectorFor(element) {
  if (!(element instanceof Element)) return '';
  if (element.id) return `#${escapeCSS(element.id)}`;
  for (const attr of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(attr);
    if (value) return `${element.tagName.toLowerCase()}[${attr}="${String(value).replace(/"/g, '\\"')}"]`;
  }
  const parts = [];
  let current = element;
  while (current && current !== document.documentElement && parts.length < 7) {
    const tag = current.tagName.toLowerCase();
    const peers = current.parentElement
      ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName)
      : [];
    parts.unshift(`${tag}:nth-of-type(${Math.max(1, peers.indexOf(current) + 1)})`);
    current = current.parentElement;
  }
  return `html > ${parts.join(' > ')}`;
}

function fingerprint(element) {
  return {
    selector: selectorFor(element),
    tag: String(element?.tagName || '').toLowerCase(),
    type: String(element?.type || '').toLowerCase(),
    name: element?.getAttribute?.('name') || '',
    aria: element?.getAttribute?.('aria-label') || '',
    placeholder: element?.getAttribute?.('placeholder') || '',
    text: String(element?.innerText || element?.value || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    href: element?.href || '',
  };
}

function scrollState() {
  const root = document.scrollingElement || document.documentElement;
  const maxX = Math.max(1, root.scrollWidth - innerWidth);
  const maxY = Math.max(1, root.scrollHeight - innerHeight);
  return {
    scrollXRatio: Math.max(0, Math.min(1, scrollX / maxX)),
    scrollYRatio: Math.max(0, Math.min(1, scrollY / maxY)),
  };
}

function pageState() {
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== 'complete',
    challenge: challengePresent(),
    ...scrollState(),
    sequence: ++stateSequence,
  };
}

function publishState(force = false) {
  if (!validPane) return;
  const state = pageState();
  const signature = `${state.url}|${state.scrollXRatio.toFixed(5)}|${state.scrollYRatio.toFixed(5)}|${state.loading}|${state.challenge}`;
  if (!force && signature === lastStateSignature) return;
  lastStateSignature = signature;
  send('pane-state-v18', { state });
}

function scheduleState(delay = 70, force = false) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => publishState(force), delay);
}

function controlSnapshot() {
  if (challengePresent()) return [];
  const result = [];
  const controls = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
  for (const control of controls) {
    if (result.length >= 80 || !safeTarget(control)) continue;
    const type = String(control.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    result.push({
      ...fingerprint(control),
      value: control.isContentEditable ? String(control.textContent || '').slice(0, 500) : String(control.value ?? '').slice(0, 500),
      checked: Boolean(control.checked),
      selectedIndex: control instanceof HTMLSelectElement ? control.selectedIndex : null,
      contentEditable: Boolean(control.isContentEditable),
    });
  }
  return result;
}

function publishHeartbeat(force = false) {
  if (!isLeader || !syncEnabled || paused || challengePresent()) return;
  if (!force && document.visibilityState === 'hidden') return;
  send('leader-heartbeat-v25', {
    sequence: ++heartbeatSequence,
    state: pageState(),
    controls: (syncPolicy.typing || syncPolicy.clicks) ? controlSnapshot() : [],
  });
}

function scheduleHeartbeat(delay = 50) {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => publishHeartbeat(true), delay);
}

function publishFastScroll() {
  scrollFramePending = false;
  if (!isLeader || paused || !syncEnabled || !syncPolicy.scrolling) return;
  send('leader-scroll-direct-v22', { state: scrollState() });
}

function nativeSet(element, value) {
  if (element.isContentEditable) {
    element.textContent = value;
    return;
  }
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}

function findTarget(action) {
  try {
    const exact = action.selector ? document.querySelector(action.selector) : null;
    if (exact) return exact;
  } catch {}
  const query = action.tag || 'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"]';
  let best = null;
  let score = 0;
  for (const candidate of document.querySelectorAll(query)) {
    let next = 0;
    if (action.type && String(candidate.type || '').toLowerCase() === action.type) next += 4;
    if (action.name && candidate.getAttribute('name') === action.name) next += 10;
    if (action.aria && candidate.getAttribute('aria-label') === action.aria) next += 10;
    if (action.placeholder && candidate.getAttribute('placeholder') === action.placeholder) next += 8;
    if (action.href && candidate.href === action.href) next += 9;
    const text = String(candidate.innerText || candidate.value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (action.text && text === action.text) next += 11;
    if (next > score) { score = next; best = candidate; }
  }
  return score >= 6 ? best : null;
}

function replay(action) {
  if (paused || challengePresent() || !action) return { ok: true, skipped: true };
  const target = findTarget(action);
  if (action.kind === 'scroll-window') {
    window.__conduitScrollTarget = {
      x: Math.max(0, Math.min(1, Number(action.xRatio) || 0)),
      y: Math.max(0, Math.min(1, Number(action.yRatio) || 0)),
      updated: performance.now(),
    };
    return { ok: true };
  }
  if (!target || !safeTarget(target)) return { ok: false, reason: 'target unavailable' };
  if (action.kind === 'input') {
    if (target.type === 'checkbox' || target.type === 'radio') target.checked = Boolean(action.checked);
    else nativeSet(target, String(action.value ?? ''));
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { ok: true };
  }
  if (action.kind === 'click' || action.kind === 'navigate') {
    (target.closest('button, a, label, [role="button"], input, select, textarea') || target).click();
    return { ok: true };
  }
  if (action.kind === 'key') {
    target.focus?.({ preventScroll: true });
    target.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, code: action.code, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: action.key, code: action.code, bubbles: true }));
    return { ok: true };
  }
  return { ok: false, reason: 'unsupported action' };
}

function applyControlSnapshot(controls) {
  let matched = 0;
  let total = 0;
  if (!(syncPolicy.typing || syncPolicy.clicks)) return { matched, total };

  for (const item of Array.isArray(controls) ? controls : []) {
    total += 1;
    const target = findTarget(item);
    if (!target || !safeTarget(target)) continue;
    let changed = false;

    if (target.type === 'checkbox' || target.type === 'radio') {
      if (target.checked !== Boolean(item.checked)) {
        target.checked = Boolean(item.checked);
        changed = true;
      }
    } else if (target instanceof HTMLSelectElement && Number.isInteger(item.selectedIndex)) {
      if (target.selectedIndex !== item.selectedIndex) {
        target.selectedIndex = item.selectedIndex;
        changed = true;
      }
    } else {
      const current = target.isContentEditable ? String(target.textContent || '') : String(target.value ?? '');
      if (current !== String(item.value ?? '')) {
        nativeSet(target, String(item.value ?? ''));
        changed = true;
      }
    }

    if (changed) {
      target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    matched += 1;
  }

  return { matched, total };
}

function runScrollFollower() {
  const target = window.__conduitScrollTarget;
  if (!paused && syncEnabled && syncPolicy.scrolling && target) {
    const root = document.scrollingElement || document.documentElement;
    const maxX = Math.max(0, root.scrollWidth - innerWidth);
    const maxY = Math.max(0, root.scrollHeight - innerHeight);
    const dx = (target.x * maxX) - scrollX;
    const dy = (target.y * maxY) - scrollY;
    const distance = Math.hypot(dx, dy);
    const factor = distance > 800 ? .28 : distance > 220 ? .20 : .14;
    if (distance < .25 && performance.now() - target.updated > 45) scrollTo(target.x * maxX, target.y * maxY);
    else scrollTo(scrollX + (dx * factor), scrollY + (dy * factor));
  }
  requestAnimationFrame(runScrollFollower);
}

function installHistoryHooks() {
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    history[method] = function conduitHistoryHook(...args) {
      const result = original.apply(this, args);
      scheduleState(10, true);
      scheduleHeartbeat(30);
      return result;
    };
  }
}

installHistoryHooks();
send('register-pane-v18');
window.addEventListener('DOMContentLoaded', () => { send('register-pane-v18'); publishState(true); publishHeartbeat(true); }, { once: true });
window.addEventListener('load', () => { publishState(true); publishHeartbeat(true); }, { once: true });
window.addEventListener('popstate', () => { scheduleState(20, true); scheduleHeartbeat(25); });
window.addEventListener('hashchange', () => { scheduleState(20, true); scheduleHeartbeat(25); });
window.addEventListener('scroll', () => {
  if (isLeader && syncEnabled && syncPolicy.scrolling && !scrollFramePending) {
    scrollFramePending = true;
    requestAnimationFrame(publishFastScroll);
  }
  scheduleState(90);
}, { passive: true });

if (isLeader) {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, a, label, [role="button"], input, select, textarea') || event.target
      : null;
    if (!syncEnabled || !safeTarget(target)) return;
    const navigation = Boolean(target.closest?.('a[href]'));
    if (navigation && !syncPolicy.navigation) return;
    if (!navigation && !syncPolicy.clicks) return;
    send('leader-action-v25', { action: { kind: navigation ? 'navigate' : 'click', ...fingerprint(target) } });
    scheduleHeartbeat(navigation ? 120 : 55);
  }, true);

  document.addEventListener('input', (event) => {
    if (!syncEnabled || !syncPolicy.typing || !safeTarget(event.target)) return;
    clearTimeout(inputTimer);
    const target = event.target;
    inputTimer = setTimeout(() => {
      send('leader-action-v25', {
        action: {
          kind: 'input',
          ...fingerprint(target),
          value: target.isContentEditable ? target.textContent : target.value,
          checked: Boolean(target.checked),
        },
      });
      publishHeartbeat(true);
    }, 28);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!syncEnabled || !syncPolicy.typing || !safeTarget(event.target)) return;
    if (event.key === 'Enter') {
      send('leader-action-v25', { action: { kind: 'key', ...fingerprint(event.target), key: event.key, code: event.code } });
      scheduleHeartbeat(70);
    }
  }, true);
}

ipcRenderer.on('request-pane-state-v18', () => publishState(true));
ipcRenderer.on('sync-policy-v18', (_event, nextPolicy) => { syncPolicy = { ...syncPolicy, ...(nextPolicy || {}) }; });
ipcRenderer.on('sync-enabled-v25', (_event, next = {}) => {
  syncEnabled = next.enabled === true;
  syncPolicy = { ...syncPolicy, ...(next.policy || {}) };
  paused = next.paused === true;
  if (!syncEnabled || !syncPolicy.scrolling) window.__conduitScrollTarget = null;
  if (isLeader && syncEnabled) publishHeartbeat(true);
});
ipcRenderer.on('force-leader-heartbeat-v25', () => publishHeartbeat(true));
ipcRenderer.on('pane-paused-v18', (_event, value) => {
  paused = Boolean(value);
  if (paused) window.__conduitScrollTarget = null;
});
ipcRenderer.on('replay-action-v18', (_event, payload) => {
  const result = replay(payload?.action);
  send('replay-result-v18', { actionId: payload?.actionId, result });
});
ipcRenderer.on('leader-scroll-v18', (_event, state) => {
  if (syncEnabled && syncPolicy.scrolling) {
    replay({ kind: 'scroll-window', xRatio: state?.scrollXRatio, yRatio: state?.scrollYRatio });
  }
});
ipcRenderer.on('sync-heartbeat-v25', (_event, heartbeat = {}) => {
  if (isLeader || paused || !syncEnabled || challengePresent()) return;
  syncPolicy = { ...syncPolicy, ...(heartbeat.policy || {}) };
  const controls = applyControlSnapshot(heartbeat.controls);
  const leaderState = heartbeat.state || {};
  if (heartbeat.includeScroll && syncPolicy.scrolling) {
    replay({ kind: 'scroll-window', xRatio: leaderState.scrollXRatio, yRatio: leaderState.scrollYRatio });
  }
  const current = scrollState();
  const scrollDifference = Math.abs(Number(current.scrollYRatio || 0) - Number(leaderState.scrollYRatio || 0));
  send('sync-ack-v25', {
    sequence: heartbeat.sequence,
    urlMatch: !syncPolicy.navigation || location.href === String(leaderState.url || ''),
    scrollDifference,
    controlsMatched: controls.matched,
    controlsTotal: controls.total,
  });
});

requestAnimationFrame(runScrollFollower);
setInterval(() => { send('register-pane-v18'); publishState(); }, 1800);
setInterval(() => publishHeartbeat(), 350);

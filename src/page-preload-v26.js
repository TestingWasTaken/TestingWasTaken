'use strict';

const { ipcRenderer } = require('electron');

const argument = process.argv.find((value) => value.startsWith('--conduit-pane='))
  || process.argv.find((value) => value.startsWith('--relay-screen='));
const paneNumber = Number(argument?.split('=')[1] || 0);
const validPane = Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= 8;
const isLeader = paneNumber === 1;

let following = false;
let paused = false;
let policy = { navigation: false, scrolling: false, typing: false, clicks: false };
let stateSequence = 0;
let snapshotSequence = 0;
let stateTimer = null;
let inputTimer = null;
let scrollFramePending = false;
let scrollTarget = null;
let lastStateSignature = '';

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
  const text = [field.innerText, field.value, field.getAttribute?.('aria-label'), field.getAttribute?.('href')]
    .filter(Boolean).join(' ');
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
    const peers = current.parentElement
      ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName)
      : [];
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${Math.max(1, peers.indexOf(current) + 1)})`);
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
  send('v26-state', { state });
}

function scheduleState(delay = 55, force = false) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => publishState(force), delay);
}

function controlSnapshot() {
  if (challengePresent()) return [];
  const result = [];
  for (const control of document.querySelectorAll('input, textarea, select, [contenteditable="true"]')) {
    if (result.length >= 80 || !safeTarget(control)) continue;
    const type = String(control.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    result.push({
      ...fingerprint(control),
      value: control.isContentEditable
        ? String(control.textContent || '').slice(0, 500)
        : String(control.value ?? '').slice(0, 500),
      checked: Boolean(control.checked),
      selectedIndex: control instanceof HTMLSelectElement ? control.selectedIndex : null,
    });
  }
  return result;
}

function publishSnapshot() {
  if (!isLeader || !following || paused || challengePresent()) return;
  send('v26-leader-snapshot', {
    sequence: ++snapshotSequence,
    state: pageState(),
    controls: (policy.typing || policy.clicks) ? controlSnapshot() : [],
  });
}

function publishFastScroll() {
  scrollFramePending = false;
  if (!isLeader || !following || paused || !policy.scrolling) return;
  send('v26-leader-scroll', { state: scrollState() });
}

function nativeSet(element, value) {
  if (element.isContentEditable) {
    element.textContent = value;
    return;
  }
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}

function findTarget(action) {
  try {
    const exact = action?.selector ? document.querySelector(action.selector) : null;
    if (exact) return exact;
  } catch {}

  const query = action?.tag || 'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"]';
  let best = null;
  let bestScore = 0;
  for (const candidate of document.querySelectorAll(query)) {
    let score = 0;
    if (action?.type && String(candidate.type || '').toLowerCase() === action.type) score += 4;
    if (action?.name && candidate.getAttribute('name') === action.name) score += 10;
    if (action?.aria && candidate.getAttribute('aria-label') === action.aria) score += 10;
    if (action?.placeholder && candidate.getAttribute('placeholder') === action.placeholder) score += 8;
    if (action?.href && candidate.href === action.href) score += 9;
    const text = String(candidate.innerText || candidate.value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (action?.text && text === action.text) score += 11;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= 6 ? best : null;
}

function dispatchValueEvents(target) {
  target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function replayAction(action) {
  if (paused || !following || challengePresent() || !action) return { ok: true, skipped: true };
  const target = findTarget(action);
  if (!target || !safeTarget(target)) return { ok: false, reason: 'target unavailable' };

  if (action.kind === 'input') {
    if (target.type === 'checkbox' || target.type === 'radio') target.checked = Boolean(action.checked);
    else if (target instanceof HTMLSelectElement && Number.isInteger(action.selectedIndex)) target.selectedIndex = action.selectedIndex;
    else nativeSet(target, String(action.value ?? ''));
    dispatchValueEvents(target);
    return { ok: true };
  }

  if (action.kind === 'click') {
    (target.closest('button, label, [role="button"], input, select, textarea') || target).click();
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

function applyControls(controls) {
  let matched = 0;
  let total = 0;
  if (!(policy.typing || policy.clicks)) return { matched, total };

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

    if (changed) dispatchValueEvents(target);
    matched += 1;
  }

  return { matched, total };
}

function setScrollTarget(state) {
  scrollTarget = {
    x: Math.max(0, Math.min(1, Number(state?.scrollXRatio) || 0)),
    y: Math.max(0, Math.min(1, Number(state?.scrollYRatio) || 0)),
    updated: performance.now(),
  };
}

function runScrollFollower() {
  if (!paused && following && policy.scrolling && scrollTarget) {
    const root = document.scrollingElement || document.documentElement;
    const maxX = Math.max(0, root.scrollWidth - innerWidth);
    const maxY = Math.max(0, root.scrollHeight - innerHeight);
    const targetX = scrollTarget.x * maxX;
    const targetY = scrollTarget.y * maxY;
    const dx = targetX - scrollX;
    const dy = targetY - scrollY;
    const distance = Math.hypot(dx, dy);
    const factor = distance > 700 ? .38 : distance > 180 ? .30 : .22;
    if (distance < .3 && performance.now() - scrollTarget.updated > 40) scrollTo(targetX, targetY);
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
      if (isLeader && following) setTimeout(publishSnapshot, 20);
      return result;
    };
  }
}

installHistoryHooks();
send('v26-register');
window.addEventListener('DOMContentLoaded', () => {
  send('v26-register');
  publishState(true);
  if (isLeader) publishSnapshot();
}, { once: true });
window.addEventListener('load', () => {
  publishState(true);
  if (isLeader) publishSnapshot();
}, { once: true });
window.addEventListener('popstate', () => {
  scheduleState(10, true);
  if (isLeader && following) setTimeout(publishSnapshot, 20);
});
window.addEventListener('hashchange', () => {
  scheduleState(10, true);
  if (isLeader && following) setTimeout(publishSnapshot, 20);
});
window.addEventListener('scroll', () => {
  if (isLeader && following && policy.scrolling && !scrollFramePending) {
    scrollFramePending = true;
    requestAnimationFrame(publishFastScroll);
  }
  scheduleState(70);
}, { passive: true });

if (isLeader) {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, a, label, [role="button"], input, select, textarea') || event.target
      : null;
    if (!following || !safeTarget(target)) return;
    const navigation = Boolean(target.closest?.('a[href]'));
    if (navigation && !policy.navigation) return;
    if (!navigation && !policy.clicks) return;
    send('v26-leader-action', {
      action: { kind: navigation ? 'navigate' : 'click', ...fingerprint(target) },
    });
    setTimeout(publishSnapshot, navigation ? 100 : 35);
  }, true);

  document.addEventListener('input', (event) => {
    if (!following || !policy.typing || !safeTarget(event.target)) return;
    clearTimeout(inputTimer);
    const target = event.target;
    inputTimer = setTimeout(() => {
      send('v26-leader-action', {
        action: {
          kind: 'input',
          ...fingerprint(target),
          value: target.isContentEditable ? target.textContent : target.value,
          checked: Boolean(target.checked),
          selectedIndex: target instanceof HTMLSelectElement ? target.selectedIndex : null,
        },
      });
      publishSnapshot();
    }, 20);
  }, true);

  document.addEventListener('change', (event) => {
    if (!following || !policy.typing || !safeTarget(event.target)) return;
    const target = event.target;
    send('v26-leader-action', {
      action: {
        kind: 'input',
        ...fingerprint(target),
        value: target.isContentEditable ? target.textContent : target.value,
        checked: Boolean(target.checked),
        selectedIndex: target instanceof HTMLSelectElement ? target.selectedIndex : null,
      },
    });
    setTimeout(publishSnapshot, 20);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!following || !policy.typing || event.key !== 'Enter' || !safeTarget(event.target)) return;
    send('v26-leader-action', {
      action: { kind: 'key', ...fingerprint(event.target), key: event.key, code: event.code },
    });
    setTimeout(publishSnapshot, 50);
  }, true);
}

ipcRenderer.on('v26-config', (_event, next = {}) => {
  following = next.following === true;
  paused = next.paused === true;
  policy = {
    navigation: next.policy?.navigation === true,
    scrolling: next.policy?.scrolling === true,
    typing: next.policy?.typing === true,
    clicks: next.policy?.clicks === true,
  };
  if (!following || paused || !policy.scrolling) scrollTarget = null;
  if (isLeader && following) publishSnapshot();
});

ipcRenderer.on('v26-request-state', () => publishState(true));
ipcRenderer.on('v26-request-snapshot', () => {
  publishState(true);
  if (isLeader) publishSnapshot();
});
ipcRenderer.on('v26-clear-scroll', () => { scrollTarget = null; });
ipcRenderer.on('v26-apply-scroll', (_event, state) => {
  if (!isLeader && following && !paused && policy.scrolling) setScrollTarget(state);
});
ipcRenderer.on('v26-apply-action', (_event, payload) => {
  const result = replayAction(payload?.action);
  send('v26-action-result', { actionId: payload?.actionId, result });
});
ipcRenderer.on('v26-apply-snapshot', (_event, snapshot = {}) => {
  if (isLeader || !following || paused || challengePresent()) return;
  policy = {
    navigation: snapshot.policy?.navigation === true,
    scrolling: snapshot.policy?.scrolling === true,
    typing: snapshot.policy?.typing === true,
    clicks: snapshot.policy?.clicks === true,
  };
  const controls = applyControls(snapshot.controls);
  if (policy.scrolling) setScrollTarget(snapshot.state);
  const current = scrollState();
  send('v26-ack', {
    sequence: snapshot.sequence,
    urlMatch: !policy.navigation || location.href === String(snapshot.state?.url || ''),
    scrollDifference: Math.abs(Number(current.scrollYRatio || 0) - Number(snapshot.state?.scrollYRatio || 0)),
    controlsMatched: controls.matched,
    controlsTotal: controls.total,
  });
});

requestAnimationFrame(runScrollFollower);
setInterval(() => {
  send('v26-register');
  publishState();
}, 1500);
setInterval(() => {
  if (isLeader) publishSnapshot();
}, 500);

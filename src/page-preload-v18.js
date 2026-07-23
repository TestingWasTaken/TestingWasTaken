'use strict';

const { ipcRenderer } = require('electron');

const argument = process.argv.find((value) => value.startsWith('--conduit-pane='))
  || process.argv.find((value) => value.startsWith('--relay-screen='));
const paneNumber = Number(argument?.split('=')[1] || 0);
const isLeader = paneNumber === 1;
const validPane = Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= 8;

let syncPolicy = { navigation: true, clicks: true, typing: true, scrolling: true };
let paused = false;
let stateSequence = 0;
let lastStateSignature = '';
let stateTimer = null;
let inputTimer = null;

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
  const field = element.closest(
    'input, textarea, select, button, a, label, [role="button"], [contenteditable="true"]',
  ) || element;
  const type = String(field.type || '').toLowerCase();
  if (type === 'password' || type === 'file') return false;
  const text = [
    field.innerText,
    field.value,
    field.getAttribute?.('aria-label'),
    field.getAttribute?.('href'),
  ].filter(Boolean).join(' ');
  return !PROTECTED.test(text);
}

function escapeCSS(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(
    /[^a-zA-Z0-9_-]/g,
    (char) => `\\${char.codePointAt(0).toString(16)} `,
  );
}

function selectorFor(element) {
  if (!(element instanceof Element)) return '';
  if (element.id) return `#${escapeCSS(element.id)}`;

  for (const attr of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(attr);
    if (value) {
      return `${element.tagName.toLowerCase()}[${attr}="${String(value).replace(/"/g, '\\"')}"]`;
    }
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
    text: String(element?.innerText || element?.value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 120),
    href: element?.href || '',
  };
}

function pageState() {
  const root = document.scrollingElement || document.documentElement;
  const maxX = Math.max(1, root.scrollWidth - innerWidth);
  const maxY = Math.max(1, root.scrollHeight - innerHeight);
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== 'complete',
    challenge: challengePresent(),
    scrollXRatio: Math.max(0, Math.min(1, scrollX / maxX)),
    scrollYRatio: Math.max(0, Math.min(1, scrollY / maxY)),
    sequence: ++stateSequence,
  };
}

function publishState(force = false) {
  if (!validPane) return;
  const state = pageState();
  const signature = [
    state.url,
    state.scrollXRatio.toFixed(5),
    state.scrollYRatio.toFixed(5),
    state.loading,
    state.challenge,
  ].join('|');

  if (!force && signature === lastStateSignature) return;
  lastStateSignature = signature;
  send('pane-state-v18', { state });
}

function scheduleState(delay = 55, force = false) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => publishState(force), delay);
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

  const query = action.tag
    || 'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"]';
  let best = null;
  let score = 0;

  for (const candidate of document.querySelectorAll(query)) {
    let next = 0;
    if (action.type && String(candidate.type || '').toLowerCase() === action.type) next += 4;
    if (action.name && candidate.getAttribute('name') === action.name) next += 10;
    if (action.aria && candidate.getAttribute('aria-label') === action.aria) next += 10;
    if (action.placeholder && candidate.getAttribute('placeholder') === action.placeholder) next += 8;
    if (action.href && candidate.href === action.href) next += 9;
    const text = String(candidate.innerText || candidate.value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 120);
    if (action.text && text === action.text) next += 11;
    if (next > score) {
      score = next;
      best = candidate;
    }
  }

  return score >= 6 ? best : null;
}

function replay(action) {
  if (paused || challengePresent() || !action) return { ok: true, skipped: true };

  if (action.kind === 'scroll-window') {
    window.__conduitScrollTarget = {
      x: Math.max(0, Math.min(1, Number(action.xRatio) || 0)),
      y: Math.max(0, Math.min(1, Number(action.yRatio) || 0)),
      updated: performance.now(),
    };
    return { ok: true };
  }

  const target = findTarget(action);
  if (!target || !safeTarget(target)) return { ok: false, reason: 'target unavailable' };

  if (action.kind === 'input') {
    if (target.type === 'checkbox' || target.type === 'radio') {
      target.checked = Boolean(action.checked);
    } else {
      nativeSet(target, String(action.value ?? ''));
    }
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
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: action.key,
      code: action.code,
      bubbles: true,
    }));
    target.dispatchEvent(new KeyboardEvent('keyup', {
      key: action.key,
      code: action.code,
      bubbles: true,
    }));
    return { ok: true };
  }

  return { ok: false, reason: 'unsupported action' };
}

function runScrollFollower() {
  const target = window.__conduitScrollTarget;
  if (!paused && target) {
    const root = document.scrollingElement || document.documentElement;
    const maxX = Math.max(0, root.scrollWidth - innerWidth);
    const maxY = Math.max(0, root.scrollHeight - innerHeight);
    const targetX = target.x * maxX;
    const targetY = target.y * maxY;
    const dx = targetX - scrollX;
    const dy = targetY - scrollY;
    const distance = Math.hypot(dx, dy);

    const factor = distance > 900 ? .20 : distance > 260 ? .145 : distance > 40 ? .105 : .075;
    if (distance < .2 && performance.now() - target.updated > 100) {
      scrollTo(targetX, targetY);
    } else {
      scrollTo(scrollX + (dx * factor), scrollY + (dy * factor));
    }
  }
  requestAnimationFrame(runScrollFollower);
}

function installHistoryHooks() {
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    history[method] = function conduitHistoryHook(...args) {
      const result = original.apply(this, args);
      scheduleState(15, true);
      return result;
    };
  }
}

function registerBurst() {
  for (const delay of [0, 100, 320, 760, 1400]) {
    setTimeout(() => {
      send('register-pane-v18');
      publishState(true);
    }, delay);
  }
}

installHistoryHooks();
registerBurst();

window.addEventListener('DOMContentLoaded', registerBurst, { once: true });
window.addEventListener('load', () => publishState(true), { once: true });
window.addEventListener('pageshow', registerBurst);
window.addEventListener('popstate', () => scheduleState(25, true));
window.addEventListener('hashchange', () => scheduleState(25, true));
window.addEventListener('scroll', () => {
  if (isLeader && syncPolicy.scrolling) scheduleState(24);
}, { passive: true });

if (isLeader) {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest(
        'button, a, label, [role="button"], input, select, textarea',
      ) || event.target
      : null;
    if (!safeTarget(target)) return;
    const navigation = Boolean(target.closest?.('a[href]'));
    if (navigation && !syncPolicy.navigation) return;
    if (!navigation && !syncPolicy.clicks) return;
    send('leader-action-v18', {
      action: {
        kind: navigation ? 'navigate' : 'click',
        ...fingerprint(target),
      },
    });
  }, true);

  document.addEventListener('input', (event) => {
    if (!syncPolicy.typing || !safeTarget(event.target)) return;
    clearTimeout(inputTimer);
    const target = event.target;
    inputTimer = setTimeout(() => {
      send('leader-action-v18', {
        action: {
          kind: 'input',
          ...fingerprint(target),
          value: target.isContentEditable ? target.textContent : target.value,
          checked: Boolean(target.checked),
        },
      });
    }, 45);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!syncPolicy.typing || !safeTarget(event.target)) return;
    if (event.key === 'Enter') {
      send('leader-action-v18', {
        action: {
          kind: 'key',
          ...fingerprint(event.target),
          key: event.key,
          code: event.code,
        },
      });
    }
  }, true);
}

ipcRenderer.on('request-pane-state-v18', () => {
  send('register-pane-v18');
  publishState(true);
});

ipcRenderer.on('sync-policy-v18', (_event, nextPolicy) => {
  syncPolicy = { ...syncPolicy, ...(nextPolicy || {}) };
});

ipcRenderer.on('pane-paused-v18', (_event, value) => {
  paused = Boolean(value);
});

ipcRenderer.on('replay-action-v18', (_event, payload) => {
  const result = replay(payload?.action);
  send('replay-result-v18', { actionId: payload?.actionId, result });
});

ipcRenderer.on('leader-scroll-v18', (_event, state) => {
  replay({
    kind: 'scroll-window',
    xRatio: state?.scrollXRatio,
    yRatio: state?.scrollYRatio,
  });
});

requestAnimationFrame(runScrollFollower);
setInterval(() => {
  send('register-pane-v18');
  publishState();
}, 2500);

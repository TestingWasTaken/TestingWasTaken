'use strict';

require('./page-preload-v27');

const { ipcRenderer } = require('electron');

const argument = process.argv.find((value) => value.startsWith('--conduit-pane='))
  || process.argv.find((value) => value.startsWith('--relay-screen='));
const paneNumber = Number(argument?.split('=')[1] || 0);
const validPane = Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= 8;
const CHALLENGE_TEXT = /captcha|recaptcha|hcaptcha|turnstile|just a moment|verify (you are|that you are) human|security check|checking your browser|access denied/i;
const CHALLENGE_URL = /challenges\.cloudflare\.com|\/challenge(?:\/|\?|$)|\/captcha(?:\/|\?|$)|\/verify(?:\/|\?|$)/i;

let lastChallenge = null;
let lastPublishAt = 0;

function challengePresentV28() {
  if (document.querySelector([
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '.g-recaptcha',
    '.h-captcha',
    '.cf-turnstile',
    '#challenge-running',
    '#challenge-form',
    '[data-sitekey]',
  ].join(','))) return true;

  const urlText = `${location.hostname}${location.pathname}${location.search}`;
  if (CHALLENGE_URL.test(urlText)) return true;

  const visibleText = `${document.title || ''} ${document.body?.innerText?.slice(0, 900) || ''}`;
  return CHALLENGE_TEXT.test(visibleText);
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

function publishChallengeState(force = false) {
  if (!validPane) return;
  const challenge = challengePresentV28();
  const now = Date.now();
  if (!force && challenge === lastChallenge && (!challenge || now - lastPublishAt < 700)) return;
  lastChallenge = challenge;
  lastPublishAt = now;
  ipcRenderer.send('v26-state', {
    paneNumber,
    state: {
      url: location.href,
      title: document.title,
      loading: document.readyState !== 'complete',
      challenge,
      ...scrollState(),
    },
  });
}

window.addEventListener('DOMContentLoaded', () => publishChallengeState(true), { once: true });
window.addEventListener('load', () => publishChallengeState(true), { once: true });
window.addEventListener('popstate', () => publishChallengeState(true));
window.addEventListener('hashchange', () => publishChallengeState(true));

const observer = new MutationObserver(() => publishChallengeState());
if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

const timer = setInterval(() => publishChallengeState(), 350);
window.addEventListener('pagehide', () => {
  clearInterval(timer);
  observer.disconnect();
}, { once: true });

'use strict';

const { ipcMain } = require('electron');
const sync = require('./main-v26-sync');

const MAX_PANES = 8;
const panes = new Map();
const recovery = new Map();
const destroyHooks = new Set();
const CHALLENGE = /captcha|recaptcha|hcaptcha|turnstile|challenge-platform|challenges\.cloudflare|just a moment|verify (you are|that you are) human|security check|checking your browser|access denied|\/challenge(?:\/|\?|$)|\/captcha(?:\/|\?|$)/i;

const live = (contents) => Boolean(contents && !contents.isDestroyed());

function paneNumberFrom(payload) {
  const pane = Number(payload?.paneNumber);
  return Number.isInteger(pane) && pane >= 1 && pane <= MAX_PANES ? pane : 0;
}

function rememberPane(event, payload) {
  const pane = paneNumberFrom(payload);
  if (!pane) return;
  panes.set(pane, event.sender);
  if (destroyHooks.has(event.sender.id)) return;
  destroyHooks.add(event.sender.id);
  event.sender.once('destroyed', () => {
    destroyHooks.delete(event.sender.id);
    if (panes.get(pane)?.id === event.sender.id) panes.delete(pane);
    recovery.delete(pane);
  });
}

function validTarget(value) {
  const url = sync.normalizedURL(value);
  return /^(https?:|file:|relay:)/i.test(url) ? url : '';
}

function challengeLike(row, contents) {
  if (row?.challenge) return true;
  const text = [row?.title, row?.url, live(contents) ? contents.getURL() : ''].filter(Boolean).join(' ');
  return CHALLENGE.test(text);
}

function sendRecovery(pane, value) {
  const contents = panes.get(pane);
  if (live(contents)) contents.send('v27-recovery', value);
}

function clearRecovery(pane) {
  if (!recovery.has(pane)) return;
  recovery.delete(pane);
  sendRecovery(pane, { active: false });
}

function clearAllRecovery() {
  for (let pane = 2; pane <= MAX_PANES; pane += 1) clearRecovery(pane);
}

function recoveryMessage(contents, item, score) {
  if (item.mode === 'domain') return 'Opening the main domain before matching the exact page…';
  if (contents.isLoading()) return 'Waiting for the page to finish loading…';
  if (item.mode === 'state' && Number.isFinite(score)) return `Repairing page state · ${score}% synchronized`;
  if (item.attempts === 0) return 'Checking the page against Screen 1…';
  return `Reconnecting to Screen 1 · attempt ${item.attempts}`;
}

function checkFollowers() {
  const health = sync.healthSnapshot();
  const leader = health?.rows?.[0];
  const followingEnabled = health?.followingEnabled === true;
  const navigationEnabled = followingEnabled && health?.policy?.navigation === true;
  const leaderContents = panes.get(1);

  if (!followingEnabled || challengeLike(leader, leaderContents)) {
    clearAllRecovery();
    return;
  }

  const targetURL = navigationEnabled ? validTarget(leader?.url) : '';
  const targetSite = targetURL ? sync.siteKey(targetURL) : '';
  const domainURL = targetURL ? sync.mainDomainURL(targetURL) : '';
  const now = Date.now();
  const navigationJobs = [];
  let requestStateRepair = false;

  for (let pane = 2; pane <= Number(health.visiblePaneCount || 1); pane += 1) {
    const row = health.rows?.find((item) => item.paneNumber === pane);
    const contents = panes.get(pane);

    if (!row?.registered || row.paused || !live(contents)) {
      clearRecovery(pane);
      continue;
    }

    if (challengeLike(row, contents)) {
      clearRecovery(pane);
      continue;
    }

    const actualURL = sync.normalizedURL(contents.getURL());
    const actualSite = sync.siteKey(actualURL);
    const score = Number(row.syncScore);
    const stateBehind = Number.isFinite(score) && score < 65;
    const domainBehind = Boolean(targetSite) && actualSite !== targetSite;
    const urlBehind = Boolean(targetURL) && !domainBehind && actualURL !== targetURL;

    if (!domainBehind && !urlBehind && !stateBehind) {
      clearRecovery(pane);
      continue;
    }

    const mode = domainBehind ? 'domain' : urlBehind ? 'url' : 'state';
    const desiredURL = mode === 'domain' ? domainURL : mode === 'url' ? targetURL : '';
    const key = `${mode}:${desiredURL || actualURL}`;
    let item = recovery.get(pane);

    if (!item || item.key !== key) {
      item = {
        key,
        mode,
        desiredURL,
        since: now,
        attempts: 0,
        lastAttemptAt: 0,
        nextAttemptAt: now + (mode === 'state' ? 1000 : 650),
      };
      recovery.set(pane, item);
    }

    const elapsed = now - item.since;
    const displayDelay = mode === 'state' ? 850 : 450;
    if (elapsed >= displayDelay) {
      sendRecovery(pane, {
        active: true,
        title: mode === 'domain' ? 'Opening site' : mode === 'url' ? 'Catching up' : 'Synchronizing',
        message: recoveryMessage(contents, item, score),
        attempt: item.attempts,
      });
    }

    if (elapsed < displayDelay || now < item.nextAttemptAt) continue;
    if (contents.isLoading() && now - item.lastAttemptAt < 2600) continue;

    item.attempts += 1;
    item.lastAttemptAt = now;
    item.nextAttemptAt = now + Math.min(5200, 900 + (item.attempts * 700));

    if (desiredURL) {
      sendRecovery(pane, {
        active: true,
        title: mode === 'domain' ? 'Opening site' : 'Synchronizing',
        message: mode === 'domain'
          ? `Opening the main domain · attempt ${item.attempts}`
          : `Opening the Screen 1 address · attempt ${item.attempts}`,
        attempt: item.attempts,
      });
      navigationJobs.push({ pane, contents, url: desiredURL });
    } else {
      requestStateRepair = true;
      sendRecovery(pane, {
        active: true,
        title: 'Synchronizing',
        message: `Reapplying Screen 1 state · attempt ${item.attempts}`,
        attempt: item.attempts,
      });
    }
  }

  if (navigationJobs.length) {
    setTimeout(() => {
      for (const { pane, contents, url } of navigationJobs) {
        const row = sync.healthSnapshot().rows?.find((item) => item.paneNumber === pane);
        if (!live(contents) || challengeLike(row, contents)) continue;
        try {
          if (contents.isLoading()) contents.stop();
          contents.loadURL(url).catch(() => {});
        } catch {}
      }
    }, 18);
    requestStateRepair = true;
  }

  if (requestStateRepair) {
    setTimeout(() => {
      try { sync.fullResync(); } catch {}
    }, 190);
  }
}

ipcMain.on('v26-register', rememberPane);
ipcMain.on('v26-state', rememberPane);

const watchdog = setInterval(checkFollowers, 450);
watchdog.unref?.();

module.exports = { checkFollowers, challengeLike };

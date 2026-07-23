'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('one coordinator owns every Follow Screen 1 state change', () => {
  const main = read('src/main-v26-sync.js');
  assert.match(main, /ipcMain\.handle\('v18-set-following'/);
  assert.match(main, /ipcMain\.handle\('v18-set-policy'/);
  assert.match(main, /ipcMain\.handle\('v18-set-pane-paused'/);
  assert.match(main, /ipcMain\.handle\('v26-resync-all'/);
  assert.match(main, /sendConfigurationToAll/);
  assert.match(main, /fullResync/);
  assert.doesNotMatch(main, /v22-|v24-|v25-configure-sync|leader-heartbeat-v25/);
});

test('new sites warm the main domain before the exact subdomain or path', () => {
  const main = read('src/main-v26-sync.js');
  assert.match(main, /function registrableHost/);
  assert.match(main, /function siteKey/);
  assert.match(main, /function mainDomainURL/);
  assert.match(main, /stagedTargets\.set/);
  assert.match(main, /queueNavigation\(warmup/);
  assert.match(main, /flushStagedTargets/);
  assert.match(main, /setTimeout\(\(\) => \{/);
});

test('challenge pages are never propagated or replayed', () => {
  const main = read('src/main-v26-sync.js');
  const preload = read('src/page-preload-v28.js');
  assert.match(main, /state\?\.challenge/);
  assert.match(main, /leaderSnapshot\.state\?\.challenge/);
  assert.match(main, /states\.get\(1\)\?\.challenge/);
  assert.match(preload, /CHALLENGE_TEXT/);
  assert.match(preload, /CHALLENGE_URL/);
  assert.match(preload, /challenges\.cloudflare/);
  assert.match(preload, /v26-state/);
});

test('navigation, scrolling, controls, and health still use one v26 contract', () => {
  const main = read('src/main-v26-sync.js');
  const preload = read('src/page-preload-v26.js');
  for (const channel of [
    'v26-state',
    'v26-leader-scroll',
    'v26-leader-action',
    'v26-leader-snapshot',
    'v26-ack',
  ]) {
    assert.match(main, new RegExp(channel));
    assert.match(preload, new RegExp(channel));
  }
  assert.match(preload, /requestAnimationFrame\(publishFastScroll\)/);
});

test('disabling Following or Scrolling releases follower scroll targets', () => {
  const main = read('src/main-v26-sync.js');
  const preload = read('src/page-preload-v26.js');
  assert.match(main, /clearFollowerScrollTargets/);
  assert.match(main, /if \(!policy\.scrolling\) clearFollowerScrollTargets\(\)/);
  assert.match(preload, /if \(!following \|\| paused \|\| !policy\.scrolling\) scrollTarget = null/);
  assert.match(preload, /v26-clear-scroll/);
});

test('safe control repair excludes protected fields and actions', () => {
  const preload = read('src/page-preload-v26.js');
  assert.match(preload, /type === 'password' \|\| type === 'file'/);
  assert.match(preload, /captcha\|recaptcha\|hcaptcha/);
  assert.match(preload, /checkout\|purchase\|payment/);
  assert.match(preload, /delete\\s\*account/);
});

test('watchdog compares domains first and suspends retries on challenges', () => {
  const watchdog = read('src/main-v27-watchdog.js');
  assert.match(watchdog, /setInterval\(checkFollowers, 450\)/);
  assert.match(watchdog, /challengeLike/);
  assert.match(watchdog, /domainBehind/);
  assert.match(watchdog, /urlBehind/);
  assert.match(watchdog, /mainDomainURL/);
  assert.match(watchdog, /navigationJobs/);
  assert.match(watchdog, /v27-recovery/);
});

test('recovery overlay remains available for genuine lag', () => {
  const preload = read('src/page-preload-v27.js');
  assert.match(preload, /conduit-recovery-v27/);
  assert.match(preload, /Catching up/);
  assert.match(preload, /v27-recovery/);
  assert.match(preload, /pointer-events: auto/);
});

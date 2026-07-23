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

test('navigation, scrolling, controls, and health use one v26 contract', () => {
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
  assert.match(preload, /setInterval\(\(\) => \{\n  if \(isLeader\) publishSnapshot\(\);\n\}, 500\)/);
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

test('legacy renderer wrappers do not own synchronization', () => {
  const v25 = read('src/renderer/bridge-v25.js');
  const ip = read('src/renderer/bridge-v25-ip.js');
  assert.doesNotMatch(v25, /configureSyncV25|resyncFollowersV25|onSyncQualityV25/);
  assert.doesNotMatch(ip, /checkIPs = async|MutationObserver/);
});

test('URL watchdog compares followers continuously and retries drift', () => {
  const watchdog = read('src/main-v27-watchdog.js');
  assert.match(watchdog, /setInterval\(checkFollowers, 450\)/);
  assert.match(watchdog, /contents\.getURL\(\)/);
  assert.match(watchdog, /actualURL === targetURL/);
  assert.match(watchdog, /contents\.loadURL\(targetURL\)/);
  assert.match(watchdog, /sync\.fullResync\(\)/);
  assert.match(watchdog, /v27-recovery/);
});

test('recovery preload shows a blocking catch-up screen', () => {
  const preload = read('src/page-preload-v27.js');
  assert.match(preload, /conduit-recovery-v27/);
  assert.match(preload, /Catching up/);
  assert.match(preload, /v27-recovery/);
  assert.match(preload, /pointer-events: auto/);
});

test('Select All works in page controls and through the native Edit menu', () => {
  const preload = read('src/page-preload-v27.js');
  const shell = read('src/main-v26-shell.js');
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(preload, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(preload, /setSelectionRange/);
  assert.match(shell, /role: 'selectAll'/);
  assert.match(bridge, /address\.select\(\)/);
});

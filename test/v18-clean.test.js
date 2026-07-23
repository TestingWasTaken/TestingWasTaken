'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.25 through the heartbeat entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v25.js');
  assert.equal(pkg.version, '0.25.0');
  assert.match(pkg.scripts.check, /main-v25-sync\.js/);
  assert.match(pkg.scripts.check, /bridge-v25\.js/);
});

test('each launch still removes saved workspace preferences', () => {
  const source = read('src/fresh-start-v23.js');
  assert.match(source, /workspace-v21\.json/);
  assert.match(source, /fs\.rmSync/);
});

test('workspace keeps the four-screen default and lazy extra-screen creation', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /let screenCount = 4/);
  assert.match(source, /ensureViews\(4\)/);
  assert.match(source, /async function setPaneCount/);
  assert.match(source, /ensureViews\(next\)/);
});

test('Settings screen count remains a draft until Apply and close', () => {
  const bridge = read('src/renderer/bridge-v24.js');
  const listenerStart = bridge.indexOf("paneCount?.addEventListener('change'");
  const listenerEnd = bridge.indexOf('}, true);', listenerStart);
  const listener = bridge.slice(listenerStart, listenerEnd);
  assert.ok(listenerStart >= 0);
  assert.match(listener, /waiting for Apply and close/);
  assert.doesNotMatch(listener, /setPaneCount|verifiedPaneCount/);
});

test('heartbeat coordinator repairs followers and measures quality', () => {
  const main = read('src/main-v25-sync.js');
  assert.match(main, /leader-heartbeat-v25/);
  assert.match(main, /sync-heartbeat-v25/);
  assert.match(main, /sync-ack-v25/);
  assert.match(main, /v25-resync-followers/);
  assert.match(main, /function syncScore/);
  assert.match(main, /syncedFollowers/);
});

test('page preload publishes regular heartbeats and safe control snapshots', () => {
  const preload = read('src/page-preload-v18.js');
  assert.match(preload, /function controlSnapshot/);
  assert.match(preload, /leader-heartbeat-v25/);
  assert.match(preload, /setInterval\(\(\) => publishHeartbeat\(\), 350\)/);
  assert.match(preload, /leader-action-v25/);
  assert.match(preload, /sync-heartbeat-v25/);
  assert.match(preload, /sync-ack-v25/);
  assert.match(preload, /type === 'password' \|\| type === 'file'/);
});

test('fast scrolling keeps the frame-sampled path with heartbeat backup', () => {
  const preload = read('src/page-preload-v18.js');
  const hooks = read('src/main-v22-hooks.js');
  const recovery = read('src/main-v25-sync.js');
  assert.match(preload, /leader-scroll-direct-v22/);
  assert.match(preload, /requestAnimationFrame\(publishFastScroll\)/);
  assert.match(hooks, /ipcMain\.on\('leader-scroll-direct-v22'/);
  assert.match(recovery, /Date\.now\(\) - lastDirectScrollAt > 240/);
});

test('turning Following or Scrolling off clears old follower scroll targets', () => {
  const hooks = read('src/main-v24-hooks.js');
  const bridge = read('src/renderer/bridge-v24.js');
  assert.match(hooks, /window\.__conduitScrollTarget = null/);
  assert.match(bridge, /if \(!policy\?\.scrolling\) await clearFollowerTargets\(\)/);
  assert.match(bridge, /if \(!enabled\) await clearFollowerTargets\(\)/);
});

test('numeric IP is shown when location is unavailable', () => {
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(bridge, /IP address · \$\{ip\}/);
  assert.match(bridge, /IP address · \$\{route\.ip\}/);
  assert.match(bridge, /location unavailable/i);
});

test('screen rows show measured synchronization percentages', () => {
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(bridge, /Synced \$\{row\.score\}%/);
  assert.match(bridge, /Catching up \$\{row\.score\}%/);
  assert.match(bridge, /synced · \$\{average\}/);
  assert.match(bridge, /Screen 1 leads/);
});

test('renderer loads the quality bridge before the main app', () => {
  const html = read('src/renderer/index-v18.html');
  assert.match(html, /bridge-v25\.js/);
  assert.ok(html.indexOf('bridge-v25.js') < html.indexOf('app-v21.js'));
});

test('welcome page remains a visible alignment test', () => {
  const html = read('src/renderer/welcome-v18.html');
  assert.match(html, /Hello, thank you for using Conduit!/);
  assert.match(html, /Alignment Test/);
  assert.match(html, /id="result"/);
  assert.match(html, /id="increment" type="button">\+1/);
});

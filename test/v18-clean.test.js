'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.24 through the new entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v24.js');
  assert.equal(pkg.version, '0.24.0');
  assert.match(pkg.scripts.check, /main-v24-hooks\.js/);
  assert.match(pkg.scripts.check, /bridge-v24\.js/);
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

test('Settings pane count remains a draft until Apply and close', () => {
  const bridge = read('src/renderer/bridge-v24.js');
  const listenerStart = bridge.indexOf("paneCount?.addEventListener('change'");
  const listenerEnd = bridge.indexOf('}, true);', listenerStart);
  const listener = bridge.slice(listenerStart, listenerEnd);
  assert.ok(listenerStart >= 0);
  assert.match(listener, /waiting for Apply and close/);
  assert.doesNotMatch(listener, /setPaneCount|verifiedPaneCount/);
  assert.match(bridge, /api\.setPaneCount = \(value\) => verifiedPaneCount/);
});

test('turning Following or Scrolling off clears old follower scroll targets', () => {
  const hooks = read('src/main-v24-hooks.js');
  const bridge = read('src/renderer/bridge-v24.js');
  assert.match(hooks, /window\.__conduitScrollTarget = null/);
  assert.match(hooks, /v24-clear-scroll-targets/);
  assert.match(bridge, /if \(!policy\?\.scrolling\) await clearFollowerTargets\(\)/);
  assert.match(bridge, /if \(!enabled\) await clearFollowerTargets\(\)/);
});

test('pane status uses numbered followers, Screen 1 leads, sound, and IP addresses', () => {
  const bridge = read('src/renderer/bridge-v24.js');
  assert.match(bridge, /`Follower \$\{index\}`/);
  assert.match(bridge, /Screen 1 leads/);
  assert.match(bridge, /Sound enabled/);
  assert.match(bridge, /parts\.push\(route\?\.ok && route\.ip \? route\.ip : 'IP not checked'\)/);
  assert.doesNotMatch(bridge, /Follower \$\{String\.fromCharCode/);
});

test('pane UI removes numbering and focus controls', () => {
  const bridge = read('src/renderer/bridge-v24.js');
  const css = read('src/renderer/styles-v24.css');
  assert.match(bridge, /\.pane-number, \.pane-index/);
  assert.match(bridge, /button\[data-action="focus"\]/);
  assert.match(css, /#topology-list/);
  assert.match(css, /grid-template-columns: 1fr/);
});

test('Settings uses the lighter transparent background', () => {
  const css = read('src/renderer/styles-v24.css');
  assert.match(css, /background: rgba\(67, 75, 89, \.68\)/);
  assert.match(css, /backdrop-filter: blur\(28px\)/);
  assert.match(css, /\.settings-section[\s\S]*background: transparent/);
});

test('fast scrolling still uses the frame-sampled channel', () => {
  const preload = read('src/page-preload-v18.js');
  const hooks = read('src/main-v22-hooks.js');
  assert.match(preload, /leader-scroll-direct-v22/);
  assert.match(preload, /requestAnimationFrame\(publishFastScroll\)/);
  assert.match(hooks, /ipcMain\.on\('leader-scroll-direct-v22'/);
});

test('welcome page is a visible alignment test without the old instruction sentence', () => {
  const html = read('src/renderer/welcome-v18.html');
  assert.match(html, /Hello, thank you for using Conduit!/);
  assert.match(html, /Alignment Test/);
  assert.match(html, /id="result"/);
  assert.match(html, /Checkbox: off/);
  assert.match(html, /id="increment" type="button">\+1/);
  assert.doesNotMatch(html, /Use this page/);
});

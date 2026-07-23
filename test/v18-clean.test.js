'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches the 0.29 bounded recovery entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v29.js');
  assert.equal(pkg.version, '0.29.0');
  assert.match(pkg.scripts.check, /main-v29-watchdog\.js/);
  assert.match(pkg.scripts.check, /page-preload-v29\.js/);
});

test('startup keeps one coordinator and one bounded watchdog', () => {
  const entry = read('src/main-entry-v29.js');
  assert.match(entry, /main-v26-sync/);
  assert.match(entry, /main-v29-watchdog/);
  assert.doesNotMatch(entry, /main-v27-watchdog|main-v25-sync|main-v22-hooks|main-v24-hooks/);
});

test('each launch still starts with four screens', () => {
  const fresh = read('src/fresh-start-v23.js');
  const workspace = read('src/workspace-v21.js');
  assert.match(fresh, /workspace-v21\.json/);
  assert.match(fresh, /fs\.rmSync/);
  assert.match(workspace, /let screenCount = 4/);
  assert.match(workspace, /ensureViews\(4\)/);
});

test('pane views load the v29 controls around the existing sync and challenge contracts', () => {
  const entry = read('src/page-preload-v18.js');
  const v29 = read('src/page-preload-v29.js');
  const v28 = read('src/page-preload-v28.js');
  const v27 = read('src/page-preload-v27.js');
  assert.match(entry, /page-preload-v29/);
  assert.match(v29, /page-preload-v28/);
  assert.match(v28, /page-preload-v27/);
  assert.match(v27, /page-preload-v26/);
  assert.match(v28, /challengePresentV28/);
});

test('settings remain draft-only', () => {
  const bridge = read('src/renderer/bridge-v24.js');
  assert.match(bridge, /waiting for Apply and close/);
  assert.match(bridge, /api\.setPaneCount = verifiedPaneCount/);
});

test('IP fallback remains available', () => {
  const main = read('src/main-v25-ip-fallback.js');
  assert.match(main, /api64\.ipify\.org/);
  assert.match(main, /icanhazip\.com/);
});

test('toolbar and welcome cleanup remain present', () => {
  const html = read('src/renderer/index-v18.html');
  const bridge = read('src/renderer/bridge-v25.js');
  const welcome = read('src/renderer/welcome-v18.html');
  assert.match(html, /bookmark-checkmyip/);
  assert.match(bridge, /browserleaks\.com\/ip/);
  assert.match(bridge, /\[BETA\]/);
  assert.doesNotMatch(welcome, /Conduit local welcome page/);
});

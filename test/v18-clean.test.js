'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.26 through the single sync entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v26.js');
  assert.equal(pkg.version, '0.26.0');
  assert.match(pkg.scripts.check, /main-v26-sync\.js/);
  assert.match(pkg.scripts.check, /page-preload-v26\.js/);
  assert.doesNotMatch(pkg.scripts.check, /main-v25-sync\.js|main-v22-hooks\.js|main-v24-hooks\.js/);
});

test('v26 startup redirects the legacy shell instead of loading legacy sync', () => {
  const entry = read('src/main-entry-v26.js');
  assert.match(entry, /main-entry-v18\.js/);
  assert.match(entry, /request === '\.\/main-v18'/);
  assert.match(entry, /main-v26-shell/);
  assert.doesNotMatch(entry, /main-v25-sync|main-v22-hooks|main-v24-hooks/);
});

test('each launch still starts with a clean four-screen workspace', () => {
  const fresh = read('src/fresh-start-v23.js');
  const workspace = read('src/workspace-v21.js');
  assert.match(fresh, /workspace-v21\.json/);
  assert.match(fresh, /fs\.rmSync/);
  assert.match(workspace, /let screenCount = 4/);
  assert.match(workspace, /ensureViews\(4\)/);
});

test('all pane views use the v26 preload contract', () => {
  const legacyPreload = read('src/page-preload-v18.js');
  const preload = read('src/page-preload-v26.js');
  assert.match(legacyPreload, /require\('\.\/page-preload-v26'\)/);
  assert.match(preload, /v26-register/);
  assert.match(preload, /v26-leader-scroll/);
  assert.match(preload, /v26-leader-action/);
  assert.match(preload, /v26-leader-snapshot/);
  assert.match(preload, /v26-apply-snapshot/);
});

test('settings remain draft-only until Apply and close', () => {
  const bridge = read('src/renderer/bridge-v24.js');
  assert.match(bridge, /waiting for Apply and close/);
  assert.match(bridge, /api\.setPaneCount = verifiedPaneCount/);
  assert.doesNotMatch(bridge, /syncV22State|resyncFollowersV25|configureSyncV25/);
});

test('numeric IP fallback remains available', () => {
  const main = read('src/main-v25-ip-fallback.js');
  const bridge = read('src/renderer/bridge-v24.js');
  assert.match(main, /api64\.ipify\.org/);
  assert.match(main, /icanhazip\.com/);
  assert.match(bridge, /checkIPFallbacksV25\(missing\)/);
  assert.match(bridge, /IP address · \$\{fallback\}/);
});

test('checkmyip bookmark and welcome cleanup remain present', () => {
  const html = read('src/renderer/index-v18.html');
  const bridge = read('src/renderer/bridge-v24.js');
  const welcome = read('src/renderer/welcome-v18.html');
  assert.match(html, /id="bookmark-checkmyip"/);
  assert.match(bridge, /api\.navigate\('https:\/\/myip\.wtf'\)/);
  assert.doesNotMatch(welcome, /Conduit local welcome page/);
});

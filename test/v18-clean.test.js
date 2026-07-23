'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.22 through the hook-aware entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v22.js');
  assert.equal(pkg.version, '0.22.0');
  assert.match(pkg.scripts.check, /main-v22-hooks\.js/);
  assert.match(pkg.scripts.check, /bridge-v22\.js/);
});

test('workspace still starts with four panes and creates extra panes lazily', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /let screenCount = 4/);
  assert.match(source, /ensureViews\(4\)/);
  assert.doesNotMatch(source, /for \(let index = 0; index < MAX_PANES; index \+= 1\) createView/);
});

test('location lookup keeps the ten second provider fallback', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /fetchJSONWithTimeout\(ses, provider\.url, 10000\)/);
  assert.match(source, /ipwho\.is/);
  assert.match(source, /ipapi\.co/);
  assert.match(source, /api\.ipify\.org/);
});

test('fast scrolling uses a dedicated frame-sampled channel', () => {
  const preload = read('src/page-preload-v18.js');
  const hooks = read('src/main-v22-hooks.js');
  assert.match(preload, /leader-scroll-direct-v22/);
  assert.match(preload, /requestAnimationFrame\(publishFastScroll\)/);
  assert.match(preload, /scheduleState\(110\)/);
  assert.match(hooks, /ipcMain\.on\('leader-scroll-direct-v22'/);
  assert.match(hooks, /contents\.send\('leader-scroll-v18'/);
});

test('post-settings and reset recovery request a complete follower handshake', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  const hooks = read('src/main-v22-hooks.js');
  assert.match(bridge, /api\.setSettingsVisible = async/);
  assert.match(bridge, /finishSetup\('Applying the follower setup again/);
  assert.match(bridge, /api\.resetPane = async/);
  assert.match(bridge, /await api\.resyncAll\(\)/);
  assert.match(hooks, /ipcMain\.handle\('v22-resync-all'/);
  assert.match(hooks, /requestAllPaneStates/);
});

test('address navigation retries and the Go button submits explicitly', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  assert.match(bridge, /api\.navigate = async/);
  assert.match(bridge, /await wait\(220\)/);
  assert.match(bridge, /form\?\.requestSubmit\(\)/);
  assert.match(bridge, /go\.textContent = 'Opening…'/);
});

test('pane controls remove numeric badges and the Focus action', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  const css = read('src/renderer/styles-v22.css');
  assert.match(bridge, /\.pane-number/);
  assert.match(bridge, /button\[data-action="focus"\]/);
  assert.match(css, /button\[data-action='focus'\]/);
  assert.match(css, /pane-card::before/);
});

test('missing locations are presented as an IP swap', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  assert.match(bridge, /IP swapped · location unavailable/);
});

test('renderer loads the lighter 0.22 style and bridge before the app', () => {
  const html = read('src/renderer/index-v18.html');
  assert.match(html, /styles-v22\.css/);
  assert.match(html, /bridge-v22\.js/);
  assert.ok(html.indexOf('bridge-v22.js') < html.indexOf('app-v21.js'));
});

test('welcome page is the requested simple alignment test', () => {
  const html = read('src/renderer/welcome-v18.html');
  assert.match(html, /Hello, thank you for using Conduit!/);
  assert.match(html, /Alignment Test/);
  assert.match(html, />Checkbox</);
  assert.match(html, />First option</);
  assert.match(html, /id="test-button">Button/);
  assert.match(html, /id="increment">\+1/);
  assert.match(html, /Scroll down to test alignment/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.23 through the fresh-start entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v23.js');
  assert.equal(pkg.version, '0.23.0');
  assert.match(pkg.scripts.check, /fresh-start-v23\.js/);
  assert.match(pkg.scripts.check, /bridge-v22\.js/);
});

test('each launch removes previously saved workspace preferences', () => {
  const source = read('src/fresh-start-v23.js');
  assert.match(source, /workspace-v21\.json/);
  assert.match(source, /fs\.rmSync/);
  assert.match(source, /app\.whenReady\(\)\.then\(clearSavedWorkspace\)/);
});

test('workspace keeps the four-pane default and lazy extra-pane creation', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /let screenCount = 4/);
  assert.match(source, /ensureViews\(4\)/);
  assert.match(source, /async function setPaneCount/);
  assert.match(source, /ensureViews\(next\)/);
});

test('pane count is verified and resynchronized after changes', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  assert.match(bridge, /async function ensurePaneCount/);
  assert.match(bridge, /Number\(state\?\.screenCount\) === count/);
  assert.match(bridge, /await api\.syncV22State/);
  assert.match(bridge, /await resyncBurst\(\)/);
});

test('settings has one completion action and restores count on cancel', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  assert.match(bridge, /#close-settings/);
  assert.match(bridge, /Apply and close/);
  assert.match(bridge, /settingsStartCount/);
  assert.match(bridge, /ensurePaneCount\(settingsStartCount\)/);
});

test('pane UI removes badges and focus while preventing footer overlap', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  assert.match(bridge, /\.pane-number, \.pane-index/);
  assert.match(bridge, /button\[data-action="focus"\]/);
  assert.match(bridge, /grid-template-columns: 1fr !important/);
  assert.match(bridge, /settings-sheet/);
});

test('fresh start restores four panes, 80 percent scale, and following off', () => {
  const bridge = read('src/renderer/bridge-v22.js');
  assert.match(bridge, /ensurePaneCount\(4, false\)/);
  assert.match(bridge, /setZoom\(0\.8\)/);
  assert.match(bridge, /setFollowing\(false\)/);
  assert.match(bridge, /relay:\/\/welcome/);
});

test('fast scrolling continues to use the frame-sampled channel', () => {
  const preload = read('src/page-preload-v18.js');
  const hooks = read('src/main-v22-hooks.js');
  assert.match(preload, /leader-scroll-direct-v22/);
  assert.match(preload, /requestAnimationFrame\(publishFastScroll\)/);
  assert.match(hooks, /ipcMain\.on\('leader-scroll-direct-v22'/);
});

test('welcome page remains the simple alignment test', () => {
  const html = read('src/renderer/welcome-v18.html');
  assert.match(html, /Hello, thank you for using Conduit!/);
  assert.match(html, /Alignment Test/);
  assert.match(html, />Checkbox</);
  assert.match(html, />First option</);
  assert.match(html, /id="increment">\+1/);
});

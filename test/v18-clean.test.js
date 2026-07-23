'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.21 through the consolidated entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v18.js');
  assert.equal(pkg.version, '0.21.0');
  assert.match(pkg.scripts.check, /workspace-v21\.js/);
});

test('workspace starts with four panes and creates extra panes lazily', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /let screenCount = 4/);
  assert.match(source, /ensureViews\(4\)/);
  assert.doesNotMatch(source, /for \(let index = 0; index < MAX_PANES; index \+= 1\) createView/);
});

test('location lookup uses a ten second provider timeout and a fallback provider', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /fetchJSONWithTimeout\(ses, provider\.url, 10000\)/);
  assert.match(source, /ipwho\.is/);
  assert.match(source, /ipapi\.co/);
  assert.match(source, /api\.ipify\.org/);
});

test('pane reset recreates the web contents and requests registration again', () => {
  const source = read('src/workspace-v21.js');
  assert.match(source, /forgetPane\(paneNumber\)/);
  assert.match(source, /await recreateView\(index\)/);
  assert.match(source, /request-pane-state-v18/);
});

test('settings exposes Standard, Multiple IPs, and a dedicated connection screen', () => {
  const html = read('src/renderer/index-v18.html');
  assert.match(html, /connection-screen/);
  assert.match(html, />Standard</);
  assert.match(html, />Multiple IPs</);
  assert.doesNotMatch(html, /Appearance|Saved workspace/);
});

test('boot flow opens Settings after pane registration', () => {
  const source = read('src/renderer/app-v21.js');
  assert.match(source, /async function finishBoot/);
  assert.match(source, /await openSettings\(\)/);
  assert.match(source, /registered >= visible/);
});

test('following master selects or clears all individual policies', () => {
  const source = read('src/renderer/app-v21.js');
  assert.match(source, /function setAllPolicies/);
  assert.match(source, /settingFollow\.addEventListener\('change'/);
  assert.match(source, /updateFollowMaster/);
});

test('coordinator throttles health rendering and supports relay navigation', () => {
  const source = read('src/main-v18.js');
  assert.match(source, /function scheduleBroadcast/);
  assert.match(source, /\^\(https\?:\|file:\|relay:\)/);
  assert.match(source, /__conduitCoordinatorV21/);
});

test('home page uses the older paper interface with Conduit branding', () => {
  const html = read('src/renderer/welcome-v18.html');
  assert.match(html, /--paper:/);
  assert.match(html, /class="wordmark"/);
  assert.match(html, />Conduit</);
  assert.match(html, /id="increment">\+1/);
});

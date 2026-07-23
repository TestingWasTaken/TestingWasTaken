'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches the consolidated v0.19 build', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v18.js');
  assert.equal(pkg.version, '0.19.0');
});

test('all eight panes are supported by the active preload', () => {
  const source = read('src/page-preload-v18.js');
  assert.match(source, /paneNumber <= 8/);
  assert.match(source, /register-pane-v18/);
  assert.doesNotMatch(source, /paneNumber <= 4/);
});

test('workspace defaults to the recommended 80 percent scale', () => {
  const source = read('src/workspace-v18.js');
  assert.match(source, /let zoomFactor = 0\.8/);
});

test('renderer uses one stylesheet and explicit appearance bridge', () => {
  const html = read('src/renderer/index-v18.html');
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  assert.equal((html.match(/<script src=/g) || []).length, 3);
  assert.match(html, /appearance-v19\.js/);
  assert.match(html, /state-guard-v18\.js/);
  assert.match(html, /app-v18\.js/);
  assert.doesNotMatch(html, /value="system"|Follow macOS/);
});

test('settings use inline pane controls and mark privacy beta', () => {
  const html = read('src/renderer/index-v18.html');
  assert.match(html, /Privacy <span class="beta-tag">\[BETA\]<\/span>/);
  assert.match(html, /pane-controls-section/);
  assert.doesNotMatch(html, /<aside class="topology-panel">/);
  assert.match(html, />Done<\/button>/);
});

test('relay home is registered and the page stays simple', () => {
  const entry = read('src/main-entry-v18.js');
  const home = read('src/renderer/welcome-v18.html');
  assert.match(entry, /destination\.hostname === 'home'/);
  assert.match(home, /type="checkbox"/);
  assert.match(home, /<select/);
  assert.doesNotMatch(home, /prefers-color-scheme|pencil-note|masthead/);
});

test('selective following and pane controls are exposed', () => {
  const preload = read('src/preload-v18.js');
  for (const feature of ['setPolicy', 'pausePane', 'focusPane', 'setPaneLabel', 'getHealth']) {
    assert.match(preload, new RegExp(feature));
  }
});

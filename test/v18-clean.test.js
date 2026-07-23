'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches the consolidated v0.18 entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v18.js');
  assert.equal(pkg.version, '0.18.0');
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

test('renderer has one active stylesheet and one active script', () => {
  const html = read('src/renderer/index-v18.html');
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  assert.equal((html.match(/<script src=/g) || []).length, 1);
  assert.match(html, /styles-v18\.css/);
  assert.match(html, /app-v18\.js/);
});

test('selective following and pane controls are exposed', () => {
  const preload = read('src/preload-v18.js');
  for (const feature of ['setPolicy', 'pausePane', 'focusPane', 'setPaneLabel', 'getHealth']) {
    assert.match(preload, new RegExp(feature));
  }
});

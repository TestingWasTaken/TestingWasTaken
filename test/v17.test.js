'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('v0.17 routes browser panes through the eight-pane preload', () => {
  const entry = read('src/main-entry-v17.js');
  assert.match(entry, /page-preload-v17\.js/);
  assert.match(entry, /WebContentsView/);
});

test('the v0.17 page preload accepts panes one through eight', () => {
  const preload = read('src/page-preload-v17.js');
  assert.match(preload, /screenNumber > 8/);
  assert.match(preload, /register-screen-v12/);
  assert.match(preload, /require\('\.\/page-preload'\)/);
});

test('dense layouts begin at the recommended eighty percent scale', () => {
  const interfaceScript = read('src/renderer/ui-v17.js');
  assert.match(interfaceScript, /value = '0\.8'/);
  assert.match(interfaceScript, /paneCount < 5/);
});

test('package launches the v0.17 entry point', () => {
  const packageJSON = JSON.parse(read('package.json'));
  assert.equal(packageJSON.main, 'src/main-entry-v17.js');
  assert.equal(packageJSON.version, '0.17.0');
});

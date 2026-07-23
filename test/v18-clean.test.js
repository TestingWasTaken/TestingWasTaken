'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package launches Conduit 0.20 through the consolidated entry', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main-entry-v18.js');
  assert.equal(pkg.version, '0.20.0');
});

test('workspace always begins with four panes and eighty percent scale', () => {
  const source = read('src/workspace-v18.js');
  assert.match(source, /let screenCount = 4/);
  assert.match(source, /screenCount = 4;/);
  assert.match(source, /let zoomFactor = 0\.8/);
});

test('scale, isolated routing, audio, and route details are wired', () => {
  const preload = read('src/preload-v18.js');
  const workspace = read('src/workspace-v18.js');
  assert.match(preload, /setZoom/);
  assert.match(preload, /setAudioMode/);
  assert.match(workspace, /v18-set-network/);
  assert.match(workspace, /ipwho\.is/);
  assert.match(workspace, /audioMode/);
});

test('following supports navigation and all eight panes', () => {
  const main = read('src/main-v18.js');
  assert.match(main, /action\?\.kind === 'navigate'/);
  assert.match(main, /\^\(https\?:\|file:\|relay:\)/);
  assert.match(main, /const MAX_PANES = 8/);
});

test('renderer is dark only and has no saved workspace or device appearance option', () => {
  const html = read('src/renderer/index-v18.html');
  const css = read('src/renderer/styles-v18.css');
  assert.match(html, /data-appearance="dark"/);
  assert.doesNotMatch(html, /Saved workspace|setting-appearance|Follow macOS/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.match(html, /id="go"/);
  assert.match(html, /id="boot-screen"/);
});

test('follow master selects all policy options and URL supports select-all', () => {
  const app = read('src/renderer/app-v18.js');
  assert.match(app, /function setAllPolicies/);
  assert.match(app, /function updateFollowMaster/);
  assert.match(app, /address\.select\(\)/);
});

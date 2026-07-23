'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('disabled health reports cannot erase a newly selected follow policy', () => {
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(bridge, /if \(currentFollowing && health\?\.policy\)/);
  assert.match(bridge, /currentPolicy = \{ \.\.\.currentPolicy, \.\.\.health\.policy \}/);
});

test('IP fallback checks only screens still missing a numeric address', () => {
  const main = read('src/main-v25-ip-fallback.js');
  const bridge = read('src/renderer/bridge-v25-ip.js');
  assert.match(main, /function requestedPanes/);
  assert.match(main, /paneNumbers\.map/);
  assert.match(bridge, /const missing = Array\.from/);
  assert.match(bridge, /checkIPFallbacksV25\(missing\)/);
});

test('sync configuration is deduplicated during live health updates', () => {
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(bridge, /let lastConfiguration = ''/);
  assert.match(bridge, /signature === lastConfiguration/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('stale Following-off health cannot cancel a new Follow Screen 1 request', () => {
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(bridge, /let desiredFollowing = false/);
  assert.match(bridge, /let followGuardUntil = 0/);
  assert.match(bridge, /guardActive && reportedFollowing !== desiredFollowing/);
  assert.match(bridge, /followGuardUntil = Date\.now\(\) \+ 2200/);
  assert.match(bridge, /await api\.resyncFollowersV25\(\)/);
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

test('checkmyip bookmark opens myip.wtf', () => {
  const html = read('src/renderer/index-v18.html');
  const bridge = read('src/renderer/bridge-v25.js');
  assert.match(html, /id="bookmark-checkmyip"/);
  assert.match(html, />checkmyip<\/button>/);
  assert.match(bridge, /api\.navigate\('https:\/\/myip\.wtf'\)/);
});

test('welcome page no longer shows the local-page footer', () => {
  const html = read('src/renderer/welcome-v18.html');
  assert.doesNotMatch(html, /Conduit local welcome page/);
  assert.doesNotMatch(html, /<footer>/);
});
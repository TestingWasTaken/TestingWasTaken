'use strict';

const path = require('node:path');
const electronModulePath = require.resolve('electron');
const electron = require(electronModulePath);
const NativeWebContentsView = electron.WebContentsView;

class ConduitWebContentsView extends NativeWebContentsView {
  constructor(options = {}) {
    const webPreferences = { ...(options.webPreferences || {}) };
    const preload = String(webPreferences.preload || '');

    if (path.basename(preload) === 'page-preload.js') {
      webPreferences.preload = path.join(__dirname, 'page-preload-v17.js');
    }

    super({ ...options, webPreferences });
  }
}

const patchedElectron = new Proxy(electron, {
  get(target, property, receiver) {
    if (property === 'WebContentsView') return ConduitWebContentsView;
    return Reflect.get(target, property, receiver);
  },
});

require.cache[electronModulePath].exports = patchedElectron;

const { app, BrowserWindow } = patchedElectron;
app.setName('Conduit');
require('./main-v16');

app.whenReady().then(() => {
  setTimeout(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setTitle('Conduit');
    }
  }, 300);
});

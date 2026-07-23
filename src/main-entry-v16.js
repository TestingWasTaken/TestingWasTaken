'use strict';

const { app, BrowserWindow } = require('electron');

app.setName('Conduit');
require('./main-v16');

app.whenReady().then(() => {
  setTimeout(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setTitle('Conduit');
    }
  }, 300);
});

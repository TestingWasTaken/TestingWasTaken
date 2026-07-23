'use strict';

const { app, ipcMain, shell } = require('electron');

app.setName('Conduit');

ipcMain.handle('v18-open-external', async (_event, value) => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') throw new Error('Only secure external links are allowed.');
    await shell.openExternal(url.href);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

require('./main-v18');

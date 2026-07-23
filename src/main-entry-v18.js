'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, ipcMain, shell, nativeImage, protocol, net } = require('electron');

const ICON = 'data:image/png;base64,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';

protocol.registerSchemesAsPrivileged([{
  scheme: 'relay',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

app.setName('Conduit');
app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromDataURL(ICON));

  const homeURL = pathToFileURL(path.join(__dirname, 'renderer', 'welcome-v18.html')).toString();
  await protocol.handle('relay', (request) => {
    const destination = new URL(request.url);
    if (destination.hostname === 'home' || destination.hostname === 'welcome') return net.fetch(homeURL);
    return new Response('Page not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  });
});

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

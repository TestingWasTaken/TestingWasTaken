'use strict';

const { ipcMain, webContents } = require('electron');

function paneContents() {
  return webContents.getAllWebContents().filter((contents) => {
    if (contents.isDestroyed()) return false;
    const type = typeof contents.getType === 'function' ? contents.getType() : '';
    return type === 'browserView' || type === 'webview';
  });
}

async function clearScrollTargets() {
  await Promise.allSettled(paneContents().map((contents) => contents.executeJavaScript(
    'window.__conduitScrollTarget = null; window.__conduitScrollVelocity = 0;',
    true,
  )));
  return { ok: true };
}

ipcMain.handle('v24-clear-scroll-targets', clearScrollTargets);
ipcMain.handle('v24-request-pane-states', async () => {
  for (const contents of paneContents()) contents.send('request-pane-state-v18');
  return { ok: true, count: paneContents().length };
});

module.exports = { clearScrollTargets };

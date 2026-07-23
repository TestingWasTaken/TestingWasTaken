'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const { installSessionAdBlocker, snapshot } = require('./adblocker');

function timestamp() {
  return new Date().toLocaleTimeString('en-CA', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function sendDiagnostic(entry) {
  const payload = {
    time: timestamp(),
    level: entry?.level || 'info',
    message: String(entry?.message || ''),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('diagnostic-log', payload);
  }
}

let sessionNumber = 0;
app.on('session-created', (createdSession) => {
  sessionNumber += 1;
  installSessionAdBlocker(createdSession, `Browser session ${sessionNumber}`, sendDiagnostic);
});

app.whenReady().then(() => {
  installSessionAdBlocker(session.defaultSession, 'Relay interface', sendDiagnostic);
  sendDiagnostic({
    level: 'success',
    message: 'Enforced ad and tracker protection is active for every Relay session.',
  });
});

ipcMain.handle('get-adblock-status', () => snapshot());

require('./main');

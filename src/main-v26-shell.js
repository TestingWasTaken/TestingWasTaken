'use strict';

const { app, BrowserWindow, Menu, dialog } = require('electron');

const windowForUI = () => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;

function command(name, payload = null) {
  windowForUI()?.webContents.send('menu-command-v18', { command: name, payload });
}

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'Conduit',
      submenu: [
        {
          label: 'About Conduit',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: 'About Conduit',
            message: 'Conduit',
            detail: 'A linked multi-screen browser made by Jujhar.',
          }),
        },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => command('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Focus Address', accelerator: 'CommandOrControl+L', click: () => command('focus-address') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Active Screen', accelerator: 'CommandOrControl+R', click: () => command('reload-active') },
        { label: 'Reload Every Screen', accelerator: 'CommandOrControl+Shift+R', click: () => command('reload-all') },
        { type: 'separator' },
        ...Array.from({ length: 8 }, (_unused, index) => ({
          label: `Focus Screen ${index + 1}`,
          accelerator: `CommandOrControl+${index + 1}`,
          click: () => command('focus-pane', index + 1),
        })),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});

require('./workspace-v21');

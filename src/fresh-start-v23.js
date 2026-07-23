'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function clearSavedWorkspace() {
  const directory = app.getPath('userData');
  for (const name of ['workspace-v21.json', 'workspace-v20.json']) {
    try {
      fs.rmSync(path.join(directory, name), { force: true });
    } catch {}
  }
}

app.whenReady().then(clearSavedWorkspace);

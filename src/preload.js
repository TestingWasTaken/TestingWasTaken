'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relay', {
  navigate: (value) => ipcRenderer.invoke('navigate', value),
  back: () => ipcRenderer.invoke('go-back'),
  forward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  setScreenCount: (value) => ipcRenderer.invoke('set-screen-count', value),
  setZoom: (value) => ipcRenderer.invoke('set-zoom', value),
  setNetwork: (value) => ipcRenderer.invoke('set-network', value),
  checkIPs: () => ipcRenderer.invoke('check-ips'),
  setSync: (enabled) => ipcRenderer.invoke('set-sync', enabled),
  clearConsole: () => ipcRenderer.invoke('clear-console'),
  onState: (callback) => ipcRenderer.on('browser-state', (_event, state) => callback(state)),
  onLayout: (callback) => ipcRenderer.on('layout-state', (_event, state) => callback(state)),
  onLog: (callback) => ipcRenderer.on('activity-log', (_event, entry) => callback(entry)),
  onLogsReset: (callback) => ipcRenderer.on('activity-log-reset', (_event, entries) => callback(entries)),
});

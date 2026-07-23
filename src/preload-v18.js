'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('conduit', {
  navigate: (value) => ipcRenderer.invoke('v18-navigate', value),
  back: () => ipcRenderer.invoke('v18-back'),
  forward: () => ipcRenderer.invoke('v18-forward'),
  reloadAll: () => ipcRenderer.invoke('v18-reload-all'),
  reloadActive: () => ipcRenderer.invoke('v18-reload-active'),

  setPaneCount: async (value) => {
    const [workspace, sync] = await Promise.all([
      ipcRenderer.invoke('v18-set-pane-count-workspace', value),
      ipcRenderer.invoke('v18-set-pane-count', value),
    ]);
    return { ...(workspace || {}), sync };
  },
  syncPaneCount: (value) => ipcRenderer.invoke('v18-set-pane-count', value),
  setZoom: (value) => ipcRenderer.invoke('v18-set-zoom', value),
  setAudioMode: (value) => ipcRenderer.invoke('v18-set-audio-mode', value),
  setNetwork: (value) => ipcRenderer.invoke('v18-set-network', value),
  checkIPs: () => ipcRenderer.invoke('v18-check-ips'),
  resetPane: (pane) => ipcRenderer.invoke('v18-reset-pane', pane),
  restartAll: () => ipcRenderer.invoke('v18-restart-all'),
  focusPane: (pane) => ipcRenderer.invoke('v18-focus-pane', pane),
  setPaneLabel: (pane, label) => ipcRenderer.invoke('v18-set-pane-label', pane, label),
  setSettingsVisible: (visible) => ipcRenderer.invoke('v18-set-settings-visible', visible),
  getWorkspace: () => ipcRenderer.invoke('v18-get-workspace'),

  setFollowing: (enabled) => ipcRenderer.invoke('v18-set-following', enabled),
  setPolicy: (policy) => ipcRenderer.invoke('v18-set-policy', policy),
  pausePane: (pane, paused) => ipcRenderer.invoke('v18-set-pane-paused', pane, paused),
  getHealth: () => ipcRenderer.invoke('v18-get-health'),

  syncV22State: (state) => ipcRenderer.invoke('v22-sync-state', state),
  resyncAll: () => ipcRenderer.invoke('v22-resync-all'),
  forgetPaneV22: (pane) => ipcRenderer.invoke('v22-forget-pane', pane),
  clearScrollTargets: () => ipcRenderer.invoke('v24-clear-scroll-targets'),
  requestPaneStates: () => ipcRenderer.invoke('v24-request-pane-states'),

  configureSyncV25: (state) => ipcRenderer.invoke('v25-configure-sync', state),
  resyncFollowersV25: () => ipcRenderer.invoke('v25-resync-followers'),
  getSyncQualityV25: () => ipcRenderer.invoke('v25-get-sync-quality'),

  getAdBlock: () => ipcRenderer.invoke('v18-get-adblock'),
  setAdBlock: (enabled) => ipcRenderer.invoke('v18-set-adblock', enabled),
  openExternal: (url) => ipcRenderer.invoke('v18-open-external', url),

  onState: (callback) => ipcRenderer.on('workspace-state-v18', (_event, state) => {
    ipcRenderer.invoke('v18-set-pane-count', state?.screenCount || 4).catch(() => {});
    callback(state);
  }),
  onLayout: (callback) => ipcRenderer.on('layout-state-v18', (_event, state) => callback(state)),
  onProgress: (callback) => ipcRenderer.on('operation-progress-v18', (_event, progress) => callback(progress)),
  onHealth: (callback) => ipcRenderer.on('pane-health-v18', (_event, health) => callback(health)),
  onSyncQualityV25: (callback) => ipcRenderer.on('sync-quality-v25', (_event, quality) => callback(quality)),
  onMenuCommand: (callback) => ipcRenderer.on('menu-command-v18', (_event, command) => callback(command)),
});

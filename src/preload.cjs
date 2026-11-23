const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prayerWidget', {
  getState: () => ipcRenderer.invoke('widget:get-state'),
  hide: () => ipcRenderer.invoke('widget:hide'),
  openMenu: () => ipcRenderer.invoke('widget:menu'),
  openSource: () => ipcRenderer.invoke('widget:source'),
  refresh: () => ipcRenderer.invoke('widget:refresh'),
  onState: callback => ipcRenderer.on('widget:state', (_event, state) => callback(state)),
});

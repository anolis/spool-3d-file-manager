const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spoolDesktop', {
  chooseFolder: () => ipcRenderer.invoke('spool:choose-folder'),
  saveFile: (url, name) => ipcRenderer.invoke('spool:save-file', url, name),
  onAddFolder: callback => { const handler = () => callback(); ipcRenderer.on('spool:add-folder', handler); return () => ipcRenderer.removeListener('spool:add-folder', handler); },
  showStorage: () => ipcRenderer.invoke('spool:show-storage'),
});

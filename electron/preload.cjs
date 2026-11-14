const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corduroyNative', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  saves: {
    read: (name) => ipcRenderer.invoke('saves:read', name),
    write: (name, bytes) => ipcRenderer.invoke('saves:write', name, bytes),
    backups: (name) => ipcRenderer.invoke('saves:backups', name),
    readBackup: (file) => ipcRenderer.invoke('saves:readBackup', file),
  },
  /** Called when the window is closing; call quitReady() once the game has saved. */
  onBeforeQuit: (callback) => ipcRenderer.on('app:before-quit', () => callback()),
  quitReady: () => ipcRenderer.send('app:quit-ready'),
});

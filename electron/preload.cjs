const { contextBridge } = require('electron');

// Native capabilities are added here as the systems that need them land (save files, LAN host).
contextBridge.exposeInMainWorld('corduroyNative', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});

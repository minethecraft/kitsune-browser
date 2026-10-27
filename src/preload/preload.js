'use strict';
// One preload for every view. The bridge is exposed ONLY to internal kitsune:// pages.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'kitsune:') {
  contextBridge.exposeInMainWorld('kitsune', {
    platform: process.platform,
    call: (name, ...args) => ipcRenderer.invoke('k:' + name, ...args),
    on: (name, cb) => {
      const h = (_e, ...a) => cb(...a);
      ipcRenderer.on('k:' + name, h);
      return () => ipcRenderer.removeListener('k:' + name, h);
    }
  });
}

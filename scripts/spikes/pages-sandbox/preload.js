// The host's preload, standing in for Shellby's: the probes check a page can't
// see it. Only the host (the panel's stand-in) gets these two calls.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spikeHost', {
  call: msg => ipcRenderer.invoke('spike:call', msg),
  done: report => ipcRenderer.send('spike:done', report),
});

// Preload bridge. contextIsolation is on and nodeIntegration is off;
// renderers only ever see this whitelisted, channel-checked API.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const CH = require('../shared/ipcChannels');

const invokable = new Set(CH.INVOKABLE);
const sendable = new Set(CH.SENDABLE);
const subscribable = new Set(CH.SUBSCRIBABLE);

contextBridge.exposeInMainWorld('susurro', {
  channels: { ...CH },

  invoke(channel, ...args) {
    if (!invokable.has(channel)) {
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  send(channel, ...args) {
    if (!sendable.has(channel)) throw new Error(`Channel not allowed: ${channel}`);
    ipcRenderer.send(channel, ...args);
  },

  on(channel, callback) {
    if (!subscribable.has(channel)) throw new Error(`Channel not allowed: ${channel}`);
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

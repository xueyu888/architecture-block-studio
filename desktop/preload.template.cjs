const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze(__CHANNELS__);

contextBridge.exposeInMainWorld("architectureBlockStudioDesktop", Object.freeze({
  platform: "win32",
  openDesign: () => ipcRenderer.invoke(channels.openDesign),
  acceptOpenedDesign: (token) => ipcRenderer.invoke(channels.acceptOpenedDesign, token),
  saveDesign: (request) => ipcRenderer.invoke(channels.saveDesign, request),
  clearFileBinding: () => ipcRenderer.invoke(channels.clearFileBinding),
  setDirty: (state) => ipcRenderer.send(channels.dirtyState, state),
  onSaveBeforeClose: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(channels.saveBeforeClose, listener);
    return () => ipcRenderer.removeListener(channels.saveBeforeClose, listener);
  },
  completeSaveBeforeClose: (saved) => ipcRenderer.send(channels.saveBeforeCloseComplete, saved),
  getUpdateState: () => ipcRenderer.invoke(channels.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(channels.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(channels.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(channels.installUpdate),
  onUpdateState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on(channels.updateState, listener);
    return () => ipcRenderer.removeListener(channels.updateState, listener);
  },
}));

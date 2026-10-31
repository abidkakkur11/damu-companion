const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsApi", {
  get: () => ipcRenderer.invoke("settings:get"),
  set: (patch) => ipcRenderer.invoke("settings:set", patch),
  reset: () => ipcRenderer.invoke("settings:reset"),
  setLogin: (on) => ipcRenderer.invoke("login:set", on),
  action: (name, arg) => ipcRenderer.send("action", name, arg),
  openDataFolder: () => ipcRenderer.send("open-data-folder"),
  onChanged: (cb) => ipcRenderer.on("settings", (_e, s) => cb(s)),
});

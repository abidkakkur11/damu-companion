const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("damu", {
  setIgnoreMouse: (ignore) => ipcRenderer.send("set-ignore", ignore),
  getSettings: () => ipcRenderer.invoke("settings:get").then((r) => r.settings),
  leftScreen: () => ipcRenderer.send("left-screen"),
  onVisit: (cb) => ipcRenderer.on("visit", (_e, p) => cb(p?.manual)),
  onSay: (cb) => ipcRenderer.on("say", () => cb()),
  onSettings: (cb) => ipcRenderer.on("settings", (_e, s) => cb(s)),
  onLeave: (cb) => ipcRenderer.on("leave", () => cb()),
  onEnter: (cb) => ipcRenderer.on("enter", () => cb()),
  onPreviewSound: (cb) => ipcRenderer.on("preview-sound", () => cb()),
});

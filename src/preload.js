const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("damu", {
  setIgnoreMouse: (ignore) => ipcRenderer.send("set-ignore", ignore),
  getSettings: () => ipcRenderer.invoke("settings:get").then((r) => r.settings),
  leftScreen: () => ipcRenderer.send("left-screen"),
  onRemind: (cb) => ipcRenderer.on("remind", (_e, p) => cb(p)),
  onChatter: (cb) => ipcRenderer.on("chatter", () => cb()),
  onSay: (cb) => ipcRenderer.on("say", (_e, p) => cb(p)),
  onSettings: (cb) => ipcRenderer.on("settings", (_e, s) => cb(s)),
  onLeave: (cb) => ipcRenderer.on("leave", () => cb()),
  onEnter: (cb) => ipcRenderer.on("enter", () => cb()),
  onPreviewSound: (cb) => ipcRenderer.on("preview-sound", () => cb()),
});

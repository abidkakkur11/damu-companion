const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("damu", {
  setIgnoreMouse: (ignore) => ipcRenderer.send("set-ignore", ignore),
  onRemind: (cb) => ipcRenderer.on("remind", (_e, p) => cb(p)),
  onChatter: (cb) => ipcRenderer.on("chatter", () => cb()),
  onSay: (cb) => ipcRenderer.on("say", (_e, p) => cb(p)),
});

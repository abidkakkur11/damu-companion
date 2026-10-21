const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, protocol, net } = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

if (!app.requestSingleInstanceLock()) app.quit();

// Serve src/ and assets/ over app://damu so the renderer is same-origin (canvas stays untainted).
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const APP_ROOT = path.join(__dirname, "..");
function handleAppProtocol(request) {
  const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
  const file = path.resolve(APP_ROOT, rel);
  const allowed = ["src", "assets"].some((d) => file.startsWith(path.join(APP_ROOT, d) + path.sep));
  if (!allowed) return new Response("forbidden", { status: 403 });
  return net.fetch(pathToFileURL(file).href);
}

const DEFAULTS = { waterMinutes: 45, breakMinutes: 60, chatter: "normal", paused: false, visible: true };
// How often Damu says something on his own: [min, max] minutes between remarks.
const CHATTER = { often: [2, 4], normal: [4, 8], rare: [10, 15], off: null };
let settings = { ...DEFAULTS };
let win, tray, waterTimer, breakTimer, chatterTimer;

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch {}
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
}

function createWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on("console-message", (_e, level, message, line, source) => console.log(`[renderer:${level}] ${message} (${source}:${line})`));
  win.webContents.on("did-fail-load", (_e, code, desc, url) => console.log(`[load-fail] ${code} ${desc} ${url}`));
  win.loadURL("app://damu/src/companion.html");
  win.once("ready-to-show", () => { if (settings.visible) win.showInactive(); });
}

function fitToDisplay() {
  if (win) win.setBounds(screen.getPrimaryDisplay().workArea);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function schedule() {
  clearInterval(waterTimer);
  clearInterval(breakTimer);
  if (settings.paused) return;
  waterTimer = setInterval(() => send("remind", { type: "water" }), settings.waterMinutes * 60_000);
  breakTimer = setInterval(() => send("remind", { type: "break" }), settings.breakMinutes * 60_000);
}

function scheduleChatter() {
  clearTimeout(chatterTimer);
  const range = CHATTER[settings.chatter];
  if (!range) return;
  const ms = (range[0] + Math.random() * (range[1] - range[0])) * 60_000;
  chatterTimer = setTimeout(() => { send("chatter"); scheduleChatter(); }, ms);
}

function update(patch) {
  settings = { ...settings, ...patch };
  saveSettings();
  schedule();
  scheduleChatter();
  buildMenu();
  if (win) settings.visible ? win.showInactive() : win.hide();
}

function radio(label, key, values) {
  return {
    label,
    submenu: values.map((v) => ({
      label: `${v} min`, type: "radio", checked: settings[key] === v,
      click: () => update({ [key]: v }),
    })),
  };
}

function buildMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Say hi", click: () => send("say", { text: "Hello! Ready when you are." }) },
    { label: "Drink water now", click: () => send("remind", { type: "water" }) },
    { type: "separator" },
    radio("Water reminder every", "waterMinutes", [1, 15, 30, 45, 60, 90]),
    radio("Break reminder every", "breakMinutes", [1, 30, 45, 60, 90, 120]),
    {
      label: "Chatter (Damu talks)",
      submenu: [["often", "Often (every 2-4 min)"], ["normal", "Normal (every 4-8 min)"], ["rare", "Rare (every 10-15 min)"], ["off", "Off"]]
        .map(([v, label]) => ({ label, type: "radio", checked: settings.chatter === v, click: () => update({ chatter: v }) })),
    },
    { label: "Pause reminders", type: "checkbox", checked: settings.paused, click: (i) => update({ paused: i.checked }) },
    { type: "separator" },
    { label: "Show Damu", type: "checkbox", checked: settings.visible, click: (i) => update({ visible: i.checked }) },
    {
      label: "Start with Windows", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }),
    },
    { type: "separator" },
    { label: "Quit Damu", click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  protocol.handle("app", handleAppProtocol);
  loadSettings();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "..", "assets", "tray.png")));
  tray.setToolTip("Damu");
  tray.on("click", () => update({ visible: !settings.visible }));
  buildMenu();
  createWindow();
  schedule();
  scheduleChatter();
  // Dev aid: DAMU_TEST=break|water|chatter fires that event 6s after launch.
  const test = process.env.DAMU_TEST;
  if (test) setTimeout(() => (test === "chatter" ? send("chatter") : send("remind", { type: test })), 6000);
  screen.on("display-metrics-changed", fitToDisplay);
  screen.on("display-added", fitToDisplay);
  screen.on("display-removed", fitToDisplay);
});

ipcMain.on("set-ignore", (_e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
});

app.on("second-instance", () => update({ visible: true }));
app.on("window-all-closed", () => {});

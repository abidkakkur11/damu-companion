const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, protocol, net, shell } = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("net.expedigit.damu");

// Serve src/ and assets/ over app://damu so the renderer is same-origin (canvas stays untainted).
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const APP_ROOT = path.resolve(__dirname, "..");
function handleAppProtocol(request) {
  const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
  const file = path.resolve(APP_ROOT, rel);
  const fileLower = file.toLowerCase();
  const allowed = ["src", "assets"].some((d) => {
    const prefix = (path.join(APP_ROOT, d) + path.sep).toLowerCase();
    return fileLower.startsWith(prefix);
  });
  if (!allowed) {
    console.error(`[protocol] 403 Forbidden: ${request.url} -> ${file}`);
    return new Response("forbidden", { status: 403 });
  }
  if (!fs.existsSync(file)) {
    console.error(`[protocol] 404 Not Found: ${request.url} -> ${file}`);
    return new Response("not found", { status: 404 });
  }
  return net.fetch(pathToFileURL(file).href);
}

const DEFAULTS = {
  firstRun: true,
  visible: true,          // companion on screen
  paused: false,          // pause all reminders
  waterEnabled: true, waterMinutes: 45,
  breakEnabled: true, breakMinutes: 60,
  chatter: "normal",
  walkSpeed: 1,           // multiplier
  size: 1,                // multiplier
  offscreenTrips: true,
  audioEnabled: true, volume: 0.8,
  soundReminders: true, soundChatter: true, soundReactions: true,
};
// How often Damu says something on his own: [min, max] minutes between remarks.
const CHATTER = { often: [2, 4], normal: [4, 8], rare: [10, 15], off: null };
// Allowed range for numeric settings: [min, max, integer?]
const RANGES = {
  waterMinutes: [1, 240, true], breakMinutes: [1, 240, true],
  walkSpeed: [0.4, 2.5], size: [0.6, 1.6], volume: [0, 1],
};

let settings = { ...DEFAULTS };
let win, settingsWin, tray, waterTimer, breakTimer, chatterTimer, hideTimer;

const ICON = path.join(__dirname, "..", "assets", "icon.png");
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

// Keep only known keys of the right type, clamped to their range.
function sanitize(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS) || key === "firstRun") continue;
    if (key in RANGES) {
      const [lo, hi, int] = RANGES[key];
      let n = Number(value);
      if (!Number.isFinite(n)) continue;
      n = Math.min(hi, Math.max(lo, n));
      out[key] = int ? Math.round(n) : n;
    } else if (key === "chatter") {
      if (value in CHATTER) out[key] = value;
    } else if (typeof value === typeof DEFAULTS[key]) {
      out[key] = value;
    }
  }
  return out;
}

function loadSettings() {
  const firstRun = !fs.existsSync(settingsFile());
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch {}
  settings = { ...DEFAULTS, ...sanitize(saved), firstRun };
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
}

// ----- Companion (overlay) window -----
function createWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, autoplayPolicy: "no-user-gesture-required" },
  });
  win.setAlwaysOnTop(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on("console-message", (_e, level, message, line, source) => console.log(`[renderer:${level}] ${message} (${source}:${line})`));
  win.webContents.on("did-fail-load", (_e, code, desc, url) => console.error(`[load-fail] ${code} ${desc} ${url}`));
  win.once("ready-to-show", () => {
    console.log("[main] ready-to-show");
    if (settings.visible) {
      win.showInactive();
      win.setAlwaysOnTop(true);
    }
  });
  win.loadURL("app://damu/src/companion.html");
}

function fitToDisplay() {
  if (win) win.setBounds(screen.getPrimaryDisplay().workArea);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Reminders and chatter only reach Damu while the companion is switched on.
function sendIfVisible(channel, payload) {
  if (settings.visible) send(channel, payload);
}

// ----- Timers -----
function schedule() {
  clearInterval(waterTimer);
  clearInterval(breakTimer);
  if (settings.paused) return;
  if (settings.waterEnabled) waterTimer = setInterval(() => sendIfVisible("remind", { type: "water" }), settings.waterMinutes * 60_000);
  if (settings.breakEnabled) breakTimer = setInterval(() => sendIfVisible("remind", { type: "break" }), settings.breakMinutes * 60_000);
}

function scheduleChatter() {
  clearTimeout(chatterTimer);
  const range = CHATTER[settings.chatter];
  if (!range) return;
  const ms = (range[0] + Math.random() * (range[1] - range[0])) * 60_000;
  chatterTimer = setTimeout(() => { sendIfVisible("chatter"); scheduleChatter(); }, ms);
}

// Show or hide the companion: he walks off-screen first, then the window hides.
function applyVisibility() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(hideTimer);
  if (settings.visible) {
    win.showInactive();
    win.setAlwaysOnTop(true);
    send("enter");
  } else {
    send("leave");
    hideTimer = setTimeout(() => { if (!settings.visible) win.hide(); }, 30_000); // fallback if he never reports back
  }
}

// ----- Settings -----
function broadcast() {
  send("settings", settings);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings", settings);
}

function update(patch) {
  const prev = settings;
  settings = { ...settings, ...sanitize(patch) };
  const changed = (...keys) => keys.some((k) => prev[k] !== settings[k]);
  saveSettings();
  if (changed("paused", "waterEnabled", "waterMinutes", "breakEnabled", "breakMinutes")) schedule();
  if (changed("chatter")) scheduleChatter();
  buildMenu();
  broadcast();
  if (changed("visible")) applyVisibility();
}

ipcMain.handle("settings:get", () => ({
  settings,
  loginItem: app.getLoginItemSettings().openAtLogin,
  version: app.getVersion(),
  dataPath: app.getPath("userData"),
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
}));
ipcMain.handle("settings:set", (_e, patch) => { update(patch); return settings; });
ipcMain.handle("settings:reset", () => {
  update({ ...DEFAULTS, visible: settings.visible });
  return settings;
});
ipcMain.handle("login:set", (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  buildMenu();
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.on("action", (_e, name, arg) => {
  if (name === "say-hi") sendIfVisible("say", { text: "Hello! Ready when you are." });
  else if (name === "remind" && (arg === "water" || arg === "break")) sendIfVisible("remind", { type: arg });
  else if (name === "preview-sound") send("preview-sound");
});
ipcMain.on("open-data-folder", () => shell.openPath(app.getPath("userData")));
ipcMain.on("left-screen", () => {
  clearTimeout(hideTimer);
  if (!settings.visible && win && !win.isDestroyed()) win.hide();
});
ipcMain.on("set-ignore", (_e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
});

// ----- Settings window -----
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 940, height: 680, minWidth: 780, minHeight: 560,
    title: "Damu", icon: ICON, backgroundColor: "#fbf6e6", autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload-settings.js"), contextIsolation: true },
  });
  settingsWin.removeMenu();
  settingsWin.once("ready-to-show", () => settingsWin.show());
  // The settings UI never navigates or opens other windows.
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWin.webContents.on("will-navigate", (e) => e.preventDefault());
  settingsWin.on("closed", () => { settingsWin = null; });
  settingsWin.loadURL("app://damu/src/settings.html");
}

// ----- Tray -----
function buildMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Damu settings", click: openSettings },
    { type: "separator" },
    { label: "Show Damu", type: "checkbox", checked: settings.visible, click: (i) => update({ visible: i.checked }) },
    { label: "Pause reminders", type: "checkbox", checked: settings.paused, click: (i) => update({ paused: i.checked }) },
    { label: "Sound", type: "checkbox", checked: settings.audioEnabled, click: (i) => update({ audioEnabled: i.checked }) },
    { type: "separator" },
    { label: "Say hi", enabled: settings.visible, click: () => sendIfVisible("say", { text: "Hello! Ready when you are." }) },
    { label: "Drink water now", enabled: settings.visible, click: () => sendIfVisible("remind", { type: "water" }) },
    { type: "separator" },
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
  tray.on("click", openSettings);
  buildMenu();
  createWindow();
  schedule();
  scheduleChatter();
  if (settings.firstRun) {
    openSettings();
    settings.firstRun = false;
    saveSettings();
  }
  // Dev aid: DAMU_TEST=break|water|chatter fires that event 6s after launch.
  const test = process.env.DAMU_TEST;
  if (test) setTimeout(() => (test === "chatter" ? send("chatter") : send("remind", { type: test })), 6000);
  screen.on("display-metrics-changed", fitToDisplay);
  screen.on("display-added", fitToDisplay);
  screen.on("display-removed", fitToDisplay);
});

app.on("second-instance", openSettings);
app.on("window-all-closed", () => {});

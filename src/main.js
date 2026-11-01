const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, protocol, net, shell } = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const isMac = process.platform === "darwin";

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

// Pages the Settings window may open in the default browser (looked up by key, never by raw URL).
const LINKS = {
  repo: "https://github.com/abidkakkur11/damu-companion",
  site: "https://abidkakkur11.github.io/damu-companion/",
  issues: "https://github.com/abidkakkur11/damu-companion/issues",
  author: "https://abidkp.com",
};

const DEFAULTS = {
  firstRun: true,
  visible: true,            // companion on screen
  paused: false,            // pause dialogue visits
  dialoguesEnabled: true,   // Damu comes and tells a dialogue now and then
  visitMinutes: 10,         // average minutes between visits
  walkSpeed: 1.3,           // multiplier
  size: 1,                  // multiplier
  offscreenTrips: true,
  audioEnabled: true, volume: 0.8,
  soundDialogues: true,     // greeting, dialogue and OK sounds
  soundReactions: true,     // click, double-click, drag sounds
};
// Allowed range for numeric settings: [min, max, integer?]
const RANGES = {
  visitMinutes: [1, 240, true],
  walkSpeed: [0.4, 3], size: [0.6, 1.6], volume: [0, 1],
};

let settings = { ...DEFAULTS };
let win, settingsWin, tray, visitTimer, hideTimer;

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
  keepOnTop();
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on("console-message", (_e, level, message, line, source) => console.log(`[renderer:${level}] ${message} (${source}:${line})`));
  win.webContents.on("did-fail-load", (_e, code, desc, url) => console.error(`[load-fail] ${code} ${desc} ${url}`));
  win.once("ready-to-show", () => {
    console.log("[main] ready-to-show");
    if (settings.visible) {
      win.showInactive();
      keepOnTop();
    }
  });
  win.loadURL("app://damu/src/companion.html");
}

// Float above other windows. On macOS also stay visible on every Space and over full-screen apps.
function keepOnTop() {
  if (!win || win.isDestroyed()) return;
  if (isMac) {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(true);
  }
}

function fitToDisplay() {
  if (win) win.setBounds(screen.getPrimaryDisplay().workArea);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Dialogues and "say hi" only reach Damu while the companion is switched on.
function sendIfVisible(channel, payload) {
  if (settings.visible) send(channel, payload);
}

// ----- Visits: every so often Damu comes and tells a dialogue -----
function scheduleVisit() {
  clearTimeout(visitTimer);
  if (settings.paused || !settings.dialoguesEnabled) return;
  const jitter = 0.8 + Math.random() * 0.4; // +/-20% so visits don't feel clockwork
  visitTimer = setTimeout(() => {
    sendIfVisible("visit");
    scheduleVisit();
  }, settings.visitMinutes * 60_000 * jitter);
}

// Show or hide the companion: he walks off-screen first, then the window hides.
function applyVisibility() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(hideTimer);
  if (settings.visible) {
    win.showInactive();
    keepOnTop();
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
  if (changed("paused", "dialoguesEnabled", "visitMinutes")) scheduleVisit();
  buildMenu();
  broadcast();
  if (changed("visible")) applyVisibility();
}

ipcMain.handle("settings:get", () => ({
  settings,
  platform: process.platform,
  loginItem: app.getLoginItemSettings().openAtLogin,
  version: app.getVersion(),
  dataPath: app.getPath("userData"),
  settingsPath: settingsFile(),
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
ipcMain.on("action", (_e, name) => {
  if (name === "say-hi") sendIfVisible("say");
  else if (name === "dialogue-now") sendIfVisible("visit", { manual: true });
  else if (name === "preview-sound") send("preview-sound");
});
ipcMain.on("open-link", (_e, key) => {
  if (Object.hasOwn(LINKS, key)) shell.openExternal(LINKS[key]);
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
  if (isMac) {
    // A menu-bar style app has no Dock icon until a window is open.
    app.setActivationPolicy("regular");
    app.dock?.show();
  }
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
  if (!isMac) settingsWin.removeMenu();
  settingsWin.once("ready-to-show", () => settingsWin.show());
  // The settings UI never navigates or opens other windows.
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWin.webContents.on("will-navigate", (e) => e.preventDefault());
  settingsWin.on("closed", () => {
    settingsWin = null;
    if (isMac) {
      app.setActivationPolicy("accessory");
      app.dock?.hide();
    }
  });
  settingsWin.loadURL("app://damu/src/settings.html");
}

// ----- Tray -----
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "tray.png"));
  return isMac ? img.resize({ height: 18 }) : img;
}

function buildMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Damu settings", click: openSettings },
    { type: "separator" },
    { label: "Show Damu", type: "checkbox", checked: settings.visible, click: (i) => update({ visible: i.checked }) },
    { label: "Pause dialogues", type: "checkbox", checked: settings.paused, click: (i) => update({ paused: i.checked }) },
    { label: "Sound", type: "checkbox", checked: settings.audioEnabled, click: (i) => update({ audioEnabled: i.checked }) },
    { type: "separator" },
    { label: "Say hi", enabled: settings.visible, click: () => sendIfVisible("say") },
    { label: "Dialogue now", enabled: settings.visible, click: () => sendIfVisible("visit", { manual: true }) },
    { type: "separator" },
    {
      label: "Start at login", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }),
    },
    { type: "separator" },
    { label: "Quit Damu", click: () => app.quit() },
  ]));
}

// macOS needs an app menu for Cmd+Q and copy/paste; other platforms have none.
function buildAppMenu() {
  Menu.setApplicationMenu(isMac
    ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
    : null);
}

app.whenReady().then(() => {
  if (isMac) {
    app.setActivationPolicy("accessory"); // tray app: no Dock icon until Settings opens
    app.dock?.hide();
  }
  protocol.handle("app", handleAppProtocol);
  loadSettings();
  buildAppMenu();
  tray = new Tray(trayIcon());
  tray.setToolTip("Damu");
  if (!isMac) tray.on("click", openSettings); // on macOS a click opens the tray menu
  buildMenu();
  createWindow();
  scheduleVisit();
  if (settings.firstRun) {
    openSettings();
    settings.firstRun = false;
    saveSettings();
  }
  // Dev aid: DAMU_TEST=visit fires a dialogue 6s after launch.
  if (process.env.DAMU_TEST === "visit") setTimeout(() => send("visit"), 6000);
  screen.on("display-metrics-changed", fitToDisplay);
  screen.on("display-added", fitToDisplay);
  screen.on("display-removed", fitToDisplay);
});

app.on("second-instance", openSettings);
app.on("activate", openSettings); // macOS: clicking the Dock icon
app.on("window-all-closed", () => {});

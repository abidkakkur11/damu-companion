const api = window.settingsApi;
let settings = {};
let toastTimer;

const FORMAT = {
  min: (v) => `${v} min`,
  x: (v) => `${Number(v).toFixed(1)}×`,
  pct: (v) => `${Math.round(v * 100)}%`,
};

// ----- Navigation -----
const pages = [...document.querySelectorAll("main section")];
const navButtons = [...document.querySelectorAll("#nav button")];
function show(page) {
  pages.forEach((s) => s.classList.toggle("active", s.id === page));
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  document.querySelector("main").scrollTop = 0;
  try { localStorage.setItem("page", page); } catch {}
}
navButtons.forEach((b) => b.addEventListener("click", () => show(b.dataset.page)));
try { show(localStorage.getItem("page") === "reminders" ? "dialogues" : localStorage.getItem("page") || "general"); } catch { show("general"); }

// ----- Rendering settings into the controls -----
function toast(text = "Saved") {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1100);
}

function render() {
  for (const el of document.querySelectorAll("[data-key]")) {
    const value = settings[el.dataset.key];
    if (el === document.activeElement && el.type === "range") continue; // don't fight the user's drag
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  }
  for (const out of document.querySelectorAll("[data-out]")) {
    const input = document.querySelector(`[data-key="${out.dataset.out}"]`);
    out.textContent = FORMAT[input.dataset.fmt](input === document.activeElement ? input.value : settings[out.dataset.out]);
  }
  // Rows and buttons that depend on another setting being on
  for (const el of document.querySelectorAll("[data-requires]")) {
    const ok = el.dataset.requires.split(" ").every((k) => settings[k]);
    if (el.classList.contains("row")) el.classList.toggle("off", !ok);
    else el.disabled = !ok;
  }
  for (const el of document.querySelectorAll("[data-dim]")) {
    el.style.opacity = settings[el.dataset.dim] ? 0.5 : "";
  }
}

// ----- Wiring -----
for (const el of document.querySelectorAll("[data-key]")) {
  const key = el.dataset.key;
  const commit = () => {
    const value = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    settings = { ...settings, [key]: value };
    render();
    api.set({ [key]: value }).then(() => toast());
  };
  if (el.type === "range") {
    // Sliders update the label live; interval sliders only save when released.
    el.addEventListener("input", () => {
      const out = document.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = FORMAT[el.dataset.fmt](el.value);
      if (el.dataset.commit !== "change") commit();
    });
    if (el.dataset.commit === "change") el.addEventListener("change", commit);
  } else {
    el.addEventListener("change", commit);
  }
}

document.getElementById("login").addEventListener("change", (e) => {
  api.setLogin(e.target.checked).then((on) => { e.target.checked = on; toast(); });
});
document.getElementById("reset").addEventListener("click", () => {
  if (confirm("Restore all settings to their defaults?")) api.reset().then(() => toast("Defaults restored"));
});
for (const btn of document.querySelectorAll("[data-link]")) {
  btn.addEventListener("click", () => api.openLink(btn.dataset.link));
}
document.getElementById("openData").addEventListener("click", () => api.openDataFolder());
for (const btn of document.querySelectorAll("[data-action]")) {
  btn.addEventListener("click", () => api.action(btn.dataset.action, btn.dataset.arg));
}

api.onChanged((s) => { settings = s; render(); });

api.get().then((info) => {
  settings = info.settings;
  document.getElementById("login").checked = info.loginItem;
  document.getElementById("ver").textContent = `Version ${info.version}`;
  document.getElementById("aboutVer").textContent = info.version;
  document.getElementById("dataPath").textContent = info.settingsPath;
  document.getElementById("aboutTech").textContent = `Electron ${info.versions.electron} · Chromium ${info.versions.chrome} · Node ${info.versions.node}`;
  render();
});

// End-to-end test for the Damu app (both characters). It launches the real app with a throwaway profile and drives it
// through DevTools: poses, walking speed, dialogues, mouse, settings, the character switch and show/hide.
// It sends real mouse events and plays real audio, so leave the machine alone while it runs (a few minutes).
//   npm run test:e2e                                  the source tree
//   DAMU_EXE=C:\path\to\Damu.exe npm run test:e2e     an installed or unpacked build
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(root + "/package.json");
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "damu-app-"));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const flags = ["--disable-gpu", "--remote-debugging-port=9360", `--user-data-dir=${udd}`];
const child = process.env.DAMU_EXE
  ? spawn(process.env.DAMU_EXE, flags, { env, stdio: ["ignore", "pipe", "pipe"] })
  : spawn(require("electron"), [root, ...flags], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + extra : ""}`); };
const section = (t) => console.log(`\n== ${t}`);

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(expression.slice(0, 70) + " :: " + (r.result.exceptionDetails.exception?.description || "").split("\n")[0]);
    return r.result?.result?.value;
  };
  return { call, ev };
}
async function waitFor(fn, timeout = 30000, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  return false;
}

let S, C;
const idle = "(hideBubble(), busy = false, standIdle(), nextAt = Infinity, 0)"; // a still, known state

async function loaded(character) {
  return waitFor(() => C.ev(`cfg.character === '${character}' && Object.keys(poses).length > 0 && typeof content !== 'undefined' && mode !== 'return_walk' && mode !== 'offscreen'`), 90000, 300);
}

try {
  await sleep(7500);
  const targets = await (await fetch("http://127.0.0.1:9360/json")).json();
  S = await connect(targets.find((t) => t.url.includes("settings.html")).webSocketDebuggerUrl);
  C = await connect(targets.find((t) => t.url.includes("companion.html")).webSocketDebuggerUrl);
  await S.ev("settingsApi.set({ offscreenTrips: false, dialoguesEnabled: false })");

  // ------------------------------------------------------------------ Ramanan (the default)
  section("Ramanan: default character");
  check("Ramanan is the default character", (await C.ev("cfg.character")) === "ramanan" && (await S.ev("settingsApi.get().then(r => r.settings.character)")) === "ramanan");
  await loaded("ramanan");
  const pn = await C.ev("Object.keys(poses).sort().join(',')");
  check("10 poses loaded", pn === "angry,apologies,cheer,confused,laughing,looking,looking-up,neutral,nail-look,warning".split(",").sort().join(","), pn);
  check("walk cycle: 8 cross-faded frames", (await C.ev("anims.walk.frames.length")) === 8 && (await C.ev("anims.walk.blend")) === true);
  check("walk uses the character's own stride and grounded frames", (await C.ev("anims.walk.stride")) === 120 && (await C.ev("JSON.stringify(anims.walk.grounded)")) === "[0,7]");
  const greeted = await waitFor(() => C.ev("bubble.style.display === 'flex' && bubbleText.textContent === content.greeting.text"), 45000, 100);
  check("greets with the text from his content.json after walking in", !!greeted, await C.ev("content.greeting.text"));

  section("Ramanan: poses, faces and scale");
  await C.ev(idle);
  const heights = await C.ev(`(() => { const out = {}; for (const n of Object.keys(poses)) { setPose(n, { pop: false }); out[n] = [avatar.offsetHeight, Math.round(DISPLAY_HEIGHT * poses[n].height / poses.neutral.height)]; } return out; })()`);
  const badH = Object.entries(heights).filter(([, [h, want]]) => Math.abs(h - want) > 2);
  check("every pose is shown at the same body scale (neutral = 260px)", badH.length === 0 && heights.neutral[0] === 260, JSON.stringify(Object.fromEntries(Object.entries(heights).map(([k, v]) => [k, v[0]]))));
  const faces = await C.ev(`Promise.all(Object.keys(poses).map(n => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = ASSETS + '/faces/' + n + '.png'; }))).then(a => a.every(Boolean))`);
  check("every pose has a speech-bubble face", faces === true);
  await C.ev(idle);

  section("Walking: constant speed, smooth, light");
  await S.ev("settingsApi.set({ walkSpeed: 1.3 })");
  const top = await C.ev("WALK_SPEED");
  const measure = async (ms) => {
    await C.ev(`(${idle.slice(1, -1).replace(", 0", "")}, x = innerWidth / 2, targetDir = 1, facingScale = 1, startWalk(), targetDir = 1, facingScale = 1, nextAt = Infinity, 0)`);
    await sleep(1500);
    const t0 = Date.now(); let prev = await C.ev("x"), dist = 0;
    while (Date.now() - t0 < ms) { await sleep(150); const nx = await C.ev("x"); dist += Math.abs(nx - prev); prev = nx; }
    return dist / ((Date.now() - t0) / 1000);
  };
  const normal = await measure(3500);
  check("normal walking speed is the configured speed", Math.abs(normal / top - 1) < 0.08, `${normal.toFixed(0)} of ${top.toFixed(0)} px/s`);
  await C.call("Emulation.setCPUThrottlingRate", { rate: 6 });
  const slow = await measure(3500);
  await C.call("Emulation.setCPUThrottlingRate", { rate: 1 });
  check("speed does not change when the PC is busy (CPU x6)", Math.abs(slow / top - 1) < 0.1, `${slow.toFixed(0)} px/s`);
  check("no speed-boost sprint any more", (await C.ev("typeof RUN_BOOST === 'undefined' && typeof runUntil === 'undefined' && !FUN_ACTIONS.includes('run')")) === true);
  check("walking height matches the standing height", Math.abs((await C.ev("avatar.offsetHeight")) - 260) <= 3, String(await C.ev("avatar.offsetHeight")));
  const rate = async (ms) => { const seen = new Set(); const t0 = Date.now(); while (Date.now() - t0 < ms) { seen.add(await C.ev("lastFrameTime")); await sleep(8); } return seen.size / (ms / 1000); };
  const walkFps = await rate(1500);
  await C.ev(idle);
  await sleep(300);
  const standFps = await rate(1500);
  check("walking renders smoothly (about 60 fps)", walkFps >= 40, `${walkFps.toFixed(0)} fps`);
  check("standing still renders at about half that (light on CPU)", standFps >= 15 && standFps <= 40, `${standFps.toFixed(0)} fps`);

  section("Ramanan: dialogues and fun moves");
  await S.ev("settingsApi.action('dialogue-now')");
  const shown = await waitFor(() => C.ev("busy && bubble.style.display === 'flex' && bubbleRow.querySelectorAll('button').length === 1"), 25000);
  const texts = JSON.parse(await C.ev("JSON.stringify(content.dialogues.map(d => d.text))"));
  check("Dialogue now shows one of his dialogues with an OK button", !!shown && texts.includes(await C.ev("bubbleText.textContent")));
  check("the face in the bubble loads", (await C.ev("faceImg.complete && faceImg.naturalWidth > 0")) === true);
  await C.ev("bubbleRow.querySelector('button').click()");
  check("OK closes it and he carries on", (await waitFor(() => C.ev("!busy && bubble.style.display === 'none'"), 3000)) !== false);
  for (const act of ["cheer", "spin"]) {
    await C.ev(`(${idle.slice(1, -1).replace(", 0", "")}, funAction('${act}'), 0)`);
    let hopped = false, flips = 0, lastDir = await C.ev("targetDir"), settled = false, sawCheerPose = false;
    for (let i = 0; i < 60 && !settled; i++) {
      await sleep(150);
      const st = JSON.parse(await C.ev("JSON.stringify({ hop: !!jump, dir: targetDir, mode, anim: !!anim, pose: currentPose })"));
      hopped ||= st.hop; sawCheerPose ||= st.pose === "cheer"; if (st.dir !== lastDir) { flips++; lastDir = st.dir; }
      settled = i > 6 && !st.hop && st.mode === "stand" && !st.anim && (await C.ev("nextAt")) < Infinity;
    }
    check(`fun move "${act}" plays and he settles (cheer picture is for the greeting only)`, settled && !sawCheerPose && (act === "cheer" ? hopped : flips >= 3), act === "cheer" ? `hopped=${hopped}` : `turned ${flips}x`);
  }
  await C.ev(idle);

  section("Mouse: click, double-click, drag");
  const point = () => C.ev("(() => { const r = avatar.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.45) }; })()");
  const mouse = (type, x, y, extra = {}) => C.call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  await C.ev(idle);
  const hit = await C.ev("(() => { const r = avatar.getBoundingClientRect(); const mk = (x, y) => ({ clientX: x, clientY: y, target: document.body }); return { body: isOpaque(mk(r.left + r.width / 2, r.top + r.height * 0.4)), corner: isOpaque(mk(r.left + 3, r.top + 3)) }; })()");
  check("click-through: solid on his body, transparent in the corner of his box", hit.body === true && hit.corner === false, JSON.stringify(hit));
  let p = await point();
  await mouse("mousePressed", p.x, p.y); await mouse("mouseReleased", p.x, p.y);
  await sleep(700);
  check("single click: looking pose and a line from his content", (await C.ev("currentPose")) === "looking" && (await C.ev("bubble.style.display === 'flex'")) === true);
  await C.ev(idle); p = await point();
  await mouse("mousePressed", p.x, p.y); await mouse("mouseReleased", p.x, p.y); await sleep(60);
  await mouse("mousePressed", p.x, p.y, { clickCount: 2 }); await mouse("mouseReleased", p.x, p.y, { clickCount: 2 });
  await sleep(500);
  check("double click: angry pose", (await C.ev("currentPose")) === "angry");
  await C.ev(idle); await sleep(2900); await C.ev(idle); p = await point();
  const x0 = await C.ev("x");
  await mouse("mousePressed", p.x, p.y);
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", p.x - i * 14, p.y, { buttons: 1 }); await sleep(30); }
  check("dragging picks him up and moves him", (await C.ev("dragging")) === true && (await C.ev("x")) < x0 - 60);
  await mouse("mouseReleased", p.x - 112, p.y);
  await sleep(300);
  check("dropping puts him down", (await C.ev("!dragging && mode === 'stand'")) === true);
  await C.ev(idle);

  section("Settings: speed, size, ranges, saving");
  await S.ev("settingsApi.set({ walkSpeed: 2, size: 1.5, volume: 0.3 })");
  await sleep(400);
  check("walk speed, size and volume apply live", Math.abs((await C.ev("WALK_SPEED")) - 184) < 0.01 && (await C.ev("DISPLAY_HEIGHT")) === 390 && Math.abs((await C.ev("masterGain.gain.value")) - 0.3) < 0.001);
  await S.ev("settingsApi.set({ walkSpeed: 1.3, size: 1, volume: 0.8 })");
  const clamped = await S.ev("settingsApi.set({ visitMinutes: 99999, walkSpeed: -5, bogus: 1, character: '../evil' })");
  check("out-of-range values are clamped; unknown keys and a bad character are rejected", clamped.visitMinutes === 240 && clamped.walkSpeed === 0.4 && !("bogus" in clamped) && clamped.character === "ramanan", JSON.stringify({ v: clamped.visitMinutes, s: clamped.walkSpeed, c: clamped.character }));
  await S.ev("settingsApi.set({ visitMinutes: 10, walkSpeed: 1.3 })");
  await sleep(600); // the file is written a moment after the last change
  const saved = JSON.parse(fs.readFileSync(path.join(udd, "settings.json"), "utf8"));
  check("settings (including the character) are saved to disk", saved.character === "ramanan" && saved.visitMinutes === 10);

  // ------------------------------------------------------------------ switching characters from Settings
  section("Character switch (Settings window)");
  const cards = JSON.parse(await S.ev("JSON.stringify([...document.querySelectorAll('#chars .char')].map(b => ({ id: b.dataset.id, name: b.textContent.trim(), on: b.getAttribute('aria-checked'), face: b.querySelector('img').complete && b.querySelector('img').naturalWidth > 0 })))"));
  check("Settings shows a card for each character, Ramanan selected", cards.length === 2 && cards[0].id === "ramanan" && cards[0].on === "true" && cards[1].id === "damu" && cards[1].on === "false" && cards.every((c) => c.face), JSON.stringify(cards.map((c) => c.name + ":" + c.on)));
  await S.ev("document.querySelector('#chars .char[data-id=damu]').click()");
  const gotDamu = await loaded("damu");
  check("clicking Damu switches the character live", !!gotDamu && (await C.ev("Object.keys(poses).length")) === 7 && (await C.ev("anims.walk.frames.length")) === 16);
  await sleep(600);
  check("the saved setting follows", JSON.parse(fs.readFileSync(path.join(udd, "settings.json"), "utf8")).character === "damu");
  check("the Settings card follows too", (await S.ev("document.querySelector('#chars .char[data-id=damu]').getAttribute('aria-checked')")) === "true");
  await waitFor(() => C.ev("bubble.style.display === 'flex'"), 45000, 150);

  // ------------------------------------------------------------------ Damu regression
  section("Damu: still works (voice, mouse sounds, walking)");
  await S.ev("settingsApi.set({ offscreenTrips: false, dialoguesEnabled: false })");
  await C.ev(idle);
  check("audio clips load when first needed (not all at start-up)", (await C.ev("Object.keys(clips).length")) < (await C.ev("audioNames().length")));
  await C.ev("lastClip = ''");
  await S.ev("settingsApi.action('dialogue-now')");
  await waitFor(() => C.ev("busy && bubble.style.display === 'flex'"), 25000);
  const dl = await waitFor(() => C.ev("lastClip !== '' && nowPlaying !== null"), 4000);
  const expected = await C.ev("content.dialogues.find(d => d.audio === lastClip)?.text");
  check("a dialogue plays its own voice clip and shows its own text", !!dl && expected === (await C.ev("bubbleText.textContent")), String(await C.ev("lastClip")));
  await C.ev("bubbleRow.querySelector('button').click()");
  check("OK plays the acknowledgement clip", !!(await waitFor(() => C.ev("lastClip === 'promise'"), 4000)));
  await C.ev(idle); await sleep(2800); await C.ev(idle);
  await C.ev("lastClip = ''");
  p = await point();
  await mouse("mousePressed", p.x, p.y); await mouse("mouseReleased", p.x, p.y);
  const clickPool = await C.ev("content.mouse.click.map(e => e.audio)");
  check("click plays a click voice clip", !!(await waitFor(async () => clickPool.includes(await C.ev("lastClip")), 4000)), String(await C.ev("lastClip")));
  check("Damu's walk is unchanged: 16 frames, no cross-fade", (await C.ev("anims.walk.frames.length")) === 16 && (await C.ev("anims.walk.blend")) === false);
  await C.ev(idle);
  const dn = await measure(3500);
  check("Damu walks at the configured speed too", Math.abs(dn / (await C.ev("WALK_SPEED")) - 1) < 0.08, `${dn.toFixed(0)} px/s`);
  await C.ev(idle);

  section("Show / hide the companion");
  await S.ev("settingsApi.set({ visible: false })");
  check("he walks off the screen", !!(await waitFor(async () => (await C.ev("mode")) === "offscreen", 60000, 300)));
  await sleep(600);
  check("overlay hides; avatar hidden", (await C.ev("document.visibilityState")) === "hidden" && (await C.ev("avatar.style.visibility")) === "hidden");
  await sleep(1200);
  const parkedFps = await rate(2000);
  check("while parked off-screen he costs almost nothing (about 4 fps)", parkedFps <= 8, `${parkedFps.toFixed(1)} fps`);
  await S.ev("settingsApi.set({ visible: true })");
  await sleep(800);
  check("shows again and walks in", (await C.ev("document.visibilityState")) === "visible" && (await C.ev("mode")) === "return_walk");
  const back = await waitFor(async () => { const m = await C.ev("mode"); return m !== "return_walk" && m !== "offscreen"; }, 60000, 300);
  const xNow = await C.ev("x"), iw = await C.ev("window.innerWidth");
  check("arrives fully on screen", back && xNow > 60 && xNow < iw - 60, `x=${Math.round(xNow)}/${iw}`);

  section("Regression tests for bugs found in review");
  await C.ev(idle);
  check("a bubble timing out mid-drag no longer drops the mouse capture", (await C.ev("(() => { overUi = true; dragging = true; hideBubble(); const kept = overUi; dragging = false; overUi = false; return kept; })()")) === true);
  check(
    "a job waiting for an animation survives that animation being interrupted",
    (await C.ev(`new Promise((res) => {
      let ran = false;
      anim = { a: anims.idle || anims.walk, start: 0, loop: false, speed: 1, onDone: null, lastIdx: 0 };
      mode = "anim";
      whenSettled(() => { ran = true; });
      anim = null; standIdle(); nextAt = Infinity; // interrupted instead of finishing
      setTimeout(() => res(ran), 400);
    })`)) === true
  );
  check(
    "a dialogue without text is dropped when the content loads, so it cannot freeze him",
    (await C.ev(`(async () => {
      const keep = window.fetch, saved = content;
      window.fetch = async () => ({ json: async () => ({ dialogues: [{ audio: "only-audio" }, { text: "hi" }] }) });
      await loadContent();
      const n = content.dialogues.length, only = content.dialogues[0].text;
      window.fetch = keep; content = saved;
      return n === 1 && only === "hi";
    })()`)) === true
  );
  const proto = await S.ev(`settingsApi.set(JSON.parse('{"__proto__":1,"constructor":2,"toString":3,"walkSpeed":1.3}')).then((r) => typeof r.walkSpeed === "number" && r.walkSpeed === 1.3).catch(() => false)`);
  check("settings with inherited keys (__proto__, constructor, toString) cannot crash the app", proto === true);
  await C.ev(idle);

  section("Errors");
  const errs = log.split("\n").filter((l) => /\[renderer:3\]|\[protocol\]|load-fail|Uncaught|TypeError|ReferenceError/.test(l));
  check("no console errors, 404s or exceptions in the whole run", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (e) {
  console.log("TEST ERROR:", e.message);
  fail++;
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  child.kill();
  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  await sleep(500);
  process.exit(fail ? 1 : 0);
}

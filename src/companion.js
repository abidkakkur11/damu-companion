const avatar = document.getElementById("avatar");
const canvas = document.getElementById("sprite");
const ctx = canvas.getContext("2d"); // the visible sprite: GPU-accelerated, so cross-fading every frame is cheap
// A tiny second canvas for click-through hit tests. Reading pixels back from the visible canvas would force it
// into slow software mode, so the hit test reads this one, which is redrawn only when the picture changes.
const hitCanvas = document.createElement("canvas");
const hitCtx = hitCanvas.getContext("2d", { willReadFrequently: true });
const HIT_WIDTH = 96;
function drawHit(bmp) {
  const h = Math.max(1, Math.round((HIT_WIDTH * bmp.height) / bmp.width));
  if (hitCanvas.width !== HIT_WIDTH || hitCanvas.height !== h) {
    hitCanvas.width = HIT_WIDTH;
    hitCanvas.height = h;
  } else {
    hitCtx.clearRect(0, 0, HIT_WIDTH, h);
  }
  hitCtx.drawImage(bmp, 0, 0, HIT_WIDTH, h);
}
const bubble = document.getElementById("bubble");
const bubbleText = document.getElementById("text");
const bubbleRow = document.getElementById("row");
const faceImg = document.getElementById("faceImg");

let ASSETS = "../assets/characters/damu"; // set from the chosen character at start-up

// Walking simulation parameters calibrated for realistic human stride
const BASE_WALK_SPEED = 92; // px/s on desktop (casual stroll)
const BASE_STRIDE_DISTANCE = 122; // px traveled per 16-frame cycle on screen
const BASE_WALK_ACCEL = 260; // px/s² smooth acceleration
const BASE_WALK_DECEL = 320; // px/s² smooth deceleration
const BASE_DISPLAY_HEIGHT = 260; // on-screen height in CSS px at size 1.0
const ANIM_BOOST = 1.5; // frame animations play this much faster than authored

// User settings (pushed from the main process; see applySettings)
let cfg = {
  character: "ramanan", visible: true, dialoguesEnabled: true, walkSpeed: 1.3, size: 1, offscreenTrips: true,
  audioEnabled: true, volume: 0.8, soundDialogues: true, soundReactions: true,
};
// Derived values: speed scales the walk, size scales the sprite and its stride so feet never slide.
let WALK_SPEED = BASE_WALK_SPEED;
let WALK_ACCEL = BASE_WALK_ACCEL;
let WALK_DECEL = BASE_WALK_DECEL;
let STRIDE_DISTANCE = BASE_STRIDE_DISTANCE;
let DISPLAY_HEIGHT = BASE_DISPLAY_HEIGHT;

// Activity durations [min, max] seconds
const STAND_FOR = [3, 7];
const WALK_FOR = [3, 7];
const NAIL_LOOK_FOR = [3, 6];
const LOOKING_FOR = [3, 6];
const LOOKING_UP_FOR = [3, 5];
const OFFSCREEN_AWAY_FOR = [10, 20]; // seconds Damu stays away outside the screen
const DIALOGUE_TIMEOUT = 180_000; // an unanswered dialogue is dismissed after this long

const DIALOGUE_POSES = ["looking-up", "warning", "nail-look", "looking"];
const FUN_ACTIONS = ["cheer", "spin"];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = ([lo, hi]) => (lo + Math.random() * (hi - lo)) * 1000;

// Never the same item twice in a row for a given key.
const lastPicked = {};
function pickNoRepeat(list, key) {
  if (!list.length) return null;
  const fresh = list.length > 1 ? list.filter((item) => item !== lastPicked[key]) : list;
  return (lastPicked[key] = pick(fresh));
}

// ----- Content (assets/characters/<id>/content.json): everything the character says and plays -----
let content = { greeting: null, goodbye: null, dialogues: [], ok: { label: "OK", audio: [] }, mouse: {} };

async function loadContent() {
  let raw = {};
  try {
    raw = await (await fetch(`${ASSETS}/content.json`)).json();
  } catch (err) {
    console.error("Failed to load content.json:", err);
  }
  const entry = (e) => (typeof e === "string" ? { text: e } : { text: e?.text || "", audio: e?.audio || "", pose: e?.pose, action: e?.action });
  const list = (l) => (Array.isArray(l) ? l : []).map(entry);
  content = {
    greeting: raw.greeting ? entry(raw.greeting) : null,
    goodbye: raw.goodbye ? entry(raw.goodbye) : null,
    dialogues: list(raw.dialogues).filter((d) => d.text), // the bubble carries the OK button, so a dialogue needs text
    ok: { label: raw.ok?.label || "OK", audio: [].concat(raw.ok?.audio || []) },
    mouse: {
      click: list(raw.mouse?.click), dblclick: list(raw.mouse?.dblclick),
      dragStart: list(raw.mouse?.dragStart), drop: list(raw.mouse?.drop), hover: list(raw.mouse?.hover),
    },
  };
}

// Loaded poses: name -> { bitmap, width, height, aspect }
let poses = {};
let currentPose = "neutral";

// Frame animations from <character>/anim: name -> { frames: ImageBitmap[], width, height, fps, loop, stride, grounded, blend }
const anims = {};
let walkBitmaps = []; // alias of anims.walk.frames
const walkInfo = { width: 215, height: 438, aspect: 215 / 438, fps: 12 };
let walkCycleProgress = 0; // 0.0 to 1.0 (loops seamlessly)
let currentWalkSpeed = 0; // instantaneous speed in px/s
let walkStopping = false; // true when decelerating into a stop
let lastWalkFrameIdx = -1;

// Currently playing frame animation: { a, start, reverse, loop, speed, onDone, lastIdx }
let anim = null;
let actionToken = 1; // bumped to cancel timers belonging to an interrupted fun move

// Offscreen excursion state
let isExiting = false; // true when walking out past screen border
let returnAt = 0; // timestamp when Damu starts returning
let returnTargetX = 0; // landing X coordinate on screen
let pending = null; // { run } - something to do the moment Damu is back on screen
let leaving = false; // true while walking out because the companion was switched off

const isTravelling = () => mode === "return_walk" || (mode === "walk" && isExiting);
// Anything that needs Damu on screen while he is away or mid-trip waits for him to arrive.
function summon(job) {
  pending = job;
  if (mode === "offscreen") startReturnWalk(performance.now());
}

// Transform & positioning state
let x = 400; // horizontal center
let targetDir = 1; // 1 = facing right, -1 = facing left
let facingScale = 1; // smoothly transitions between -1.0 and 1.0 during pivot turns
let dir = 1; // legacy alias for compatibility
let mode = "stand"; // stand | walk | offscreen | return_walk | anim | hover_nail | nail_look | looking | looking_up
let nextAt = 0;
let busy = false; // a dialogue is waiting for the user's OK
let dragging = false;
let overUi = false;
let bubbleTimer = null;
let dialogueTimer = null;

// Animation simulation state
let angryUntil = 0;
let jump = null; // { start, duration, height }
let landBounce = null; // { start }
let posePop = null; // { start }
let lastFrameTime = performance.now();

let lastHoverSound = 0;

// ----- Asset Loading -----
const bitmapCache = new Map();
async function loadBitmap(url) {
  if (!bitmapCache.has(url)) {
    bitmapCache.set(url, fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  }
  return bitmapCache.get(url);
}

async function load() {
  // 1. Static poses (in parallel; two poses may share one picture)
  const manifest = await (await fetch(`${ASSETS}/poses/manifest.json`)).json();
  await Promise.all(Object.entries(manifest.poses).map(async ([name, info]) => {
    poses[name] = { bitmap: await loadBitmap(`${ASSETS}/${info.webp}`), width: info.width, height: info.height, aspect: info.aspect };
  }));

  // 2. Frame animations (walk, idle)
  try {
    const animManifest = await (await fetch(`${ASSETS}/anim/manifest.json`)).json();
    for (const [name, cfgAnim] of Object.entries(animManifest.animations || {})) {
      const frames = await Promise.all(cfgAnim.frames.map((fp) => loadBitmap(`${ASSETS}/anim/${fp}`)));
      anims[name] = {
        frames, width: cfgAnim.width, height: cfgAnim.height, fps: cfgAnim.fps || 12, loop: !!cfgAnim.loop,
        stride: cfgAnim.stride, grounded: cfgAnim.grounded, blend: !!cfgAnim.blend,
      };
    }
    if (anims.walk) {
      walkBitmaps = anims.walk.frames;
      walkInfo.width = anims.walk.width;
      walkInfo.height = anims.walk.height;
      walkInfo.aspect = walkInfo.width / walkInfo.height;
      walkInfo.fps = anims.walk.fps;
    }
    console.log(`[companion] Loaded animations: ${Object.keys(anims).map((n) => `${n}(${anims[n].frames.length})`).join(", ")}`);
  } catch (err) {
    console.error("Failed to load animation frames:", err);
  }
}

// ----- Pose Switching & Canvas Rendering -----
function setPose(name, { pop = true } = {}) {
  if (!poses[name]) return;
  // Showing a pose cancels any frame animation and halts the walk
  if (anim) {
    anim = null;
    if (mode === "anim") mode = "stand";
  }
  if (mode === "walk" || walkStopping) {
    mode = "stand";
    walkStopping = false;
    currentWalkSpeed = 0;
    lastWalkFrameIdx = -1;
  }
  if (currentPose !== name && pop) {
    posePop = { start: performance.now() };
  }
  currentPose = name;
  renderCurrentPose();
}

function sizeAvatar(w, h) {
  if (avatar.style.width !== w + "px" || avatar.style.height !== h + "px") {
    avatar.style.width = w + "px";
    avatar.style.height = h + "px";
  }
}

function renderCurrentPose() {
  const p = poses[currentPose];
  if (!p) return;

  if (canvas.width !== p.width || canvas.height !== p.height) {
    canvas.width = p.width;
    canvas.height = p.height;
  }
  // Every pose is shown at the neutral pose's body scale, so a taller picture (arms up) is taller on screen
  const h = Math.round((DISPLAY_HEIGHT * p.height) / (poses.neutral?.height || p.height));
  sizeAvatar(Math.round(h * p.aspect), h);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(p.bitmap, 0, 0);
  hitFrame = p.bitmap;
  drawHit(p.bitmap);
}

// All frame animations share one scale (the walk cycle's), so the character never changes size between them.
// With next/f the frame is cross-faded into the next one, which makes a short walk cycle look smooth.
let hitFrame = null; // the picture the hit mask currently shows
function renderAnimFrame(a, idx, next = -1, f = 0) {
  const bmp = a.frames[idx];
  if (!bmp) return;
  if (canvas.width !== a.width || canvas.height !== a.height) {
    canvas.width = a.width;
    canvas.height = a.height;
  }
  const s = DISPLAY_HEIGHT / walkInfo.height;
  sizeAvatar(Math.round(a.width * s), Math.round(a.height * s));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (hitFrame !== bmp) {
    hitFrame = bmp;
    drawHit(bmp);
  }
  if (next < 0 || f < 0.04) {
    ctx.drawImage(bmp, 0, 0);
    return;
  }
  ctx.globalAlpha = 1 - f;
  ctx.drawImage(bmp, 0, 0);
  ctx.globalAlpha = f;
  ctx.drawImage(a.frames[next], 0, 0);
  ctx.globalAlpha = 1;
}

function renderWalkFrame(frameIdx) {
  if (anims.walk) renderAnimFrame(anims.walk, frameIdx % anims.walk.frames.length);
}

// Redraw whatever is on screen (after a size change)
function rerender() {
  if (anim) renderAnimFrame(anim.a, Math.max(0, anim.lastIdx));
  else if (walkBitmaps.length && (mode === "walk" || mode === "return_walk" || walkStopping)) renderWalkFrame(Math.max(0, lastWalkFrameIdx));
  else renderCurrentPose();
}

// ----- Frame animations (idle) -----
function playAnim(name, { reverse = false, loop = false, speed = 1, onDone = null, modeName = "anim" } = {}) {
  const a = anims[name];
  if (!a) {
    onDone?.();
    return false;
  }
  mode = modeName;
  walkStopping = false;
  currentWalkSpeed = 0;
  isExiting = false;
  anim = { a, start: performance.now(), reverse, loop, speed, onDone, lastIdx: -1 };
  return true;
}

function updateAnim(now) {
  const n = anim.a.frames.length;
  const i = Math.floor(((now - anim.start) / 1000) * anim.a.fps * ANIM_BOOST * anim.speed);
  if (!anim.loop && i >= n) {
    const done = anim.onDone;
    anim = null;
    done?.();
    return;
  }
  const step = anim.loop ? i % n : i;
  const idx = anim.reverse ? n - 1 - step : step;
  if (idx !== anim.lastIdx) {
    anim.lastIdx = idx;
    renderAnimFrame(anim.a, idx);
  }
}

// Run fn once any one-shot animation is over. The frame loop flushes the queue, so a job is never lost when the
// animation is interrupted (a click, a pose change) instead of finishing.
const settledJobs = [];
function whenSettled(fn) {
  if (anim && !anim.loop) settledJobs.push(fn);
  else fn();
}

// ----- Activities & AI Decisions -----
function standIdle() {
  mode = "stand";
  anim = null;
  walkStopping = false;
  isExiting = false;
  currentWalkSpeed = 0;
  lastWalkFrameIdx = -1;
  setPose("neutral", { pop: false });
  nextAt = performance.now() + rand(STAND_FOR);
}

function startWalk() {
  mode = "walk";
  anim = null;
  walkStopping = false;
  isExiting = false;
  lastWalkFrameIdx = -1;
  // Turn away from screen edges if near margin
  const margin = 140;
  if (x < margin) {
    targetDir = 1;
  } else if (x > window.innerWidth - margin) {
    targetDir = -1;
  } else {
    targetDir = Math.random() < 0.5 ? -1 : 1;
  }
  dir = targetDir;
  nextAt = performance.now() + rand(WALK_FOR);
}

// Walk all the way off-screen
function startOffscreenWalk() {
  mode = "walk";
  anim = null;
  isExiting = true;
  walkStopping = false;
  lastWalkFrameIdx = -1;
  // Walk towards nearest screen edge
  if (x < window.innerWidth * 0.45) {
    targetDir = -1;
  } else if (x > window.innerWidth * 0.55) {
    targetDir = 1;
  } else {
    targetDir = Math.random() < 0.5 ? -1 : 1;
  }
  dir = targetDir;
  nextAt = Infinity; // won't interrupt until completely exited
}

// Walk back into the screen from outside
function startReturnWalk(now, fromLeft = Math.random() < 0.5) {
  mode = "return_walk";
  anim = null;
  isExiting = false;
  walkStopping = false;
  currentWalkSpeed = 0;
  lastWalkFrameIdx = -1;
  setPose("neutral", { pop: false }); // size the sprite before measuring it
  const half = W() / 2;

  if (fromLeft) {
    x = -half - 40;
    targetDir = 1;
  } else {
    x = window.innerWidth + half + 40;
    targetDir = -1;
  }
  avatar.style.visibility = "visible";
  facingScale = targetDir;
  dir = targetDir;

  // Choose landing spot in comfortable desktop viewing area
  returnTargetX = Math.round(window.innerWidth * (0.28 + Math.random() * 0.44));
  nextAt = Infinity;
}

// Triggered when Damu finishes walking back onto the screen
function onDamuReturned() {
  standIdle();
  if (pending) {
    const job = pending;
    pending = null;
    job.run();
    return;
  }
  // Back from a casual trip: a quick hello pose
  setPose(pick(["looking", "nail-look"]));
  doHop(14, 0.3);
}

function inspectNails() {
  mode = "nail_look";
  setPose("nail-look");
  nextAt = performance.now() + rand(NAIL_LOOK_FOR);
}

function peerAtScreen() {
  mode = "looking";
  setPose("looking");
  nextAt = performance.now() + rand(LOOKING_FOR);
}

function stretchNeck() {
  mode = "looking_up";
  setPose("looking-up");
  nextAt = performance.now() + rand(LOOKING_UP_FOR);
}

// Idle animation: a short lively stand
function playIdleAnim() {
  nextAt = Infinity;
  const ok = playAnim("idle", { loop: false, onDone: standIdle });
  if (!ok) standIdle();
}

function decide(now) {
  if (busy || dragging || angryUntil > now || mode === "offscreen") return;
  if (mode === "anim") {
    if (!anim) standIdle(); // an animation ended without choosing what comes next
    return;
  }
  if (now < nextAt) return;

  if (mode === "walk") {
    // Settle gracefully into stand after in-screen walking
    walkStopping = true;
    return;
  }

  // Choose next activity:
  const r = Math.random();
  if (r < 0.14 && cfg.offscreenTrips) {
    startOffscreenWalk();
  } else if (r < 0.26) {
    playIdleAnim();
  } else if (r < 0.56) {
    startWalk();
  } else if (r < 0.71) {
    inspectNails();
  } else if (r < 0.85) {
    peerAtScreen();
  } else if (r < 0.95) {
    stretchNeck();
  } else {
    standIdle();
  }
}

// ----- Startle Hop / Celebration Animation -----
function doHop(height = 24, duration = 0.38) {
  jump = { start: performance.now(), duration, height };
}

// ----- Layout & Bubble Placement -----
const W = () => avatar.offsetWidth;

function place() {
  avatar.style.left = (x - W() / 2) + "px";
  if (bubble.style.display === "flex") {
    const bw = bubble.offsetWidth;
    const bx = Math.min(Math.max(8, x - bw / 2), window.innerWidth - bw - 8);
    bubble.style.left = bx + "px";
    bubble.style.bottom = (avatar.offsetHeight + 24) + "px";
    bubble.style.setProperty("--tail", (x - bx) + "px");
  }
}

function say(text, { face = "neutral", buttons, ms = 5000 } = {}) {
  if (!text) return;
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  bubbleRow.textContent = "";
  faceImg.src = `${ASSETS}/faces/${face}.png`;

  for (const b of buttons ?? []) {
    const el = document.createElement("button");
    el.textContent = b.label;
    if (b.alt) el.className = "alt";
    el.onclick = () => {
      hideBubble();
      b.onClick?.();
    };
    bubbleRow.appendChild(el);
  }

  bubble.style.display = "flex";
  bubble.classList.remove("pop");
  void bubble.offsetWidth; // restart pop animation
  bubble.classList.add("pop");
  place();

  if (!buttons) {
    bubbleTimer = setTimeout(hideBubble, ms);
  }
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubble.style.display = "none";
  if (overUi && !dragging) {
    overUi = false;
    window.damu.setIgnoreMouse(true);
  }
}

// ----- Audio -----
// A clip is fetched and decoded the first time it is needed (not all at start-up), one clip at a time:
// a new clip cuts off the previous one.
const audioCtx = new AudioContext();
const clips = {}; // name -> AudioBuffer
const loading = {}; // name -> Promise<boolean>
let nowPlaying = null;
let lastClip = "";
let wanted = ""; // the newest request, so a slow decode never plays over a later sound

function audioNames() {
  const names = new Set(content.ok.audio);
  for (const e of [content.greeting, content.goodbye, ...content.dialogues, ...Object.values(content.mouse).flat()]) {
    if (e?.audio) names.add(e.audio);
  }
  return [...names].filter(Boolean);
}

function loadClip(name) {
  return (loading[name] ||= (async () => {
    const candidates = /\.\w+$/.test(name) ? [name] : [`${name}.mp3`, `${name}.wav`];
    for (const file of candidates) {
      try {
        const res = await fetch(`${ASSETS}/audio/${file}`);
        if (!res.ok) continue;
        clips[name] = await audioCtx.decodeAudioData(await res.arrayBuffer());
        return true;
      } catch (err) {
        console.error(`Failed to load audio "${file}":`, err);
      }
    }
    console.error(`Audio "${name}" not found`);
    return false;
  })()).then((ok) => {
    if (!ok) delete loading[name]; // allow a retry later
    return ok;
  });
}

const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);

function stopAudio() {
  wanted = "";
  try { nowPlaying?.stop(); } catch {}
  nowPlaying = null;
}

function start(name) {
  lastClip = name;
  try { nowPlaying?.stop(); } catch {}
  if (audioCtx.state === "suspended") audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = clips[name];
  src.connect(masterGain);
  src.onended = () => { if (nowPlaying === src) nowPlaying = null; };
  src.start();
  nowPlaying = src;
}

// Plays one clip by name. group is the Settings switch that must be on (cfg key).
function playClip(name, group) {
  if (!name || !cfg.audioEnabled || !cfg[group]) return false;
  wanted = name;
  if (clips[name]) start(name);
  else loadClip(name).then((ok) => { if (ok && wanted === name && cfg.audioEnabled) start(name); });
  return true;
}

// ----- Dialogues -----
function faceFor(pose) {
  return pose;
}

// Damu has come to you: he shows a dialogue (text + its audio) and waits for OK.
function showDialogue({ force = false } = {}) {
  const entry = pickNoRepeat(content.dialogues, "dialogue");
  if (!entry || busy || !cfg.visible || (!force && !cfg.dialoguesEnabled)) return;

  busy = true;
  nextAt = Infinity;
  angryUntil = 0;
  actionToken++;
  const pose = poses[entry.pose] ? entry.pose : pick(DIALOGUE_POSES.filter((p) => poses[p]));
  setPose(pose);
  mode = "stand";
  doHop(18, 0.35);
  say(entry.text, {
    face: faceFor(pose),
    buttons: [{ label: content.ok.label, onClick: () => onOk(entry) }],
  });
  playClip(entry.audio, "soundDialogues");

  clearTimeout(dialogueTimer);
  dialogueTimer = setTimeout(() => {
    if (!busy) return;
    hideBubble();
    busy = false;
    funAction(null);
  }, DIALOGUE_TIMEOUT);
}

// The user pressed OK: acknowledge with another audio, then a fun move.
function onOk(entry) {
  clearTimeout(dialogueTimer);
  busy = false;
  playClip(pick(content.ok.audio), "soundDialogues");
  funAction(entry?.action);
}

// After a fun move he just carries on.
function afterFun() {
  standIdle();
}

function funAction(name) {
  const action = FUN_ACTIONS.includes(name) ? name : pick(FUN_ACTIONS);
  const token = ++actionToken;
  nextAt = Infinity;
  const alive = () => token === actionToken && !busy && !dragging;

  if (action === "spin") {
    // Turn around on the spot a few times
    setPose("neutral");
    let turns = 4;
    const turn = () => {
      if (!alive()) return;
      if (turns-- <= 0) return afterFun();
      targetDir = -targetDir;
      dir = targetDir;
      setTimeout(turn, 420);
    };
    turn();
  } else {
    // Cheer: a few quick hops (in the cheering pose if the character has one)
    setPose(poses.cheer ? "cheer" : "nail-look");
    let hops = 3;
    const hop = () => {
      if (!alive()) return;
      if (hops-- <= 0) return afterFun();
      doHop(30, 0.34);
      setTimeout(hop, 380);
    };
    hop();
  }
}

// Damu comes and delivers a dialogue. The timer fires it on schedule; the "Dialogue now" buttons
// pass manual = true, which works even with dialogues switched off and replaces one that is still open.
function closeOpenDialogue() {
  clearTimeout(dialogueTimer);
  hideBubble();
  busy = false;
}

function visit(manual = false) {
  if (!cfg.visible || !content.dialogues.length) return;
  if (!manual && (!cfg.dialoguesEnabled || busy)) return;
  if (manual && busy) closeOpenDialogue();
  const run = () => showDialogue({ force: manual });
  if (mode === "offscreen" || isTravelling()) {
    summon({ run });
  } else if (dragging) {
    setTimeout(() => visit(manual), 2000);
  } else {
    whenSettled(run);
  }
}

function greet() {
  const g = content.greeting;
  if (!g) return;
  setPose("looking");
  say(g.text, { face: "looking", ms: 5000 });
  playClip(g.audio, "soundDialogues");
}

// ----- Mouse reactions -----
function playEntry(list, key) {
  const entry = pickNoRepeat(list || [], key);
  if (entry) playClip(entry.audio, "soundReactions");
  return entry;
}

function react(kind) {
  if (busy || mode === "offscreen" || isTravelling()) return;
  actionToken++;
  if (mode === "walk" || walkStopping || mode === "hover_nail") {
    mode = "stand";
    walkStopping = false;
    currentWalkSpeed = 0;
  }

  if (kind === "click") {
    // Startled reaction
    setPose("apologies");
    doHop(26, 0.36);
    const entry = playEntry(content.mouse.click, "click");
    say(entry?.text, { face: "apologies", ms: 3500 });
    nextAt = performance.now() + 3000;
  } else if (kind === "dblclick") {
    // Angry clenched fists with tremor
    setPose("angry");
    angryUntil = performance.now() + 2800;
    const entry = playEntry(content.mouse.dblclick, "dblclick");
    say(entry?.text, { face: "angry", ms: 4000 });
    nextAt = performance.now() + 3500;
  }
}

// ----- Window IPC Handlers -----
window.damu.onVisit((manual) => visit(!!manual));
window.damu.onSay(() => {
  if (!cfg.visible || !content.greeting) return;
  if (busy) closeOpenDialogue();
  if (mode === "offscreen" || isTravelling()) {
    if (!pending) summon({ run: greet }); // never displace a waiting dialogue
  } else whenSettled(greet);
});

// ----- Settings -----
function applySettings(s) {
  if (s.character && s.character !== cfg.character) {
    location.reload(); // a different character: start over with his own assets
    return;
  }
  const prevSize = cfg.size;
  cfg = { ...cfg, ...s };
  WALK_SPEED = BASE_WALK_SPEED * cfg.walkSpeed;
  WALK_ACCEL = BASE_WALK_ACCEL * cfg.walkSpeed;
  WALK_DECEL = BASE_WALK_DECEL * cfg.walkSpeed;
  STRIDE_DISTANCE = (anims.walk?.stride || BASE_STRIDE_DISTANCE) * cfg.size;
  DISPLAY_HEIGHT = BASE_DISPLAY_HEIGHT * cfg.size;
  masterGain.gain.value = cfg.volume;
  if (!cfg.audioEnabled) stopAudio();
  if (cfg.size !== prevSize && poses[currentPose]) rerender();
}
window.damu.onSettings(applySettings);
window.damu.onPreviewSound(() => {
  const names = audioNames();
  if (names.length) playClip(pickNoRepeat(names, "preview"), "audioEnabled");
});

// Keep him on screen if the display size changes
addEventListener("resize", () => {
  if (mode === "offscreen" || isTravelling()) return;
  const half = W() / 2;
  x = Math.min(Math.max(half, x), window.innerWidth - half);
});

// Companion switched off: walk out, then let the main process hide the window.
window.damu.onLeave(() => {
  pending = null;
  busy = false;
  dragging = false;
  jump = null;
  angryUntil = 0;
  actionToken++;
  clearTimeout(dialogueTimer);
  hideBubble();
  stopAudio();
  // Say goodbye (text + audio) as he heads out; the clip keeps playing after he is gone.
  const bye = content.goodbye;
  if (bye) {
    if (mode !== "offscreen") say(bye.text, { face: "apologies", ms: 6000 });
    playClip(bye.audio, "soundDialogues");
  }
  if (mode === "offscreen") {
    returnAt = Infinity;
    window.damu.leftScreen();
    return;
  }
  whenSettled(() => {
    if (cfg.visible) return; // switched back on in the meantime
    leaving = true;
    startOffscreenWalk();
  });
});

// Companion switched back on: walk in from a screen edge.
window.damu.onEnter(() => {
  leaving = false;
  const job = { run: greet };
  if (mode === "offscreen") {
    pending = job;
    startReturnWalk(performance.now());
  } else if (isTravelling()) {
    pending = job; // already on his way; greet on arrival
  }
});

// ----- Click-through Pixel Hit-Testing -----
function isOpaque(e) {
  if (bubble.style.display === "flex" && bubble.contains(e.target)) return true;
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return false;

  let px = ((e.clientX - r.left) / r.width) * hitCanvas.width;
  if (facingScale < 0) px = hitCanvas.width - px;
  const py = ((e.clientY - r.top) / r.height) * hitCanvas.height;

  const pixel = hitCtx.getImageData(Math.max(0, Math.min(hitCanvas.width - 1, px | 0)), Math.max(0, Math.min(hitCanvas.height - 1, py | 0)), 1, 1).data;
  return pixel[3] > 24;
}

// Track mouse position and hover hit-testing
window.addEventListener("mousemove", (e) => {
  if (dragging || mode === "offscreen") return;
  const hit = isOpaque(e);
  if (hit !== overUi) {
    overUi = hit;
    window.damu.setIgnoreMouse(!hit);

    // Hover behaviour: nail look when hovered over, return to stand when unhovered
    if (hit) {
      const now = performance.now();
      if (!busy && now - lastHoverSound > 8000 && content.mouse.hover.length) {
        lastHoverSound = now;
        playEntry(content.mouse.hover, "hover");
      }
      if (!busy && angryUntil <= performance.now() && (mode === "stand" || mode === "looking" || mode === "looking_up")) {
        mode = "hover_nail";
        setPose("nail-look");
      }
    } else {
      if (mode === "hover_nail") {
        standIdle();
      }
    }
  }
});

// ----- Drag, Click, and Double Click -----
let clickTimer = null;
let lastDragX = 0;
let dragVelocity = 0;

avatar.addEventListener("mousedown", (e) => {
  if (isTravelling()) return;
  actionToken++;
  if (anim) {
    anim = null;
    mode = "stand";
  }
  if (mode === "walk" || walkStopping || mode === "hover_nail") {
    mode = "stand";
    walkStopping = false;
    currentWalkSpeed = 0;
  }

  const dragOff = e.clientX - x;
  const downX = e.clientX;
  lastDragX = e.clientX;
  dragVelocity = 0;
  let moved = false;
  dragging = true;

  const onMove = (ev) => {
    dragVelocity = ev.clientX - lastDragX;
    lastDragX = ev.clientX;

    if (Math.abs(ev.clientX - downX) > 4 && !moved) {
      moved = true;
      avatar.classList.add("dragging");
      setPose("apologies");
      if (!busy) playEntry(content.mouse.dragStart, "dragStart");
    }
    if (moved) {
      x = Math.min(Math.max(W() / 2, ev.clientX - dragOff), window.innerWidth - W() / 2);
    }
  };

  const onUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    avatar.classList.remove("dragging");

    if (moved) {
      // Landed with a bounce
      landBounce = { start: performance.now() };
      if (!busy) playEntry(content.mouse.drop, "drop");
      standIdle();
      return;
    }

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      react("dblclick");
    } else {
      clickTimer = setTimeout(() => {
        clickTimer = null;
        react("click");
      }, 280);
    }
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});

// ----- Real-Time Animation & Physics Frame Loop -----
let lastTransform = "";

function frame(now) {
  // A character standing still needs ~30 fps and a parked (off-screen) one ~4 fps: this keeps the overlay light.
  const calm = !anim && !jump && !landBounce && !posePop && !dragging && angryUntil <= now &&
    mode !== "walk" && mode !== "return_walk" && !walkStopping;
  const minGap = mode === "offscreen" ? 250 : calm ? 30 : 0;
  if (now - lastFrameTime < minGap) {
    requestAnimationFrame(frame);
    return;
  }
  // Movement is time-based, so speed is the same at any frame rate; the clamp only stops a jump after the PC sleeps.
  const dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  if (settledJobs.length && !(anim && !anim.loop)) settledJobs.splice(0).forEach((job) => job());

  let tfX = 0;
  let tfY = 0;
  let tfRot = 0;
  let tfScaleX = 1;
  let tfScaleY = 1;

  // Handle Off-Screen timer and return
  if (mode === "offscreen") {
    if (now >= returnAt) {
      startReturnWalk(now);
    }
    decide(now);
    place();
    requestAnimationFrame(frame);
    return;
  }

  if (anim) updateAnim(now);

  // Smooth turnaround pivot (walking turns, and the "spin" fun move)
  if (facingScale !== targetDir) {
    const step = 6.8 * dt; // a full turn takes ~0.3s
    facingScale = Math.abs(targetDir - facingScale) <= step ? targetDir : facingScale + Math.sign(targetDir - facingScale) * step;
  }

  // 1. Locomotion / Realistic Walking (Inside screen, Exiting screen, or Returning)
  if (mode === "walk" || walkStopping || mode === "return_walk") {
    const n = walkBitmaps.length || 1;
    // Smooth acceleration or deceleration
    if (walkStopping) {
      currentWalkSpeed = Math.max(0, currentWalkSpeed - WALK_DECEL * dt);
      const curFrame = Math.floor(walkCycleProgress * n) % n;
      // Finish the stride on a grounded frame (feet planted) before standing
      if (currentWalkSpeed < 14 && ((anims.walk?.grounded || [0, 1, 8, 9]).includes(curFrame) || currentWalkSpeed <= 1)) {
        if (mode === "return_walk") onDamuReturned();
        else standIdle();
      }
    } else {
      currentWalkSpeed = Math.min(WALK_SPEED, currentWalkSpeed + WALK_ACCEL * dt);
    }

    const half = W() / 2;

    if (isExiting) {
      // Exiting off-screen: continue walking past screen boundaries
      if ((targetDir < 0 && x < -half - 20) || (targetDir > 0 && x > window.innerWidth + half + 20)) {
        mode = "offscreen";
        isExiting = false;
        currentWalkSpeed = 0;
        avatar.style.visibility = "hidden"; // fully gone, no shadow bleeding at the edge
        // Companion switched off: stay parked and tell the main process the window can hide.
        // Something is waiting for him (a dialogue, "Say hi"): come straight back.
        returnAt = leaving ? Infinity : now + (pending ? 400 : rand(OFFSCREEN_AWAY_FOR));
        if (leaving) {
          leaving = false;
          window.damu.leftScreen();
        }
        hideBubble();
        window.damu.setIgnoreMouse(true);
      }
    } else if (mode === "return_walk") {
      // Returning into screen: start braking in time to stop on the landing spot
      if (!walkStopping) {
        const remaining = (returnTargetX - x) * targetDir;
        const brakeDist = (currentWalkSpeed * currentWalkSpeed) / (2 * WALK_DECEL);
        if (remaining <= brakeDist + 1) walkStopping = true;
      }
    } else {
      // Normal walking: screen boundary turnaround check
      const margin = half + 24;
      if (x <= margin && targetDir < 0) {
        targetDir = 1;
        dir = 1;
      } else if (x >= window.innerWidth - margin && targetDir > 0) {
        targetDir = -1;
        dir = -1;
      }
    }

    // Pivot factor: turning on the spot slows down lateral progress
    const turnFactor = 0.25 + 0.75 * Math.abs(facingScale);
    x += targetDir * (currentWalkSpeed * turnFactor) * dt;

    // Keep avatar strictly inside screen viewport only if not exiting or returning
    if (!isExiting && mode !== "return_walk" && mode !== "offscreen") {
      x = Math.max(half, Math.min(window.innerWidth - half, x));
    }

    // Render synchronized walk frame (zero foot sliding)
    if (walkBitmaps.length > 0 && currentWalkSpeed > 0.05) {
      walkCycleProgress = (walkCycleProgress + ((currentWalkSpeed * turnFactor) / STRIDE_DISTANCE) * dt) % 1.0;
      const pos = walkCycleProgress * n;
      const frameIdx = Math.floor(pos) % n;
      if (anims.walk.blend) {
        // hold each pose a moment, then ease into the next: less time spent half-blended
        const t = Math.min(1, Math.max(0, (pos - Math.floor(pos) - 0.15) / 0.7));
        renderAnimFrame(anims.walk, frameIdx, (frameIdx + 1) % n, t * t * (3 - 2 * t));
        lastWalkFrameIdx = frameIdx;
      } else if (frameIdx !== lastWalkFrameIdx) {
        lastWalkFrameIdx = frameIdx;
        renderWalkFrame(frameIdx);
      }
    }

    // Subtle forward tilt into direction of movement (organic momentum)
    tfRot += targetDir * (currentWalkSpeed / WALK_SPEED) * 1.6;
  } else {
    // 2. Breathing / Micro-Idling (organic life simulation)
    if (mode === "stand" || mode === "nail_look" || mode === "hover_nail" || mode === "looking" || mode === "looking_up") {
      const breath = Math.sin(now * 0.0024);
      tfScaleY += breath * 0.015;
      tfScaleX -= breath * 0.008;
    }
  }

  // 3. Pose Transition Pop (Squash & Stretch transition)
  if (posePop) {
    const elapsed = (now - posePop.start) / 1000;
    if (elapsed < 0.22) {
      const t = elapsed / 0.22;
      const popWave = Math.sin(t * Math.PI) * (1 - t);
      tfScaleY += popWave * 0.07;
      tfScaleX -= popWave * 0.04;
    } else {
      posePop = null;
    }
  }

  // 4. Angry Furious Tremor
  if (angryUntil > now) {
    const progress = Math.min(1, (angryUntil - now) / 600);
    const amp = 3.2 * progress;
    tfX += (Math.random() - 0.5) * amp * 2;
    tfY += (Math.random() - 0.5) * amp;
    tfRot += (Math.random() - 0.5) * amp * 1.5;
  }

  // 5. Startle Hop / Jump Physics
  if (jump) {
    const elapsed = (now - jump.start) / 1000;
    if (elapsed < jump.duration) {
      const t = elapsed / jump.duration;
      // Parabolic arc
      const arc = Math.sin(t * Math.PI);
      tfY -= arc * jump.height;
      if (t < 0.3) {
        tfScaleY += 0.09 * (1 - t / 0.3);
        tfScaleX -= 0.05 * (1 - t / 0.3);
      } else if (t > 0.7) {
        const land = (t - 0.7) / 0.3;
        tfScaleY -= 0.07 * (1 - land);
        tfScaleX += 0.04 * (1 - land);
      }
    } else {
      jump = null;
    }
  }

  // 6. Dragging Inertia & Tilt
  if (dragging) {
    tfRot += Math.max(-14, Math.min(14, dragVelocity * 0.35));
    tfScaleY += 0.05;
    tfScaleX -= 0.03;
  }

  // 7. Landing Bounce
  if (landBounce) {
    const elapsed = (now - landBounce.start) / 1000;
    if (elapsed < 0.35) {
      const decay = Math.exp(-elapsed * 10);
      const bounce = Math.sin(elapsed * 28) * decay;
      tfScaleY += bounce * 0.12;
      tfScaleX -= bounce * 0.08;
    } else {
      landBounce = null;
    }
  }

  decide(now);

  // Apply composite hardware-accelerated transform with smooth facing scale (only when it changed)
  const visualScaleX = Math.sign(facingScale || targetDir || 1) * Math.max(0.12, Math.abs(facingScale));
  const transform = `scaleX(${visualScaleX.toFixed(3)}) translate(${tfX.toFixed(2)}px, ${tfY.toFixed(2)}px) rotate(${tfRot.toFixed(2)}deg) scale(${tfScaleX.toFixed(3)}, ${tfScaleY.toFixed(3)})`;
  if (transform !== lastTransform) {
    avatar.style.transform = transform;
    lastTransform = transform;
  }

  place();
  requestAnimationFrame(frame);
}

// ----- Bootstrap -----
(async () => {
  try {
    const s = await window.damu.getSettings();
    cfg.character = s.character; // the character decides which folder every asset comes from
    ASSETS = `../assets/characters/${s.character}`;
    await Promise.all([load(), loadContent()]);
    console.log(`[companion] ${s.character} loaded. Starting animation loop...`);
    applySettings(s);
    if (!cfg.visible) {
      // Switched off: stay parked off-screen until the companion is enabled.
      setPose("neutral", { pop: false });
      mode = "offscreen";
      returnAt = Infinity;
      x = -500;
      avatar.style.visibility = "hidden";
    } else {
      // Walk in from the right edge instead of popping into existence.
      pending = { run: greet };
      startReturnWalk(performance.now(), false);
      returnTargetX = Math.max(200, window.innerWidth - 320);
    }
    requestAnimationFrame(frame);
  } catch (err) {
    console.error("Failed to load character assets:", err);
  }
})();

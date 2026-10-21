const avatar = document.getElementById("avatar");
const canvas = document.getElementById("sprite");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const bubble = document.getElementById("bubble");
const bubbleText = document.getElementById("text");
const bubbleRow = document.getElementById("row");
const faceImg = document.getElementById("faceImg");

const WALK_SPEED = 120; // px/s - tune so the feet don't slide
const ASSETS = "../assets";

// Seconds, [min, max]: how long he does each thing before choosing the next one.
const STAND_FOR = [6, 14];
const WALK_FOR = [4, 9];
const SIT_FOR = [25, 60];

const LINES = {
  water: ["Time for some water!", "Vellam kudichille? Illenkil ippo kudikku!", "Hydration check - grab a glass!"],
  break: ["Konjam ezhunnettu nadakku, ketto.", "Look away from the screen for 20 seconds.", "Break time! Kaal onnu neettu."],
  chatter: [
    "Entha pani? Njan ivide thanne und, ketto.",
    "Screen-ilekku ithra neram nokkalle, kannu pokum!",
    "Chaya kudikkan neram aayo?",
    "Posture shari aakku, ketto!",
    "Pani okke kazhinjo?",
    "Oru nimisham, kaal onnu neettu.",
    "Njan ivide thanne und, vilichal mathi.",
    "Busy aanallo, alle?",
    "Vellam kudikkaan marakkalle!",
  ],
  click: ["Njan pokoola..!"],
  dblclick: ["Njan pokoolanna alle prnje..!"],
};
const FACES = { chatter: ["normal", "happy", "thinking", "winking"], water: ["happy"], break: ["thinking"], done: ["laughing"], click: ["surprised"], dblclick: ["angry"] };

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = ([lo, hi]) => (lo + Math.random() * (hi - lo)) * 1000;

let anims = {}; // name -> { bitmaps, frames, fps, loop, width, height }
let scale = 0.5; // CSS px per stored px
let x = 400; // horizontal centre of Damu
let dir = 1; // 1 = facing right
let mode = "stand"; // stand | walk | sitting | transition
let cur = null; // { name, start, reverse, speed, onEnd }
let nextAt = 0; // when to choose the next activity
let busy = false; // a reminder bubble with buttons is waiting for the user
let dragging = false;
let overUi = false;
let bubbleTimer = null;

// ----- loading -----
async function load() {
  const manifest = await (await fetch(`${ASSETS}/anim/manifest.json`)).json();
  scale = manifest.displayScale;
  const cache = {};
  const bitmap = (f) => (cache[f] ??= fetch(`${ASSETS}/anim/${f}`).then((r) => r.blob()).then(createImageBitmap));
  for (const [name, a] of Object.entries(manifest.animations)) {
    anims[name] = { ...a, bitmaps: await Promise.all(a.frames.map(bitmap)) };
  }
}

// ----- playback -----
function playLoop(name) {
  if (anims[name]) cur = { name, start: performance.now(), speed: 1 };
}

function playOnce(name, { reverse = false, speed = 1, onEnd } = {}) {
  if (!anims[name]) { onEnd?.(); return; }
  cur = { name, start: performance.now(), reverse, speed, once: true, onEnd };
}

function draw(now) {
  const a = cur && anims[cur.name];
  if (!a) return;
  const n = a.bitmaps.length;
  const k = Math.max(0, Math.floor(((now - cur.start) / 1000) * a.fps * cur.speed));
  let i, done = false;
  if (cur.once) {
    done = k >= n;
    i = cur.reverse ? n - 1 - Math.min(k, n - 1) : Math.min(k, n - 1);
  } else i = k % n;

  if (canvas.width !== a.width || canvas.height !== a.height) { canvas.width = a.width; canvas.height = a.height; }
  avatar.style.width = a.width * scale + "px";
  avatar.style.height = a.height * scale + "px";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a.bitmaps[i], 0, 0);

  if (done && !cur.fired) { // the last frame stays on screen until onEnd picks the next activity
    cur.fired = true;
    cur.onEnd?.();
  }
}

// ----- activities -----
function standIdle() {
  mode = "stand";
  playLoop("idle");
  nextAt = performance.now() + rand(STAND_FOR);
}

function startWalk() {
  mode = "walk";
  dir = Math.random() < 0.5 ? -1 : 1;
  playLoop("walk");
  nextAt = performance.now() + rand(WALK_FOR);
}

function sitDown() {
  if (!anims.sitdown) return standIdle();
  mode = "transition";
  playOnce("sitdown", {
    onEnd: () => {
      mode = "sitting";
      playLoop("sitidle");
      nextAt = busy ? Infinity : performance.now() + rand(SIT_FOR);
    },
  });
}

function standUp(after) {
  if (!anims.sitdown) { standIdle(); after?.(); return; }
  mode = "transition";
  playOnce("sitdown", { reverse: true, onEnd: () => { standIdle(); after?.(); } });
}

function hop(speed = 1, after) {
  if (mode === "sitting" || mode === "transition" || !anims.jump) { after?.(); return; }
  mode = "transition";
  playOnce("jump", { speed, onEnd: () => { standIdle(); after?.(); } });
}

function decide(now) {
  if (now < nextAt || busy || dragging) return;
  if (mode === "walk") return standIdle();
  if (mode === "sitting") return standUp();
  if (mode === "stand") {
    const r = Math.random();
    if (r < 0.5) startWalk();
    else if (r < 0.75) sitDown();
    else standIdle();
  }
}

// ----- layout & bubble -----
const W = () => avatar.offsetWidth;

function place() {
  avatar.style.left = x - W() / 2 + "px";
  if (bubble.style.display === "flex") {
    const bw = bubble.offsetWidth;
    const bx = Math.min(Math.max(8, x - bw / 2), window.innerWidth - bw - 8);
    bubble.style.left = bx + "px";
    bubble.style.bottom = avatar.offsetHeight + 22 + "px";
    bubble.style.setProperty("--tail", x - bx + "px");
  }
}

function say(text, { face = "normal", buttons, ms = 5000 } = {}) {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  bubbleRow.textContent = "";
  faceImg.src = `${ASSETS}/faces/${face}.png`;
  for (const b of buttons ?? []) {
    const el = document.createElement("button");
    el.textContent = b.label;
    if (b.alt) el.className = "alt";
    el.onclick = () => { hideBubble(); b.onClick?.(); };
    bubbleRow.appendChild(el);
  }
  bubble.style.display = "flex";
  bubble.classList.remove("pop");
  void bubble.offsetWidth; // restart the pop-in animation
  bubble.classList.add("pop");
  place();
  if (!buttons) bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubble.style.display = "none";
  if (overUi) { overUi = false; window.damu.setIgnoreMouse(true); }
}

// ----- audio (drop mp3 files into assets/audio; missing files are ignored) -----
function sfx(name) {
  try {
    const a = new Audio(`${ASSETS}/audio/${name}.mp3`);
    a.play().catch(() => {});
  } catch {}
}

// ----- reminders, chatter, reactions -----
function celebrate() {
  busy = false;
  say("Well done!", { face: pick(FACES.done), ms: 2500 });
  hop(1);
}

function remind({ type }) {
  if (busy) return;
  busy = true;
  const later = () => { busy = false; setTimeout(() => remind({ type }), 5 * 60_000); };
  const buttons = type === "break"
    ? [{ label: "Done", onClick: () => (mode === "sitting" ? standUp(celebrate) : celebrate()) },
       { label: "Later", alt: true, onClick: () => (mode === "sitting" ? standUp(later) : later()) }]
    : [{ label: "Drank it", onClick: celebrate }, { label: "Later", alt: true, onClick: later }];
  if (type === "break" && mode !== "sitting") sitDown(); // sit for the break, stand up when dismissed
  else if (type === "water") hop(1);
  nextAt = Infinity;
  say(pick(LINES[type]), { face: pick(FACES[type]), buttons });
}

function chatter() {
  if (busy || dragging) return;
  say(pick(LINES.chatter), { face: pick(FACES.chatter), ms: 6500 });
}

function react(kind) {
  if (busy) return;
  say(pick(LINES[kind]), { face: pick(FACES[kind]), ms: 3500 });
  sfx(kind === "click" ? "pokoola" : "pokoolanna");
  hop(kind === "click" ? 1.6 : 1);
}

window.damu.onRemind(remind);
window.damu.onChatter(chatter);
window.damu.onSay(({ text }) => say(text, { face: "happy" }));

// ----- click-through: only opaque avatar pixels and the bubble capture the mouse -----
function isOpaque(e) {
  if (bubble.style.display === "flex" && bubble.contains(e.target)) return true;
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return false;
  let px = ((e.clientX - r.left) / r.width) * canvas.width;
  if (dir < 0) px = canvas.width - px;
  const py = ((e.clientY - r.top) / r.height) * canvas.height;
  return ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, px | 0)), py | 0, 1, 1).data[3] > 24;
}

window.addEventListener("mousemove", (e) => {
  if (dragging) return;
  const hit = isOpaque(e);
  if (hit !== overUi) { overUi = hit; window.damu.setIgnoreMouse(!hit); }
});

// ----- drag / click / double click -----
let clickTimer = null;
avatar.addEventListener("mousedown", (e) => {
  const dragOff = e.clientX - x, downX = e.clientX;
  let moved = false;
  dragging = true;
  const onMove = (ev) => {
    if (Math.abs(ev.clientX - downX) > 4 && !moved) { moved = true; avatar.classList.add("dragging"); }
    if (moved) x = Math.min(Math.max(W() / 2, ev.clientX - dragOff), window.innerWidth - W() / 2);
  };
  const onUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    avatar.classList.remove("dragging");
    if (moved) { if (mode === "walk") standIdle(); return; }
    if (clickTimer) { // second click within 300ms
      clearTimeout(clickTimer);
      clickTimer = null;
      react("dblclick");
    } else {
      clickTimer = setTimeout(() => { clickTimer = null; react("click"); }, 300);
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});

// ----- main loop -----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (mode === "walk") {
    x += dir * WALK_SPEED * dt;
    const half = W() / 2;
    if (x < half) { x = half; dir = 1; }
    if (x > window.innerWidth - half) { x = window.innerWidth - half; dir = -1; }
  }
  decide(now);

  avatar.style.transform = `scaleX(${dir})`;
  draw(now);
  place();
  requestAnimationFrame(frame);
}

load().then(() => {
  x = Math.max(200, window.innerWidth - 400);
  standIdle();
  requestAnimationFrame(frame);
}).catch((err) => console.error("failed to load animations", err));

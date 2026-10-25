const avatar = document.getElementById("avatar");
const canvas = document.getElementById("sprite");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const bubble = document.getElementById("bubble");
const bubbleText = document.getElementById("text");
const bubbleRow = document.getElementById("row");
const faceImg = document.getElementById("faceImg");

const ASSETS = "../assets";

// Walking simulation parameters calibrated for realistic human stride
const WALK_SPEED = 92; // px/s on desktop (casual stroll)
const STRIDE_DISTANCE = 122; // px traveled per 16-frame cycle on screen (122 / 92 = 1.326s ~ 16 / 12fps)
const WALK_ACCEL = 260; // px/s² smooth acceleration
const WALK_DECEL = 320; // px/s² smooth deceleration
const DISPLAY_HEIGHT = 260; // base on-screen height in CSS px

// Activity durations [min, max] seconds
const STAND_FOR = [6, 12];
const WALK_FOR = [4, 8];
const NAIL_LOOK_FOR = [5, 9];
const LOOKING_FOR = [4, 8];
const LOOKING_UP_FOR = [4, 7];
const OFFSCREEN_AWAY_FOR = [14, 26]; // seconds Damu stays away outside the screen

// ============================================================================
// DIALOGUES & POSES CONFIGURATION
// You can directly edit the lines below to change what Damu says for each pose!
// ============================================================================
const LINES = {
  // Pose: "looking-up" (Looking up parched, asking for water)
  water: [
    "Time for some water!",
    "Vellam kudichille? Illenkil ippo kudikku!",
    "Thondha vatti poyo? Oru glass vellam kudi!",
    "Hydration check - grab a glass!",
    "Vellam kudikkaan marakkalle, ketto!"
  ],

  // Pose: "warning" (Hands raised with finger pointing, warning to take a break)
  break: [
    "Onn ezhunnettu nadakku, ketto.",
    "Dey kann potti povum. Purathekk nokk",
    "Break time! Kaal onnu neettu.",
    "Screen-ilekku ithra neram nokkalle, kannu pokum!",
    "Posture shari aakku, nere irikk!"
  ],

  // Pose: "nail-look" / "looking" (Returned from outside the screen to check on you)
  returned: [
    "Njan thirichu ethi! Entha pani?",
    "Pani okke kazhinjo? Njan ivide und!",
    "Oru chaaya kudichu vannatha. Nee kudicho?",
    "Entha ithra busy? Oru break edukkam aayirunnu!",
    "Njan vannu ketto! Everything alright?"
  ],

  // Pose: "looking" (Curious head tilted peeking at your work)
  curious: [
    "Entha ithra sradhichu nokkunne?",
    "Njanum onnu nokkatte?",
    "Heavy work aanallo!"
  ],

  // Poses: "neutral", "nail-look", "looking", "looking-up" (Idle thoughts)
  chatter: [
    "Entha pani? Njan ivide thanne und, ketto.",
    "Screen-ilekku ithra neram nokkalle, kannu pokum!",
    "Chaya kudikkan neram aayo?",
    "Sivane.. itheth posture..?",
    "Pani okke kazhinjo?",
    "Oru nimisham, kaal onnu neettu.",
    "Njan ivide thanne und, vilichal mathi.",
    "Busy aanallo, alle?",
    "Vellam kudikkaan marakkalle!"
  ],

  // Pose: "nail-look" (Celebration when user completes a reminder)
  celebrate: [
    "Well done!",
    "Shabash!",
    "Athu mathi! Good job!"
  ],

  // Pose: "apologies" (Hands folded apologetically on single click)
  click: [
    "Njan ivide thanne und, ketto!",
    "Aha, entha vishesham?",
    "Njan pokoola..!"
  ],

  // Pose: "angry" (Clenched fists with tremor on double click)
  dblclick: [
    "Njan pokoolanna alle prnje..!",
    "Enthina enne ingane thattunne?!",
    "Pani edukkade, veruthe irikkathe!"
  ]
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = ([lo, hi]) => (lo + Math.random() * (hi - lo)) * 1000;

// Loaded poses: name -> { bitmap, width, height, aspect }
let poses = {};
let currentPose = "neutral";
let nextPose = "neutral";

// Walk animation assets (from assets/anim/walk)
let walkBitmaps = [];
const walkInfo = {
  width: 215,
  height: 438,
  aspect: 215 / 438,
  fps: 12
};
let walkCycleProgress = 0; // 0.0 to 1.0 (loops seamlessly)
let currentWalkSpeed = 0; // instantaneous speed in px/s
let walkStopping = false; // true when decelerating into a stop
let lastWalkFrameIdx = -1;

// Offscreen excursion state
let isExiting = false; // true when walking out past screen border
let returnAt = 0; // timestamp when Damu starts returning
let returnTargetX = 0; // landing X coordinate on screen

// Transform & positioning state
let x = 400; // horizontal center
let targetDir = 1; // 1 = facing right, -1 = facing left
let facingScale = 1; // smoothly transitions between -1.0 and 1.0 during pivot turns
let dir = 1; // legacy alias for compatibility
let mode = "stand"; // stand | walk | offscreen | return_walk | hover_nail | nail_look | looking | looking_up | warning | angry | apologies
let nextAt = 0;
let busy = false;
let dragging = false;
let overUi = false;
let bubbleTimer = null;

// Animation simulation state
let walkDistance = 0;
let angryUntil = 0;
let jump = null; // { start, duration, height }
let landBounce = null; // { start }
let posePop = null; // { start }
let lastFrameTime = performance.now();

// Mouse tracking
let lastMouseX = -9999;
let lastMouseY = -9999;
let lastUserInteraction = performance.now();

// ----- Asset Loading -----
async function load() {
  // 1. Load static poses
  const manifest = await (await fetch(`${ASSETS}/poses/manifest.json`)).json();
  for (const [name, info] of Object.entries(manifest.poses)) {
    const res = await fetch(`${ASSETS}/${info.webp}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    poses[name] = {
      bitmap,
      width: info.width,
      height: info.height,
      aspect: info.aspect
    };
  }

  // 2. Load 16 walk frames from assets/anim/walk/
  try {
    const animManifest = await (await fetch(`${ASSETS}/anim/manifest.json`)).json();
    const walkCfg = animManifest.animations?.walk;
    if (walkCfg) {
      walkInfo.width = walkCfg.width || 215;
      walkInfo.height = walkCfg.height || 438;
      walkInfo.aspect = walkInfo.width / walkInfo.height;
      walkInfo.fps = walkCfg.fps || 12;
    }
    const framePaths = walkCfg?.frames || Array.from({ length: 16 }, (_, i) => `walk/${String(i).padStart(4, "0")}.webp`);
    walkBitmaps = await Promise.all(
      framePaths.map(async (fp) => {
        const res = await fetch(`${ASSETS}/anim/${fp}`);
        const blob = await res.blob();
        return await createImageBitmap(blob);
      })
    );
    console.log(`[companion] Loaded ${walkBitmaps.length} realistic walk frames successfully!`);
  } catch (err) {
    console.error("Failed to load walk animation frames:", err);
  }
}

// ----- Pose Switching & Canvas Rendering -----
function setPose(name, { pop = true } = {}) {
  if (!poses[name]) return;
  // If we were walking, halt walk state
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
  nextPose = name;
  renderCurrentPose();
}

function renderCurrentPose() {
  const p = poses[currentPose];
  if (!p) return;

  if (canvas.width !== p.width || canvas.height !== p.height) {
    canvas.width = p.width;
    canvas.height = p.height;
  }

  const w = Math.round(DISPLAY_HEIGHT * p.aspect);
  if (avatar.style.width !== w + "px" || avatar.style.height !== DISPLAY_HEIGHT + "px") {
    avatar.style.width = w + "px";
    avatar.style.height = DISPLAY_HEIGHT + "px";
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(p.bitmap, 0, 0);
}

function renderWalkFrame(frameIdx) {
  if (!walkBitmaps.length) return;
  const bmp = walkBitmaps[frameIdx % walkBitmaps.length];
  if (!bmp) return;

  if (canvas.width !== walkInfo.width || canvas.height !== walkInfo.height) {
    canvas.width = walkInfo.width;
    canvas.height = walkInfo.height;
  }

  const w = Math.round(DISPLAY_HEIGHT * walkInfo.aspect);
  if (avatar.style.width !== w + "px" || avatar.style.height !== DISPLAY_HEIGHT + "px") {
    avatar.style.width = w + "px";
    avatar.style.height = DISPLAY_HEIGHT + "px";
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
}

// ----- Activities & AI Decisions -----
function standIdle() {
  mode = "stand";
  walkStopping = false;
  isExiting = false;
  currentWalkSpeed = 0;
  lastWalkFrameIdx = -1;
  setPose("neutral", { pop: false });
  nextAt = performance.now() + rand(STAND_FOR);
}

function startWalk() {
  mode = "walk";
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

// Walk all the way off-screen to run an errand / take a break
function startOffscreenWalk() {
  mode = "walk";
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
function startReturnWalk(now) {
  mode = "return_walk";
  isExiting = false;
  walkStopping = false;
  lastWalkFrameIdx = -1;
  const half = W() / 2;

  // Decide which side to enter from (50/50 left or right)
  const enterFromLeft = Math.random() < 0.5;
  if (enterFromLeft) {
    x = -half - 30;
    targetDir = 1;
  } else {
    x = window.innerWidth + half + 30;
    targetDir = -1;
  }
  facingScale = targetDir;
  dir = targetDir;

  // Choose landing spot in comfortable desktop viewing area
  returnTargetX = Math.round(window.innerWidth * (0.28 + Math.random() * 0.44));
  nextAt = Infinity;
}

// Triggered when Damu finishes walking back onto the screen
function onDamuReturned() {
  standIdle();
  const choices = ["water", "break", "curious", "returned"];
  const choice = pick(choices);

  if (choice === "water") {
    setPose("looking-up");
    doHop(18, 0.35);
    const buttons = [
      { label: "Drank it", onClick: celebrate },
      { label: "Later", alt: true, onClick: () => {
        setPose("apologies");
        say("Shari, 5 minute kazhinju njan veendum parayum!", { face: "apologies", ms: 3000 });
      }}
    ];
    say(pick(LINES.water), { face: "looking-up", buttons });
  } else if (choice === "break") {
    setPose("warning");
    doHop(20, 0.36);
    const buttons = [
      { label: "Done", onClick: celebrate },
      { label: "Later", alt: true, onClick: () => {
        setPose("apologies");
        say("Shari, break pinne edukku!", { face: "apologies", ms: 3000 });
      }}
    ];
    say(pick(LINES.break), { face: "warning", buttons });
  } else if (choice === "curious") {
    setPose("looking");
    say(pick(LINES.curious), { face: "looking", ms: 6000 });
  } else {
    setPose("nail-look");
    say(pick(LINES.returned), { face: "nail-look", ms: 6000 });
  }
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

function decide(now) {
  if (now < nextAt || busy || dragging || angryUntil > now || mode === "offscreen") return;

  if (mode === "walk") {
    // Settle gracefully into stand after in-screen walking
    walkStopping = true;
    return;
  }

  // Choose next activity:
  const r = Math.random();
  if (r < 0.22) {
    // 22% chance: Walk off-screen to run errands, grab tea, and return with a reminder/question
    startOffscreenWalk();
  } else if (r < 0.50) {
    // 28% chance: Standard in-screen stroll
    startWalk();
  } else if (r < 0.70) {
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
  if (overUi) {
    overUi = false;
    window.damu.setIgnoreMouse(true);
  }
}

// ----- Audio SFX -----
function sfx(name) {
  try {
    const a = new Audio(`${ASSETS}/audio/${name}.mp3`);
    a.play().catch(() => {});
  } catch {}
}

// ----- Reminders, Chatter & Reactions -----
function celebrate() {
  busy = false;
  setPose("nail-look");
  doHop(28, 0.42);
  say(pick(LINES.celebrate), {
    face: "nail-look",
    ms: 3000
  });
  nextAt = performance.now() + 3500;
}

function remind({ type }) {
  if (busy) return;
  busy = true;
  if (mode === "walk" || walkStopping || mode === "return_walk") {
    mode = "stand";
    walkStopping = false;
    currentWalkSpeed = 0;
  }

  // If Damu is offscreen when reminder arrives, bring him back in immediately!
  if (mode === "offscreen") {
    startReturnWalk(performance.now());
    return;
  }

  const later = () => {
    busy = false;
    setPose("apologies");
    say("Shari, 5 minute kazhinju njan veendum parayum!", { face: "apologies", ms: 3000 });
    nextAt = performance.now() + 3500;
    setTimeout(() => remind({ type }), 5 * 60_000);
  };

  if (type === "water") {
    // Parched throat / warning
    setPose("looking-up");
    doHop(18, 0.35);
    const buttons = [
      { label: "Drank it", onClick: celebrate },
      { label: "Later", alt: true, onClick: later }
    ];
    say(pick(LINES.water), { face: "looking-up", buttons });
  } else {
    // Break / posture reminder
    setPose("warning");
    doHop(20, 0.36);
    const buttons = [
      { label: "Done", onClick: celebrate },
      { label: "Later", alt: true, onClick: later }
    ];
    say(pick(LINES.break), { face: "warning", buttons });
  }
  nextAt = Infinity;
}

function chatter() {
  if (busy || dragging || angryUntil > performance.now() || mode === "offscreen") return;
  if (mode === "walk" || walkStopping || mode === "return_walk") {
    mode = "stand";
    walkStopping = false;
    currentWalkSpeed = 0;
  }
  const choice = pick(["chatter", "curious"]);
  if (choice === "curious") {
    setPose("looking");
    say(pick(LINES.curious), { face: "looking", ms: 6000 });
  } else {
    const poseKey = pick(["neutral", "nail-look", "looking", "looking-up"]);
    setPose(poseKey);
    say(pick(LINES.chatter), { face: poseKey, ms: 6500 });
  }
  nextAt = performance.now() + 7000;
}

function react(kind) {
  if (busy || mode === "offscreen") return;
  lastUserInteraction = performance.now();
  if (mode === "walk" || walkStopping || mode === "return_walk" || mode === "hover_nail") {
    mode = "stand";
    walkStopping = false;
    currentWalkSpeed = 0;
  }

  if (kind === "click") {
    // Startled reaction
    setPose("apologies");
    doHop(26, 0.36);
    sfx("pokoola");
    say(pick(LINES.click), { face: "apologies", ms: 3500 });
    nextAt = performance.now() + 4000;
  } else if (kind === "dblclick") {
    // Angry clenched fists with tremor
    setPose("angry");
    angryUntil = performance.now() + 2800;
    sfx("pokoolanna");
    say(pick(LINES.dblclick), { face: "angry", ms: 4000 });
    nextAt = performance.now() + 4500;
  }
}

// ----- Window IPC Handlers -----
window.damu.onRemind(remind);
window.damu.onChatter(chatter);
window.damu.onSay(({ text }) => {
  setPose("looking");
  say(text, { face: "looking" });
});

// ----- Click-through Pixel Hit-Testing -----
function isOpaque(e) {
  if (bubble.style.display === "flex" && bubble.contains(e.target)) return true;
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return false;

  let px = ((e.clientX - r.left) / r.width) * canvas.width;
  if (facingScale < 0) px = canvas.width - px;
  const py = ((e.clientY - r.top) / r.height) * canvas.height;

  const pixel = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, px | 0)), py | 0, 1, 1).data;
  return pixel[3] > 24;
}

// Track mouse position and hover hit-testing
window.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  if (dragging || mode === "offscreen") return;
  const hit = isOpaque(e);
  if (hit !== overUi) {
    overUi = hit;
    window.damu.setIgnoreMouse(!hit);

    // Hover behaviour: nail look when hovered over, return to stand when unhovered
    if (hit) {
      if (!busy && !angryUntil && (mode === "stand" || mode === "looking" || mode === "looking_up")) {
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
  if (mode === "walk" || walkStopping || mode === "return_walk" || mode === "hover_nail") {
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
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

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

  // 1. Locomotion / Realistic Walking (Inside screen, Exiting screen, or Returning)
  if (mode === "walk" || walkStopping || mode === "return_walk") {
    // Smooth acceleration or deceleration
    if (walkStopping) {
      currentWalkSpeed = Math.max(0, currentWalkSpeed - WALK_DECEL * dt);
      const curFrame = Math.floor(walkCycleProgress * walkBitmaps.length) % walkBitmaps.length;
      // Complete stride onto grounded stance (frames 0, 1, 8, 9 or stopped)
      if (currentWalkSpeed < 14 && (curFrame === 0 || curFrame === 1 || curFrame === 8 || curFrame === 9 || currentWalkSpeed <= 1)) {
        standIdle();
      }
    } else {
      currentWalkSpeed = Math.min(WALK_SPEED, currentWalkSpeed + WALK_ACCEL * dt);
    }

    const half = W() / 2;

    if (isExiting) {
      // Exiting off-screen: continue walking past screen boundaries
      if (targetDir < 0 && x < -half - 50) {
        mode = "offscreen";
        isExiting = false;
        currentWalkSpeed = 0;
        returnAt = now + rand(OFFSCREEN_AWAY_FOR);
        hideBubble();
        window.damu.setIgnoreMouse(true);
      } else if (targetDir > 0 && x > window.innerWidth + half + 50) {
        mode = "offscreen";
        isExiting = false;
        currentWalkSpeed = 0;
        returnAt = now + rand(OFFSCREEN_AWAY_FOR);
        hideBubble();
        window.damu.setIgnoreMouse(true);
      }
    } else if (mode === "return_walk") {
      // Returning into screen: stop upon reaching target area
      if ((targetDir > 0 && x >= returnTargetX) || (targetDir < 0 && x <= returnTargetX)) {
        x = returnTargetX;
        currentWalkSpeed = 0;
        onDamuReturned();
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

    // Smooth turnaround pivot interpolation
    if (facingScale !== targetDir) {
      const turnSpeed = 6.8; // pivots smoothly in ~0.25s
      const step = turnSpeed * dt;
      if (Math.abs(targetDir - facingScale) <= step) {
        facingScale = targetDir;
      } else {
        facingScale += Math.sign(targetDir - facingScale) * step;
      }
    }

    // Pivot factor: turning on the spot slows down lateral progress
    const turnFactor = 0.25 + 0.75 * Math.abs(facingScale);
    const stepMove = targetDir * (currentWalkSpeed * turnFactor) * dt;
    x += stepMove;
    walkDistance += Math.abs(stepMove);

    // Keep avatar strictly inside screen viewport only if not exiting or returning
    if (!isExiting && mode !== "return_walk") {
      x = Math.max(half, Math.min(window.innerWidth - half, x));
    }

    // Render synchronized walk frame (zero foot sliding)
    if (walkBitmaps.length > 0 && currentWalkSpeed > 0.05) {
      walkCycleProgress = (walkCycleProgress + ((currentWalkSpeed * turnFactor) / STRIDE_DISTANCE) * dt) % 1.0;
      const frameIdx = Math.floor(walkCycleProgress * walkBitmaps.length) % walkBitmaps.length;
      if (frameIdx !== lastWalkFrameIdx) {
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
  } else if (mode === "angry" && angryUntil <= now) {
    standIdle();
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

  // Apply composite hardware-accelerated transform with smooth facing scale
  const visualScaleX = Math.sign(facingScale || targetDir || 1) * Math.max(0.12, Math.abs(facingScale));
  avatar.style.transform = `scaleX(${visualScaleX.toFixed(3)}) translate(${tfX.toFixed(2)}px, ${tfY.toFixed(2)}px) rotate(${tfRot.toFixed(2)}deg) scale(${tfScaleX.toFixed(3)}, ${tfScaleY.toFixed(3)})`;

  place();
  requestAnimationFrame(frame);
}

// ----- Bootstrap -----
load().then(() => {
  console.log("[companion] Poses and walk animation loaded successfully! Starting animation loop...");
  x = Math.max(200, window.innerWidth - 320);
  standIdle();
  say("Njan ivide und, ketto!", { face: "looking", ms: 5000 });
  requestAnimationFrame(frame);
}).catch((err) => {
  console.error("Failed to load Damu assets:", err);
});

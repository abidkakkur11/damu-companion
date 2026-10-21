// Turns the animation clips in ../damu into transparent frame sequences for the app.
//   node scripts/make-sprites.mjs [clip ...]      (default: all clips)
//
// SOURCES describe which part of a video to extract (and matte once, cached in .work/).
// CLIPS slice a source into the animations the app plays. To add an animation, drop a
// new mp4 next to the others, add a SOURCE for it and a CLIP that uses it.
//
// Per source: extract frames with ffmpeg -> remove background with a segmentation model.
// Per clip:   crop every frame to the clip's common bounding box -> WebP frames in
//             assets/anim/<clip>/ and an entry in assets/anim/manifest.json.
import { removeBackground } from "@imgly/background-removal-node";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Use the sharp copy bundled with the matting library; two sharp versions in one process clash on libvips.
const sharp = createRequire(import.meta.resolve("@imgly/background-removal-node"))("sharp");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clipsDir = path.resolve(root, "..", "damu");
const work = path.join(root, ".work");
const outRoot = path.join(root, "assets", "anim");

const SCALE = 0.4; // stored frame = source * SCALE
const STAND_HEIGHT = 210; // on-screen height (CSS px) of a standing Damu
const DISPLAY = STAND_HEIGHT / (1060 * SCALE); // CSS px per stored px

// Frame index = (t - from) * fps, so slices below are written as seconds relative to `from`.
const SOURCES = {
  walk: { file: "Character_walking_right.mp4", from: 1.5, to: 8.5, fps: 12, detectLoop: true },
  jump: { file: "Character_jumping.mp4", from: 2.0, to: 8.0, fps: 10 },
  idle: { file: "Character_jumping.mp4", from: 8.0, to: 10.0, fps: 12 }, // standing, head moves, a wink
  sit: { file: "Styling_character_sitting_on_floor.mp4", from: 0.2, to: 10.0, fps: 8, stretch: true }, // white lungi on a white floor: matte a contrast-stretched copy
};

const CLIPS = {
  walk: { source: "walk", loop: true },
  jump: { source: "jump", slice: [0.8, 5.6] }, // crouch, air, landing (t = 2.8s..7.6s)
  idle: { source: "idle", loop: true, pingpong: true },
  sitdown: { source: "sit", slice: [0, 6.3], shareBox: "sit" }, // stand -> seated (t = 0.2s..6.5s)
  sitidle: { source: "sit", slice: [6.3, 9.8], loop: true, pingpong: true, shareBox: "sit" }, // seated, gestures
};

const ff = (...args) => execFileSync(ffmpegPath, ["-v", "error", "-y", ...args]);
const pad = (n) => String(n).padStart(4, "0");
const frameFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();

async function lowRes(file) {
  const { data } = await sharp(file).greyscale().resize(72, 128, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return data;
}

// Find a start/end pair of frames whose lower body (legs) matches, so the walk loops seamlessly.
async function findLoop(files, fps) {
  const small = await Promise.all(files.map(lowRes));
  const diff = (a, b) => {
    let s = 0;
    for (let i = 72 * 60; i < 72 * 128; i++) s += Math.abs(small[a][i] - small[b][i]);
    return s;
  };
  const start = Math.floor(files.length * 0.35);
  let best = null;
  for (let s = start; s < start + 12; s++) {
    for (let len = Math.round(fps * 0.6); len <= Math.round(fps * 1.6); len++) {
      if (s + len >= files.length) continue;
      const d = diff(s, s + len);
      if (!best || d < best.d) best = { s, len, d };
    }
  }
  console.log(`  loop: start ${best.s}, ${best.len} frames (${(best.len / fps).toFixed(2)}s), diff ${best.d}`);
  return files.slice(best.s, best.s + best.len);
}

async function runModel(file) {
  const blob = await removeBackground(pathToFileURL(file).href, { model: "medium", output: { format: "image/png" } });
  return Buffer.from(await blob.arrayBuffer());
}

// With `stretch` the model sees a high-contrast copy, which separates a white garment from a white
// floor; its alpha (boosted to drop faint shadows and firm up soft areas) is applied to the original colours.
async function matte(src, dst, stretch) {
  if (fs.existsSync(dst)) return;
  if (!stretch) { fs.writeFileSync(dst, await runModel(src)); return; }
  const tmp = dst.replace(`${path.sep}matte${path.sep}`, `${path.sep}stretch${path.sep}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  await sharp(src).linear(3.0, -500).png().toFile(tmp);
  const model = await sharp(await runModel(tmp)).ensureAlpha().raw().toBuffer();
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const LO = 40, HI = 170;
  for (let i = 0; i < info.width * info.height; i++) {
    data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (model[i * 4 + 3] - LO) / (HI - LO))));
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(dst);
}

async function bbox(file) {
  const { data, info } = await sharp(file).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

const matteCache = {}; // source name -> matted file paths (all frames of the source)
async function matteSource(name) {
  if (matteCache[name]) return matteCache[name];
  const cfg = SOURCES[name];
  console.log(`== source ${name}`);
  const raw = path.join(work, name, "raw");
  const mat = path.join(work, name, "matte");
  fs.mkdirSync(mat, { recursive: true });
  // The extraction parameters are stored next to the frames; a change invalidates the raw frames only.
  const stamp = path.join(work, name, "params.json");
  const params = JSON.stringify({ file: cfg.file, from: cfg.from, to: cfg.to, fps: cfg.fps });
  let stale = !fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== params;
  if (stale || !fs.existsSync(raw) || !frameFiles(raw).length) {
    fs.rmSync(raw, { recursive: true, force: true });
    fs.mkdirSync(raw, { recursive: true });
    ff("-ss", String(cfg.from), "-to", String(cfg.to), "-i", path.join(clipsDir, cfg.file), "-vf", `fps=${cfg.fps}`, path.join(raw, "%04d.png"));
    fs.writeFileSync(stamp, params);
  }
  let sources = frameFiles(raw).map((f) => path.join(raw, f));
  if (cfg.detectLoop) sources = await findLoop(sources, cfg.fps);
  const matted = [];
  for (const [i, src] of sources.entries()) {
    const dst = path.join(mat, path.basename(src));
    await matte(src, dst, cfg.stretch);
    matted.push(dst);
    if (i % 10 === 0) console.log(`  matted ${i + 1}/${sources.length}`);
  }
  return (matteCache[name] = matted);
}

const boxCache = {};
async function unionBox(files) {
  let box = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  for (const f of files) {
    const b = await bbox(f);
    box = { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) };
  }
  return box;
}

async function processClip(name, cfg, manifest) {
  console.log(`== clip ${name}`);
  const all = await matteSource(cfg.source);
  const fps = SOURCES[cfg.source].fps;
  const [a, b] = cfg.slice ? cfg.slice.map((s) => Math.round(s * fps)) : [0, all.length];
  const files = all.slice(a, b);

  // Common crop box keeps the motion intact (no per-frame re-centering). Clips from the
  // same source that must join up seamlessly share one box.
  const key = cfg.shareBox;
  const box = key ? (boxCache[key] ??= await unionBox(all)) : await unionBox(files);
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const ow = Math.round(w * SCALE), oh = Math.round(h * SCALE);

  const outDir = path.join(outRoot, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const names = [];
  for (const [i, f] of files.entries()) {
    const file = `${pad(i)}.webp`;
    await sharp(f).extract({ left: box.x0, top: box.y0, width: w, height: h })
      .resize(ow, oh).webp({ quality: 88, alphaQuality: 95 }).toFile(path.join(outDir, file));
    names.push(`${name}/${file}`);
  }
  // Ping-pong loops play forward then backward, so they need no matching start/end frame.
  const frames = cfg.pingpong ? [...names, ...names.slice(1, -1).reverse()] : names;
  manifest[name] = { frames, fps, loop: !!cfg.loop, width: ow, height: oh };
  console.log(`  wrote ${names.length} files (${frames.length} frames), ${ow}x${oh}`);
}

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(CLIPS);
fs.mkdirSync(outRoot, { recursive: true });
const manifestFile = path.join(outRoot, "manifest.json");
let manifest = { displayScale: DISPLAY, animations: {} };
try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch {}
manifest.displayScale = DISPLAY;
for (const stale of Object.keys(manifest.animations)) {
  if (!CLIPS[stale]) { // clip removed from CLIPS (e.g. the old "sit")
    delete manifest.animations[stale];
    fs.rmSync(path.join(outRoot, stale), { recursive: true, force: true });
  }
}
for (const n of names) {
  if (!CLIPS[n]) throw new Error(`unknown clip ${n}`);
  await processClip(n, CLIPS[n], manifest.animations);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}
console.log("done");

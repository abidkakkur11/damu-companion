// Builds a character (poses, speech-bubble faces, walk frames) from raw artwork.
//   node scripts/build-character.js <id> <folder-with-the-source-images>
// The recipe lives in scripts/characters/<id>.json; output goes to assets/characters/<id>/.
// Backgrounds are removed by flood-filling the light, neutral background from the image border, which also
// handles the fake "checkerboard transparency" that AI image tools paint into the pixels.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const [id, srcDir] = process.argv.slice(2);
if (!id || !srcDir) {
  console.error("usage: node scripts/build-character.js <id> <source-folder>");
  process.exit(1);
}
const root = path.resolve(__dirname, "..");
const cfg = require(`./characters/${id}.json`);
const out = path.join(root, "assets", "characters", id);

// The shirt colour anchors the walk frames and the size matching. Recipe: "shirtHue": [from, to] in degrees
// (default pink, 328-352). Skin, a red towel, etc. must fall outside the range.
const HUE = cfg.shirtHue || [328, 352];
const isShirt = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 140 || (mx - mn) / mx < 0.45) return false;
  let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  h = (h * 60 + 360) % 360;
  return h >= HUE[0] && h <= HUE[1];
};

// Load an image as RGBA with a clean alpha channel (existing alpha is kept, otherwise the background is flooded away).
async function matte(file, { light = 198, sat = 16 } = {}) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const n = W * H;
  const hasAlpha = (await sharp(file).metadata()).hasAlpha && data.some((_, i) => i % 4 === 3 && data[i] < 250);
  const alpha = new Uint8Array(n);
  if (hasAlpha) {
    for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3] < 24 ? 0 : data[i * 4 + 3];
  } else {
    const isBg = (i) => {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      return Math.min(r, g, b) >= light && Math.max(r, g, b) - Math.min(r, g, b) <= sat;
    };
    const seen = new Uint8Array(n);
    const stack = [];
    const push = (x, y) => { const i = y * W + x; if (!seen[i] && isBg(i)) { seen[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      if (x > 0) push(x - 1, y);
      if (x < W - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < H - 1) push(x, y + 1);
    }
    for (let i = 0; i < n; i++) alpha[i] = seen[i] ? 0 : 255;
  }
  // Erode one pixel (drops the light fringe), then soften the edge with a 3x3 average.
  const eroded = alpha.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (alpha[i] && (!alpha[i - 1] || !alpha[i + 1] || !alpha[i - W] || !alpha[i + W])) eroded[i] = 0;
  }
  for (let i = 0; i < n; i++) data[i * 4 + 3] = eroded[i];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (eroded[i] === 255 && eroded[i - 1] === 255 && eroded[i + 1] === 255 && eroded[i - W] === 255 && eroded[i + W] === 255) continue;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += eroded[i + dy * W + dx];
    data[i * 4 + 3] = s / 9 < 12 ? 0 : Math.round(s / 9);
  }
  return { data, W, H };
}

const bbox = ({ data, W, H }) => {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 10) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
const toSharp = ({ data, W, H }) => sharp(Buffer.from(data.buffer, data.byteOffset, data.length), { raw: { width: W, height: H, channels: 4 } });
const shirtArea = ({ data, W, H }) => { let c = 0; for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] > 200 && isShirt(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) c++; return c; };
const webp = (img, file, q) => img.webp({ quality: q, alphaQuality: 90, effort: 5 }).toFile(file);

async function buildPoses() {
  for (const dir of ["poses", "faces"]) {
    fs.mkdirSync(path.join(out, dir), { recursive: true });
    for (const f of fs.readdirSync(path.join(out, dir))) if (/\.(webp|png)$/.test(f)) fs.rmSync(path.join(out, dir, f)); // no stale files from an older recipe
  }
  const sources = {};
  for (const file of new Set(Object.values(cfg.poses).map((p) => p.file || p))) {
    const m = await matte(path.join(srcDir, `${file}.png`));
    const b = bbox(m);
    sources[file] = { m, b, crop: await toSharp(m).extract({ left: b.x0, top: b.y0, width: b.w, height: b.h }).png({ compressionLevel: 1 }).toBuffer() };
    console.log(`matted ${file}: figure ${b.w}x${b.h}`);
  }
  const ref = sources[cfg.poses.neutral.file || cfg.poses.neutral];
  const refShirt = shirtArea(ref.m);
  const k = cfg.poseHeight / ref.b.h; // output px per source px for the reference pose
  const poses = {};
  const written = {};
  const order = Object.entries(cfg.poses).sort(([a], [b]) => (b === "neutral") - (a === "neutral")); // neutral first: other poses may reuse its face
  for (const [name, spec] of order) {
    const file = spec.file || spec;
    const src = sources[file];
    // "matchBody": the picture is a different size/canvas, so scale it until the body matches the reference body
    let s = k;
    if (spec.matchBody) {
      const area = shirtArea(src.m);
      if (area && refShirt) s = k * Math.sqrt(refShirt / area);
      else console.warn(`warning: no shirt pixels found in ${file} (check "shirtHue" in the recipe): body size not matched`);
    }
    const height = Math.round(src.b.h * s);
    const key = `${file}@${height}`;
    if (!written[key]) {
      const buf = await sharp(src.crop).resize({ height }).toBuffer();
      await webp(sharp(buf), path.join(out, "poses", `${name}.webp`), cfg.quality || 88);
      written[key] = { ...(await sharp(buf).metadata()), file: `${name}.webp` }; // poses sharing a picture share its file
    }
    const w = written[key];
    poses[name] = { webp: `poses/${w.file}`, width: w.width, height: w.height, aspect: +(w.width / w.height).toFixed(4) };

    if (spec.noFace) { // the head is not at the top of this picture: reuse the neutral face
      fs.copyFileSync(path.join(out, "faces", "neutral.png"), path.join(out, "faces", `${name}.png`));
      continue;
    }
    // speech-bubble face: a square around the head, found from the topmost opaque rows
    const { x0, y0, w: bw, h: bh } = src.b;
    const rows = Math.round(bh * 0.16);
    const raw = await sharp(src.crop).raw().toBuffer({ resolveWithObject: true });
    let sx = 0, c = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < raw.info.width; x++) if (raw.data[(y * raw.info.width + x) * 4 + 3] > 10) { sx += x; c++; }
    const side = Math.round(bh * (spec.faceSide || 0.24));
    const left = Math.max(0, Math.min(bw - side, Math.round(sx / c - side / 2)));
    const top = Math.max(0, Math.min(bh - side, Math.round(bh * 0.005)));
    await sharp(src.crop).extract({ left, top, width: Math.min(side, bw), height: Math.min(side, bh) }).resize(160, 160).png({ compressionLevel: 9 }).toFile(path.join(out, "faces", `${name}.png`));
  }
  fs.writeFileSync(path.join(out, "poses", "manifest.json"), JSON.stringify({ poses }, null, 2) + "\n");
  console.log(`poses: ${Object.keys(poses).join(", ")}`);
}

async function buildWalk() {
  const w = cfg.walk;
  const sheet = await matte(path.join(srcDir, `${w.sheet}.png`), { light: 222, sat: 22 });
  const { data, W, H } = sheet;
  // label connected pieces (8-neighbour); the sheet has w.frames separate figures
  const lab = new Int32Array(W * H);
  const comps = [];
  for (let s = 0; s < W * H; s++) {
    if (data[s * 4 + 3] < 10 || lab[s]) continue;
    const id2 = comps.length + 1, stack = [s];
    lab[s] = id2;
    let x0 = W, x1 = 0, y0 = H, y1 = 0, cnt = 0, sx = 0, sc = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      cnt++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (isShirt(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) { sx += x; sc++; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (data[j * 4 + 3] >= 10 && !lab[j]) { lab[j] = id2; stack.push(j); }
      }
    }
    comps.push({ id: id2, x0, x1, y0, y1, cnt, cx: sc ? sx / sc : (x0 + x1) / 2 });
  }
  const frames = comps.filter((c) => c.cnt > 0.0025 * W * H).sort((a, b) => a.x0 - b.x0);
  if (frames.length !== w.frames) throw new Error(`expected ${w.frames} walk frames, found ${frames.length}`);
  // align on the shirt (so the body stays put while the legs swing) and on the ground line
  const left = Math.max(...frames.map((f) => f.cx - f.x0)), right = Math.max(...frames.map((f) => f.x1 - f.cx));
  const cw = Math.ceil(left + right + 1), ch = Math.max(...frames.map((f) => f.y1 - f.y0 + 1));
  fs.rmSync(path.join(out, "anim", "walk"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "anim", "walk"), { recursive: true });
  const names = [];
  let outW = 0, outH = 0;
  for (const [i, f] of frames.entries()) {
    const fw = f.x1 - f.x0 + 1, fh = f.y1 - f.y0 + 1;
    const piece = Buffer.alloc(fw * fh * 4);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const si = (f.y0 + y) * W + f.x0 + x;
      if (lab[si] === f.id) data.copy(piece, (y * fw + x) * 4, si * 4, si * 4 + 4);
    }
    const placed = await sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: piece, raw: { width: fw, height: fh, channels: 4 }, left: Math.round(left - (f.cx - f.x0)), top: ch - fh }]).png().toBuffer();
    const img = await sharp(placed).resize({ height: w.height, kernel: "lanczos3" }).toBuffer();
    const meta = await sharp(img).metadata();
    outW = meta.width; outH = meta.height;
    const name = `walk/${String(i).padStart(4, "0")}.webp`;
    await webp(sharp(img), path.join(out, "anim", name), cfg.quality || 88);
    names.push(name);
  }
  const { frames: _f, sheet: _s, height: _h, ...rest } = w;
  // keep any other animation (e.g. idle) that is already in the manifest
  const manifestFile = path.join(out, "anim", "manifest.json");
  const prev = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
  prev.animations = { ...prev.animations, walk: { frames: names, loop: true, width: outW, height: outH, ...rest } };
  fs.writeFileSync(manifestFile, JSON.stringify(prev, null, 2) + "\n");
  console.log(`walk: ${names.length} frames at ${outW}x${outH}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "character.json"), JSON.stringify({ id, name: cfg.name }, null, 2) + "\n");
  await buildPoses();
  await buildWalk();
  const size = (d) => fs.readdirSync(d, { recursive: true }).reduce((s, f) => { const p = path.join(d, f); return s + (fs.statSync(p).isFile() ? fs.statSync(p).size : 0); }, 0);
  console.log(`done: ${(size(out) / 1024).toFixed(0)} KB in assets/characters/${id}`);
})().catch((e) => { console.error(e); process.exit(1); });

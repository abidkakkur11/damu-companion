// Removes the flat yellow background from damu-fullsize.png (flood fill from the
// edges, so yellow inside the character is kept), trims it and writes
// assets/damu.png plus a tray icon and app icon.
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? path.resolve(root, "..", "damu", "damu-fullsize.png");

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

// Background colour = average of the four corners.
const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(px);
const bg = [0, 1, 2].map((c) => corners.reduce((s, p) => s + p[c], 0) / 4);
const dist = (i) => {
  const p = px(i);
  return Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
};

const HARD = 45; // <= HARD: definitely background
const SOFT = 75; // HARD..SOFT: anti-aliased edge, partial alpha
const bgMask = new Uint8Array(w * h);
const stack = [];
const push = (i) => {
  if (!bgMask[i] && dist(i) <= SOFT) {
    bgMask[i] = 1;
    stack.push(i);
  }
};
for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
while (stack.length) {
  const i = stack.pop();
  const x = i % w, y = (i / w) | 0;
  if (x > 0) push(i - 1);
  if (x < w - 1) push(i + 1);
  if (y > 0) push(i - w);
  if (y < h - 1) push(i + w);
}

for (let i = 0; i < w * h; i++) {
  if (!bgMask[i]) continue;
  const d = dist(i);
  if (d <= HARD) {
    data[i * 4 + 3] = 0;
  } else {
    // Soft edge: fade alpha and pull the colour away from the yellow spill.
    const a = (d - HARD) / (SOFT - HARD);
    data[i * 4 + 3] = Math.round(a * 255);
    // Pull yellow spill out of the edge pixel by capping red/green to the blue-weighted max.
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const cap = Math.max(b, 0) + 70;
    data[i*4+1] = Math.min(g, Math.max(cap, r * 0.8));
  }
}

// Floor shadow: yellowish (g close to r, low blue) pixels near the feet.
for (let y = Math.floor(h * 0.88); y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x, r = data[i*4], g = data[i*4+1], b = data[i*4+2];
  if (data[i*4+3] && g > r * 0.78 && b < r * 0.55) data[i*4+3] = 0;
}

// Shadow under the feet is part of the yellow; the flood fill handles it if it is
// close enough to the background. Anything left is trimmed with the bounding box.
const full = sharp(data, { raw: { width: w, height: h, channels: 4 } });
const trimmed = await full.png().toBuffer().then((b) => sharp(b).trim({ threshold: 1 }).toBuffer());

const meta = await sharp(trimmed).metadata();
console.log(`avatar ${meta.width}x${meta.height}`);

await sharp(trimmed).resize({ height: 640 }).png().toFile(path.join(root, "assets", "damu.png"));

// Head crop for tray / app icon (top ~30% of the figure, centred).
const side = Math.round(meta.width * 0.75);
const head = await sharp(trimmed)
  .extract({ left: Math.round((meta.width - side) / 2), top: 0, width: side, height: Math.min(side, meta.height) })
  .toBuffer();
await sharp(head).resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(root, "assets", "icon.png"));
await sharp(head).resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(root, "assets", "tray.png"));
console.log("wrote assets/damu.png, icon.png, tray.png");

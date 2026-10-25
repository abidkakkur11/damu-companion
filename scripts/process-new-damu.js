const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const v1Dir = path.join(root, 'assets', 'v1');
const posesDir = path.join(root, 'assets', 'poses');
const facesDir = path.join(root, 'assets', 'faces');

fs.mkdirSync(posesDir, { recursive: true });
fs.mkdirSync(facesDir, { recursive: true });

const FILES = [
  'neutral.png',
  'nail-look.png',
  'looking.png',
  'looking-up.png',
  'warning.png',
  'angry.png',
  'apologies.png'
];

async function matteImage(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  // Sample background color from top border
  let bgR = 0, bgG = 0, bgB = 0, count = 0;
  for (let x = 0; x < w; x++) {
    bgR += data[x * 4]; bgG += data[x * 4 + 1]; bgB += data[x * 4 + 2];
    count++;
  }
  const bg = [bgR / count, bgG / count, bgB / count];

  const dist = (i) => Math.hypot(data[i*4] - bg[0], data[i*4+1] - bg[1], data[i*4+2] - bg[2]);

  const HARD = 42;
  const SOFT = 78;
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

  // Also catch enclosed yellow regions (between legs, arm crooks)
  for (let i = 0; i < w * h; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    if (dist(i) <= HARD || (r > 210 && g > 175 && b < 75 && (r - g) < 55)) {
      bgMask[i] = 1;
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (!bgMask[i]) continue;
    const d = dist(i);
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    if (d <= HARD || (r > 215 && g > 180 && b < 70 && (r - g) < 52)) {
      data[i * 4 + 3] = 0;
    } else {
      const a = Math.max(0, Math.min(1, (d - HARD) / (SOFT - HARD)));
      data[i * 4 + 3] = Math.round(a * 255);
      // Suppress yellow spill on edges
      const cap = Math.max(b, 0) + 60;
      data[i*4+1] = Math.min(g, Math.max(cap, r * 0.78));
    }
  }

  // Floor yellow shadow cleanup near bottom
  for (let y = Math.floor(h * 0.88); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i*4+3] === 0) continue;
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
      // Yellowish floor / reflection: yellow hue with low blue and low R-G contrast
      if (r > 160 && g > 120 && b < 75 && (r - g) < 55) {
        data[i*4+3] = 0;
      }
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 2 }).png();
}

async function run() {
  console.log('Processing Damu v1 poses...');
  const manifest = {
    displayHeight: 260, // base CSS height on desktop
    poses: {}
  };

  for (const file of FILES) {
    const name = path.basename(file, '.png');
    const inputPath = path.join(v1Dir, file);
    console.log(`Matting ${file}...`);
    const matted = await matteImage(inputPath);
    const buffer = await matted.toBuffer();
    const meta = await sharp(buffer).metadata();

    // Scale so standard full body is ~700px high for crisp rendering
    const targetHeight = Math.round(700 * (meta.height / 1445));
    const resized = sharp(buffer).resize({ height: targetHeight });
    const finalBuffer = await resized.png().toBuffer();
    const finalMeta = await sharp(finalBuffer).metadata();

    const outPng = path.join(posesDir, `${name}.png`);
    const outWebp = path.join(posesDir, `${name}.webp`);
    await sharp(finalBuffer).png().toFile(outPng);
    await sharp(finalBuffer).webp({ quality: 95 }).toFile(outWebp);

    manifest.poses[name] = {
      png: `poses/${name}.png`,
      webp: `poses/${name}.webp`,
      width: finalMeta.width,
      height: finalMeta.height,
      aspect: finalMeta.width / finalMeta.height
    };
    console.log(`Saved ${name}: ${finalMeta.width}x${finalMeta.height}`);

    // Generate Face crop
    // Head is in upper center
    const headSize = Math.round(meta.width * (name === 'looking' ? 0.62 : 0.58));
    const left = Math.max(0, Math.min(meta.width - headSize, Math.round((meta.width - headSize) / 2)));
    const top = Math.max(0, Math.min(meta.height - headSize, Math.round(meta.height * (name === 'looking' ? 0.04 : 0.01))));

    const faceCrop = await sharp(buffer)
      .extract({ left, top, width: headSize, height: headSize })
      .resize(160, 160)
      .png()
      .toBuffer();

    await sharp(faceCrop).toFile(path.join(facesDir, `${name}.png`));
    console.log(`Saved face for ${name}`);

    // Map to legacy face names
    if (name === 'neutral') {
      await sharp(faceCrop).toFile(path.join(facesDir, 'normal.png'));
      await sharp(faceCrop).toFile(path.join(facesDir, 'happy.png'));
      // Update icon and tray
      await sharp(faceCrop).resize(256, 256).toFile(path.join(root, 'assets', 'icon.png'));
      await sharp(faceCrop).resize(32, 32).toFile(path.join(root, 'assets', 'tray.png'));
    } else if (name === 'looking-up') {
      await sharp(faceCrop).toFile(path.join(facesDir, 'thinking.png'));
    } else if (name === 'looking') {
      await sharp(faceCrop).toFile(path.join(facesDir, 'surprised.png'));
      await sharp(faceCrop).toFile(path.join(facesDir, 'curious.png'));
    } else if (name === 'nail-look') {
      await sharp(faceCrop).toFile(path.join(facesDir, 'winking.png'));
      await sharp(faceCrop).toFile(path.join(facesDir, 'laughing.png'));
    } else if (name === 'apologies') {
      await sharp(faceCrop).toFile(path.join(facesDir, 'confused.png'));
      await sharp(faceCrop).toFile(path.join(facesDir, 'sad.png'));
    }
  }

  // Also save damu.png as the high-res neutral pose
  fs.copyFileSync(path.join(posesDir, 'neutral.png'), path.join(root, 'assets', 'damu.png'));

  // Save poses manifest
  fs.writeFileSync(path.join(posesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('All poses processed successfully!');
}

run().catch(err => {
  console.error('Error processing:', err);
  process.exit(1);
});

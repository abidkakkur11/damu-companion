// Builds the optimised images used by the landing page (site/assets) from the app's own assets.
// Run: node scripts/make-site-assets.js
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const out = path.join(root, "site", "assets");

(async () => {
  fs.mkdirSync(out, { recursive: true });

  // Poses (already trimmed, transparent)
  for (const pose of ["neutral", "looking-up", "warning", "nail-look"]) {
    await sharp(path.join(root, "assets", "poses", `${pose}.webp`)).resize({ height: 640 }).webp({ quality: 88 }).toFile(path.join(out, `damu-${pose}.webp`));
  }

  // Screenshots
  const shots = path.join(root, "docs", "screenshots");
  for (const name of fs.readdirSync(shots).filter((f) => f.endsWith(".png"))) {
    await sharp(path.join(shots, name)).webp({ quality: 86 }).toFile(path.join(out, name.replace(/\.png$/, ".webp")));
  }

  // Icons
  const icon = path.join(root, "assets", "icon.png");
  await sharp(icon).resize(64, 64).png().toFile(path.join(out, "favicon.png"));
  await sharp(icon).resize(180, 180).png().toFile(path.join(out, "apple-touch-icon.png"));
  await sharp(icon).resize(160, 160).png().toFile(path.join(out, "logo.png"));

  // Social share card (1200x630)
  const damu = await sharp(path.join(out, "damu-neutral.webp")).resize({ height: 560 }).png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <radialGradient id="g1" cx="85%" cy="20%" r="70%"><stop offset="0" stop-color="#ffd96e" stop-opacity=".75"/><stop offset="1" stop-color="#ffd96e" stop-opacity="0"/></radialGradient>
      <radialGradient id="g2" cx="10%" cy="100%" r="80%"><stop offset="0" stop-color="#55b45a" stop-opacity=".55"/><stop offset="1" stop-color="#55b45a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1200" height="630" fill="#fbf6e6"/><rect width="1200" height="630" fill="url(#g1)"/><rect width="1200" height="630" fill="url(#g2)"/>
    <text x="80" y="250" font-family="Segoe UI, Arial, sans-serif" font-size="128" font-weight="800" fill="#26220f">Damu</text>
    <text x="84" y="325" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="600" fill="#2e7d32">Your desktop's favourite visitor</text>
    <text x="84" y="385" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="#6f6638">Free and open source · Windows and macOS</text>
    <rect x="84" y="440" width="270" height="68" rx="34" fill="#2e7d32"/>
    <text x="219" y="485" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#fff">Download free</text>
  </svg>`;
  await sharp(Buffer.from(svg)).composite([{ input: damu, left: 800, top: 50 }]).png().toFile(path.join(out, "og-image.png"));

  // Intro voice for the landing page: a small mono MP3 made from the app's intro clip
  try {
    const { spawnSync } = require("node:child_process");
    const ffmpeg = require("ffmpeg-static");
    const src = path.join(root, "assets", "audio", "intro.wav");
    if (ffmpeg && fs.existsSync(src)) {
      spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "44100", "-b:a", "80k", path.join(out, "intro.mp3")]);
    }
  } catch {}

  console.log("site assets written to site/assets:", fs.readdirSync(out).join(", "));
})();

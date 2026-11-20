// Turns the .wav voice clips of a character into small .mp3 files (mono, 96 kbps: plenty for speech) and removes the
// .wav. The app loads "name.wav" or "name.mp3", so content.json needs no change.
//   node scripts/compress-audio.js <character-id>
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");

const id = process.argv[2];
if (!id) {
  console.error("usage: node scripts/compress-audio.js <character-id>");
  process.exit(1);
}
const dir = path.join(__dirname, "..", "assets", "characters", id, "audio");
let before = 0, after = 0;
for (const f of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".wav"))) {
  const src = path.join(dir, f), dest = path.join(dir, f.replace(/\.wav$/i, ".mp3"));
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-b:a", "96k", dest]);
  if (r.status !== 0 || !fs.existsSync(dest)) { console.error(`failed: ${f}\n${r.stderr}`); continue; }
  before += fs.statSync(src).size; after += fs.statSync(dest).size;
  fs.rmSync(src);
}
console.log(`${id}: ${(before / 1048576).toFixed(1)} MB of wav -> ${(after / 1048576).toFixed(1)} MB of mp3`);

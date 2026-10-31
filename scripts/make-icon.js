// Builds assets/icon.ico (16-256px) from assets/icon.png. Run: node scripts/make-icon.js
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

(async () => {
  const src = path.join(__dirname, "..", "assets", "icon.png");
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => sharp(src).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
  const { default: pngToIco } = await import("png-to-ico");
  fs.writeFileSync(path.join(__dirname, "..", "assets", "icon.ico"), await pngToIco(pngs));
  console.log("wrote assets/icon.ico");
})();

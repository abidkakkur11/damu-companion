// Builds the platform icons from assets/icon.png. Run: node scripts/make-icon.js
//   assets/icon.ico      Windows (16-256px)
//   assets/icon-mac.png  macOS (1024px; electron-builder turns it into .icns on a Mac)
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

(async () => {
  const assets = path.join(__dirname, "..", "assets");
  const src = path.join(assets, "icon.png");
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => sharp(src).resize(s, s, { fit: "contain", background: clear }).png().toBuffer()));
  const { default: pngToIco } = await import("png-to-ico");
  fs.writeFileSync(path.join(assets, "icon.ico"), await pngToIco(pngs));
  await sharp(src).resize(1024, 1024, { fit: "contain", background: clear, kernel: "lanczos3" }).png().toFile(path.join(assets, "icon-mac.png"));
  console.log("wrote assets/icon.ico and assets/icon-mac.png");
})();

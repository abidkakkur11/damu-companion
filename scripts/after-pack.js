// electron-builder's own exe-editing step needs symlink rights that Windows often withholds,
// so it is disabled (signAndEditExecutable: false) and the icon/metadata are set here instead.
// Chromium ships ~55 language packs the app never uses (the UI is English): drop them to keep the app small.
const fs = require("node:fs");
const path = require("node:path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") return;
  const locales = path.join(context.appOutDir, "locales");
  for (const f of fs.existsSync(locales) ? fs.readdirSync(locales) : []) {
    if (f !== "en-US.pak") fs.rmSync(path.join(locales, f));
  }
  const mod = await import("rcedit");
  const rcedit = mod.rcedit || mod.default;
  const { productFilename, version, copyright } = context.packager.appInfo;
  await rcedit(path.join(context.appOutDir, `${productFilename}.exe`), {
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    "file-version": version,
    "product-version": version,
    "version-string": {
      ProductName: "Damu",
      FileDescription: "Damu - desktop companion",
      CompanyName: "Abid KP",
      LegalCopyright: copyright,
      OriginalFilename: `${productFilename}.exe`,
    },
  });
};

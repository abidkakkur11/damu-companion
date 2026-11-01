// electron-builder's own exe-editing step needs symlink rights that Windows often withholds,
// so it is disabled (signAndEditExecutable: false) and the icon/metadata are set here instead.
const path = require("node:path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") return;
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

// "3.10.0" is newer than "3.9.2". Returns false for anything that is not a plain x.y.z version.
const PLAIN = /^\d+\.\d+\.\d+$/;
function isNewer(latest, current) {
  if (!PLAIN.test(latest) || !PLAIN.test(current)) return false;
  const a = latest.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
module.exports = { isNewer, PLAIN };

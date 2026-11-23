// Small unit tests (no app needed): node test/unit.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { isNewer } = createRequire(import.meta.url)("../src/version.js");

assert.equal(isNewer("3.0.1", "3.0.0"), true);
assert.equal(isNewer("3.10.0", "3.9.9"), true, "10 is newer than 9, not older");
assert.equal(isNewer("4.0.0", "3.99.99"), true);
assert.equal(isNewer("3.0.0", "3.0.0"), false, "same version");
assert.equal(isNewer("2.9.9", "3.0.0"), false, "older");
assert.equal(isNewer("3.1.0-beta.1", "3.0.0"), false, "pre-release tags are ignored");
assert.equal(isNewer("", "3.0.0"), false);
assert.equal(isNewer(undefined, "3.0.0"), false);
console.log("unit tests passed");

import { removeBackground } from "@imgly/background-removal-node";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [inp, out] = process.argv.slice(2);
const t = Date.now();
const blob = await removeBackground(pathToFileURL(path.resolve(inp)).href, { model: process.argv[4] || "medium", output: { format: "image/png" } });
fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log("ok", Date.now() - t, "ms");

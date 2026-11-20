import { cpSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");

mkdirSync(output, { recursive: true });

copyFileSync(resolve(root, "index.html"), resolve(output, "index.html"));

for (const file of ["manifest.webmanifest", "sw.js"]) {
  copyFileSync(resolve(root, file), resolve(output, file));
}

for (const file of ["leaveform.html", "palawan-seal.jpg"]) {
  copyFileSync(resolve(root, file), resolve(output, file));
}

cpSync(resolve(root, "icons"), resolve(output, "icons"), { recursive: true });

console.log("Built static app into dist/.");

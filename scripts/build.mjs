import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");

mkdirSync(output, { recursive: true });

const htmlPath = resolve(root, "index.html");
const html = readFileSync(htmlPath, "utf8");
const versionMarker = '<meta name="app-version" content="development">';
if (!html.includes(versionMarker)) {
  throw new Error("Could not find the app-version marker in index.html.");
}

const timestamp = new Date().toISOString();
const version = `${timestamp.slice(0, 10).replaceAll("-", ".")}.${timestamp.slice(11, 19).replaceAll(":", "")}${timestamp.slice(20, 23)}`;
writeFileSync(
  resolve(output, "index.html"),
  html.replace(versionMarker, `<meta name="app-version" content="${version}">`)
);

for (const file of ["manifest.webmanifest", "sw.js"]) {
  copyFileSync(resolve(root, file), resolve(output, file));
}

cpSync(resolve(root, "icons"), resolve(output, "icons"), { recursive: true });

console.log("Built static app into dist/.");

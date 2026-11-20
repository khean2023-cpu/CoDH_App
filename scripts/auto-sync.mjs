import { spawnSync } from "node:child_process";
import { readFileSync, watch, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const debounceMs = 8000;

const git = (args, allowFailure = false) => {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  }
  return { status: result.status, stdout: result.stdout || "" };
};

const requireMainBranch = () => {
  const branch = git(["branch", "--show-current"]).stdout.trim();
  if (branch !== "main") {
    throw new Error(`Auto-sync only pushes main; current branch is "${branch || "(detached)"}".`);
  }
};

const requireSynchronizedMain = () => {
  git(["fetch", "--quiet", "origin", "main"]);
  const counts = git(["rev-list", "--left-right", "--count", "origin/main...HEAD"])
    .stdout.trim().split(/\s+/).map(Number);
  if (counts[0] !== 0 || counts[1] !== 0) {
    throw new Error("Local main is not synchronized with origin/main. Sync the branch before auto-syncing.");
  }
};

const status = () => git(["status", "--porcelain", "--untracked-files=all"]).stdout.trim();
const bumpAppVersion = () => {
  const indexPath = resolve(repoRoot, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const versionMeta = html.match(/(<meta name="app-version" content=")(\d+)\.(\d+)(")/);
  if (!versionMeta) throw new Error('Could not find a numeric "major.minor" app version in index.html.');
  const nextVersion = `${versionMeta[2]}.${Number(versionMeta[3]) + 1}`;
  const updatedHtml = html.replace(versionMeta[0], `${versionMeta[1]}${nextVersion}${versionMeta[4]}`);
  writeFileSync(indexPath, updatedHtml, "utf8");
  console.log(`Bumped app version to ${nextVersion}.`);
};
const sensitivePath = path => {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const fileName = segments.at(-1) || "";
  return segments.some(segment => /^\.env(?:$|\.)/i.test(segment)) ||
    /\.(?:pem|key|p12|pfx)$/i.test(fileName) ||
    /^(?:id_rsa|id_ed25519|credentials\.json|service-account(?:-key)?\.json)$/i.test(fileName);
};

if (process.argv.includes("--check")) {
  requireMainBranch();
  requireSynchronizedMain();
  if (status()) throw new Error("Working tree must be clean before auto-sync starts.");
  console.log("Auto-sync is ready on synchronized main.");
  process.exit(0);
}

try {
  requireMainBranch();
  if (status()) throw new Error("Working tree must be clean before auto-sync starts.");
  requireSynchronizedMain();
} catch (error) {
  console.error(`Auto-sync not started: ${error.message}`);
  process.exit(1);
}

console.log("Auto-sync is watching this workspace. Saved changes will be committed and pushed to main after 8 seconds of inactivity.");

let timer;
let stopped = false;
const watcher = watch(repoRoot, { recursive: true }, (_event, fileName) => {
  const relativePath = fileName?.toString().replaceAll("\\", "/") || "";
  const segments = relativePath.split("/");
  if (
    segments.some(segment =>
      [".git", ".vercel", "node_modules", "dist", "local-demo-blobs"].includes(segment) ||
      /^\.env(?:$|\.)/i.test(segment),
    )
  ) return;

  clearTimeout(timer);
  timer = setTimeout(() => {
    if (stopped) return;
    try {
      requireMainBranch();
      if (!status()) return;
      requireSynchronizedMain();
      git(["add", "--all"]);

      const stagedPaths = git(["diff", "--cached", "--name-only", "-z"]).stdout
        .split("\0").filter(Boolean);
      if (stagedPaths.length === 0) return;

      const blockedPaths = stagedPaths.filter(sensitivePath);
      if (blockedPaths.length > 0) {
        git(["restore", "--staged", "--", ...blockedPaths]);
        throw new Error(`Sensitive-looking files were not committed: ${blockedPaths.join(", ")}`);
      }

      bumpAppVersion();
      git(["add", "--", "index.html"]);
      git(["commit", "-m", `Auto-save from VS Code (${new Date().toISOString()})`]);
      git(["push", "origin", "main"]);
      console.log("Auto-save pushed to origin/main. Vercel will deploy the pushed commit.");
    } catch (error) {
      stopped = true;
      watcher.close();
      clearTimeout(timer);
      console.error(`Auto-sync stopped: ${error.message}`);
      process.exitCode = 1;
    }
  }, debounceMs);
});

watcher.on("error", error => {
  stopped = true;
  clearTimeout(timer);
  console.error(`Auto-sync watcher failed: ${error.message}`);
  process.exitCode = 1;
});

const fs = require("node:fs");
const path = require("node:path");
const {
  inspectBuildInfo,
  readBuildInfoFile,
  sameBuildInfo,
} = require("../electron/build-info.cjs");

const launcherRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(launcherRoot, "..");
const output = path.join(launcherRoot, "build", "build-info.json");
const release = process.argv.includes("--release");

const buildInfo = inspectBuildInfo(repositoryRoot);
if (release && (!buildInfo.sourceRevision || buildInfo.dirty !== false)) {
  const reason = !buildInfo.sourceRevision
    ? "Git source revision is unavailable"
    : buildInfo.dirty === true
      ? "source worktree is dirty"
      : "source cleanliness could not be verified";
  throw new Error(`Custom package creation requires a clean committed source revision: ${reason}`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(buildInfo, null, 2)}\n`);

if (release) {
  const runtimeBuildPath = path.join(launcherRoot, "build", "runtime", "app", "build-info.json");
  const runtimeBuild = readBuildInfoFile(runtimeBuildPath);
  if (!runtimeBuild || !sameBuildInfo(buildInfo, runtimeBuild)) {
    throw new Error(
      "Launcher and runtime build identities must match before packaging; rebuild the runtime from the same clean revision",
    );
  }
}

process.stdout.write(`${output}\n`);

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const BUILD_INFO_KEYS = Object.freeze([
  "schemaVersion",
  "distribution",
  "repository",
  "sourceRevision",
  "dirty",
]);
const REPOSITORY = "hpete28/codex-chatgpt-web";
const REVISION_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

function validateBuildInfo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const keys = Reflect.ownKeys(value);
  if (keys.length !== BUILD_INFO_KEYS.length
    || keys.some((key) => typeof key !== "string" || !BUILD_INFO_KEYS.includes(key))) {
    return null;
  }
  if (value.schemaVersion !== 1) return null;
  if (value.distribution !== "custom") return null;
  if (value.repository !== REPOSITORY) return null;
  if (value.sourceRevision !== null
    && (typeof value.sourceRevision !== "string" || !REVISION_PATTERN.test(value.sourceRevision))) {
    return null;
  }
  if (value.dirty !== null && typeof value.dirty !== "boolean") return null;

  return Object.freeze({
    schemaVersion: 1,
    distribution: "custom",
    repository: REPOSITORY,
    sourceRevision: value.sourceRevision,
    dirty: value.dirty,
  });
}

function gitOutput(repositoryRoot, args, execute) {
  try {
    const result = execute("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result?.error || result?.status !== 0) return null;
    return String(result.stdout ?? "");
  } catch {
    return null;
  }
}

function inspectBuildInfo(repositoryRoot, dependencies = {}) {
  const execute = dependencies.spawnSync || spawnSync;
  const rawRevision = gitOutput(repositoryRoot, ["rev-parse", "HEAD"], execute);
  const sourceRevision = rawRevision === null ? null : rawRevision.trim();
  if (!sourceRevision || !REVISION_PATTERN.test(sourceRevision)) {
    return validateBuildInfo({
      schemaVersion: 1,
      distribution: "custom",
      repository: REPOSITORY,
      sourceRevision: null,
      dirty: null,
    });
  }

  const status = gitOutput(
    repositoryRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    execute,
  );
  return validateBuildInfo({
    schemaVersion: 1,
    distribution: "custom",
    repository: REPOSITORY,
    sourceRevision,
    dirty: status === null ? null : status.trim().length > 0,
  });
}

function readBuildInfoFile(filePath) {
  try {
    return validateBuildInfo(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function sameBuildInfo(left, right) {
  const validatedLeft = validateBuildInfo(left);
  const validatedRight = validateBuildInfo(right);
  if (!validatedLeft || !validatedRight) return false;
  return BUILD_INFO_KEYS.every((key) => validatedLeft[key] === validatedRight[key]);
}

module.exports = {
  inspectBuildInfo,
  readBuildInfoFile,
  sameBuildInfo,
  validateBuildInfo,
};

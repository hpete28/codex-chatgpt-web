"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renameAtomicFile } = require("./atomic-file.cjs");
const { validateBuildInfo } = require("./build-info.cjs");
const { validateTurnObservation } = require("./turn-observations.cjs");

const MAX_DIAGNOSTIC_REPORT_BYTES = 256 * 1024;
const DOCTOR_STATUSES = new Set(["ok", "warning", "error"]);
const KNOWN_DOCTOR_IDS = new Set([
  "config",
  "browser-host",
  "chrome",
  "login",
  "codex",
  "service",
  "proxy",
  "tunnel-binary",
  "tunnel-key",
  "tunnel-service",
  "tunnel-runtime",
  "connector",
  "tools",
  "runtime",
  "dev-profile",
  "dev-tunnel-credentials",
  "dev-tunnel-runtime",
  "responses-listener",
  "launcher-build",
  "runtime-build",
  "build-match",
]);
const UNAVAILABLE_ORDER = Object.freeze([
  "launcher-build",
  "runtime-build",
  "runtime-bundle",
  "doctor",
  "turn",
  "mode",
  "interaction-mode",
]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
let temporarySequence = 0;

function validTimestamp(value) {
  return typeof value === "string"
    && ISO_TIMESTAMP.test(value)
    && Number.isFinite(Date.parse(value));
}

function publicBuildInfo(value) {
  const validated = validateBuildInfo(value);
  return validated ? { ...validated } : null;
}

function publicDoctor(cache) {
  if (!cache || !validTimestamp(cache.observedAt) || !Array.isArray(cache.report?.checks)) {
    return { available: false, value: { observedAt: null, checks: [] } };
  }
  const checks = [];
  for (const check of cache.report.checks) {
    if (!check || typeof check !== "object") continue;
    if (!KNOWN_DOCTOR_IDS.has(check.id) || !DOCTOR_STATUSES.has(check.status)) continue;
    checks.push({ id: check.id, status: check.status });
  }
  return {
    available: true,
    value: { observedAt: cache.observedAt, checks },
  };
}

function publicTurn(value) {
  if (!value) return null;
  let observation;
  try {
    observation = validateTurnObservation(value);
  } catch {
    return null;
  }
  return {
    traceId: observation.traceId,
    phase: observation.phase,
    observedAt: observation.at,
    ...(observation.acknowledgedParts !== undefined ? {
      acknowledgedParts: observation.acknowledgedParts,
      totalParts: observation.totalParts,
    } : {}),
    ...(observation.continuationCount !== undefined
      ? { continuationCount: observation.continuationCount }
      : {}),
    ...(observation.workState !== undefined ? { workState: observation.workState } : {}),
  };
}

function buildDiagnosticReport(input, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== "object") throw new Error("Diagnostic report input is required");
  if (input.profile !== "production" && input.profile !== "development") {
    throw new Error("Diagnostic report profile is invalid");
  }
  if (typeof input.appVersion !== "string" || input.appVersion.length === 0) {
    throw new Error("Diagnostic report app version is invalid");
  }

  const generatedAt = now();
  if (!validTimestamp(generatedAt)) throw new Error("Diagnostic report timestamp is invalid");

  const launcherBuild = publicBuildInfo(input.launcherBuild);
  const runtimeBuild = publicBuildInfo(input.runtimeBuild);
  const runtimeBundleId = typeof input.runtimeBundleId === "string" && /^[a-f0-9]{64}$/.test(input.runtimeBundleId)
    ? input.runtimeBundleId
    : null;
  const mode = input.mode === "full" || input.mode === "browser-only" ? input.mode : null;
  const interactionMode = input.interactionMode === "automatic" || input.interactionMode === "manual"
    ? input.interactionMode
    : null;
  const doctor = publicDoctor(input.doctorCache);
  const turn = publicTurn(input.turnObservation);

  const availability = new Map([
    ["launcher-build", launcherBuild !== null],
    ["runtime-build", runtimeBuild !== null],
    ["runtime-bundle", runtimeBundleId !== null],
    ["doctor", doctor.available],
    ["turn", turn !== null],
    ["mode", mode !== null],
    ["interaction-mode", interactionMode !== null],
  ]);

  return {
    schemaVersion: 1,
    generatedAt,
    appVersion: input.appVersion,
    profile: input.profile,
    mode,
    interactionMode,
    launcherBuild,
    runtimeBuild,
    runtimeBundleId,
    doctor: doctor.value,
    turn,
    unavailable: UNAVAILABLE_ORDER.filter((key) => availability.get(key) !== true),
  };
}

function comparablePath(filePath, platform) {
  const resolved = path.resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function saveDiagnosticReport({ destinationPath, report, protectedPaths = [] }, dependencies = {}) {
  const fsImpl = dependencies.fs || fs;
  const platform = dependencies.platform || process.platform;
  if (typeof destinationPath !== "string" || !path.isAbsolute(destinationPath)) {
    throw new Error("Diagnostic report destination must be an absolute path");
  }
  if (path.extname(destinationPath).toLowerCase() !== ".json") {
    throw new Error("Diagnostic report destination must use the .json extension");
  }

  const destinationComparable = comparablePath(destinationPath, platform);
  for (const sourcePath of protectedPaths) {
    if (typeof sourcePath !== "string" || sourcePath.length === 0) continue;
    if (destinationComparable === comparablePath(sourcePath, platform)) {
      throw new Error("Diagnostic report destination is an active launcher source file");
    }
  }

  const content = `${JSON.stringify(report, null, 2)}\n`;
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > MAX_DIAGNOSTIC_REPORT_BYTES) {
    throw new Error(`Diagnostic report exceeds ${MAX_DIAGNOSTIC_REPORT_BYTES} bytes`);
  }

  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}-${++temporarySequence}`;
  const rename = dependencies.rename || fsImpl.renameSync.bind(fsImpl);
  try {
    fsImpl.writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
    renameAtomicFile(temporaryPath, destinationPath, {
      platform,
      rename,
      ...(dependencies.wait ? { wait: dependencies.wait } : {}),
    });
  } finally {
    try { fsImpl.rmSync(temporaryPath, { force: true }); } catch {}
  }
  return byteLength;
}

module.exports = {
  KNOWN_DOCTOR_IDS,
  MAX_DIAGNOSTIC_REPORT_BYTES,
  buildDiagnosticReport,
  saveDiagnosticReport,
};

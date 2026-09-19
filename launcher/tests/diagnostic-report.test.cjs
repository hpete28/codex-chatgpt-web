const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_DIAGNOSTIC_REPORT_BYTES,
  buildDiagnosticReport,
  saveDiagnosticReport,
} = require("../electron/diagnostic-report.cjs");

const GENERATED_AT = "2026-09-18T12:00:00.000Z";
const DOCTOR_AT = "2026-09-18T11:00:00.000Z";
const REVISION = "a".repeat(40);
const BUNDLE_ID = "b".repeat(64);
const SECRET = "F3_SECRET_SHOULD_NEVER_APPEAR";

function buildInfo(overrides = {}) {
  return {
    schemaVersion: 1,
    distribution: "custom",
    repository: "hpete28/codex-chatgpt-web",
    sourceRevision: REVISION,
    dirty: false,
    ...overrides,
  };
}

function turn(overrides = {}) {
  return {
    traceId: "trace-123",
    sequence: 4,
    at: "2026-09-18T11:30:00.000Z",
    phase: "continuing",
    acknowledgedParts: 3,
    totalParts: 4,
    continuationCount: 1,
    workState: "continue",
    ...overrides,
  };
}

function fullInput(overrides = {}) {
  return {
    appVersion: "5.0.7",
    profile: "development",
    mode: "full",
    interactionMode: "automatic",
    launcherBuild: buildInfo(),
    runtimeBuild: buildInfo(),
    runtimeBundleId: BUNDLE_ID,
    doctorCache: {
      observedAt: DOCTOR_AT,
      report: {
        ok: false,
        mode: "full",
        checks: [
          { id: "config", status: "ok", message: SECRET, detail: SECRET },
          { id: "connector", status: "error", message: SECRET, arbitrary: SECRET },
          { id: "unknown-check", status: "error", message: SECRET },
        ],
        private: SECRET,
      },
    },
    turnObservation: turn(),
    prompt: SECRET,
    answer: SECRET,
    config: { tunnelId: SECRET },
    snapshot: { profilePaths: { userData: SECRET } },
    ...overrides,
  };
}

test("builder emits exactly the allowlisted F3 schema and strips private source fields", () => {
  const report = buildDiagnosticReport(fullInput(), { now: () => GENERATED_AT });
  assert.deepEqual(Object.keys(report), [
    "schemaVersion",
    "generatedAt",
    "appVersion",
    "profile",
    "mode",
    "interactionMode",
    "launcherBuild",
    "runtimeBuild",
    "runtimeBundleId",
    "doctor",
    "turn",
    "unavailable",
  ]);
  assert.deepEqual(Object.keys(report.doctor), ["observedAt", "checks"]);
  assert.deepEqual(report.doctor.checks, [
    { id: "config", status: "ok" },
    { id: "connector", status: "error" },
  ]);
  assert.deepEqual(Object.keys(report.turn), [
    "traceId",
    "phase",
    "observedAt",
    "acknowledgedParts",
    "totalParts",
    "continuationCount",
    "workState",
  ]);
  assert.deepEqual(report.unavailable, []);
  assert.equal(JSON.stringify(report).includes(SECRET), false);
});

test("builder revalidates build identity and turn summaries", () => {
  const report = buildDiagnosticReport(fullInput({
    launcherBuild: { ...buildInfo(), extra: SECRET },
    runtimeBuild: null,
    runtimeBundleId: `x${BUNDLE_ID.slice(1)}`,
    turnObservation: { ...turn(), prompt: SECRET },
  }), { now: () => GENERATED_AT });
  assert.equal(report.launcherBuild, null);
  assert.equal(report.runtimeBuild, null);
  assert.equal(report.runtimeBundleId, null);
  assert.equal(report.turn, null);
  assert.deepEqual(report.unavailable, ["launcher-build", "runtime-build", "runtime-bundle", "turn"]);
});

test("missing runtime, doctor, and F2 evidence produces a valid partial report", () => {
  const report = buildDiagnosticReport({
    appVersion: "5.0.7",
    profile: "production",
    mode: null,
    interactionMode: null,
    launcherBuild: buildInfo(),
    runtimeBuild: null,
    runtimeBundleId: null,
    doctorCache: null,
    turnObservation: null,
  }, { now: () => GENERATED_AT });
  assert.deepEqual(report.doctor, { observedAt: null, checks: [] });
  assert.equal(report.turn, null);
  assert.deepEqual(report.unavailable, [
    "runtime-build",
    "runtime-bundle",
    "doctor",
    "turn",
    "mode",
    "interaction-mode",
  ]);
});

test("doctor completion timestamp survives unchanged and unknown checks are omitted", () => {
  const report = buildDiagnosticReport(fullInput(), { now: () => GENERATED_AT });
  assert.equal(report.generatedAt, GENERATED_AT);
  assert.equal(report.doctor.observedAt, DOCTOR_AT);
  assert.equal(report.doctor.checks.some((check) => check.id === "unknown-check"), false);
});

test("profile is explicit and never inferred from another fixture", () => {
  const production = buildDiagnosticReport(fullInput({ profile: "production", turnObservation: null }), { now: () => GENERATED_AT });
  const development = buildDiagnosticReport(fullInput({ profile: "development", turnObservation: null }), { now: () => GENERATED_AT });
  assert.equal(production.profile, "production");
  assert.equal(development.profile, "development");
  assert.equal(production.turn, null);
  assert.equal(development.turn, null);
});

test("save writes parseable JSON and protects known source paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-report-test-"));
  const destinationPath = path.join(root, "report.json");
  const sourcePath = path.join(root, "launcher-state.json");
  try {
    const report = buildDiagnosticReport(fullInput(), { now: () => GENERATED_AT });
    const bytes = saveDiagnosticReport({ destinationPath, report, protectedPaths: [sourcePath] });
    assert.ok(bytes > 0 && bytes < MAX_DIAGNOSTIC_REPORT_BYTES);
    assert.deepEqual(JSON.parse(fs.readFileSync(destinationPath, "utf8")), report);
    assert.throws(
      () => saveDiagnosticReport({ destinationPath: sourcePath, report, protectedPaths: [sourcePath] }),
      /active launcher source file/,
    );
    assert.equal(fs.existsSync(sourcePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("save failure preserves an existing destination and removes the temporary sibling", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-report-failure-"));
  const destinationPath = path.join(root, "report.json");
  const original = "original report\n";
  fs.writeFileSync(destinationPath, original);
  try {
    const report = buildDiagnosticReport(fullInput(), { now: () => GENERATED_AT });
    assert.throws(
      () => saveDiagnosticReport(
        { destinationPath, report },
        {
          platform: "linux",
          rename() {
            const error = new Error("injected rename failure");
            error.code = "EIO";
            throw error;
          },
        },
      ),
      /injected rename failure/,
    );
    assert.equal(fs.readFileSync(destinationPath, "utf8"), original);
    assert.deepEqual(fs.readdirSync(root), ["report.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("size and extension limits fail before replacing a destination", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-report-limit-"));
  const destinationPath = path.join(root, "report.json");
  fs.writeFileSync(destinationPath, "original\n");
  try {
    assert.throws(
      () => saveDiagnosticReport({
        destinationPath,
        report: { payload: "x".repeat(MAX_DIAGNOSTIC_REPORT_BYTES) },
      }),
      /exceeds/,
    );
    assert.equal(fs.readFileSync(destinationPath, "utf8"), "original\n");
    assert.throws(
      () => saveDiagnosticReport({ destinationPath: path.join(root, "report.txt"), report: {} }),
      /\.json extension/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

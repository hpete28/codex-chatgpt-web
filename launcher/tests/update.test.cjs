const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  buildJob,
  compareVersions,
  createUpdateController,
  expectedChecksum,
  macApplicationPath,
  releaseAssetName,
  validateReleaseAssetUrl,
} = require("../electron/update.cjs");

const customBuildInfo = {
  schemaVersion: 1,
  distribution: "custom",
  repository: "hpete28/codex-chatgpt-web",
  sourceRevision: "a".repeat(40),
  dirty: false,
};

test("Linux auto-update fails closed without the stable installer wrapper", () => {
  const previousAppImage = process.env.CODEX_WEB_GPT_APPIMAGE;
  const previousWrapper = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_APPIMAGE = "/opt/codex/Codex Web GPT.AppImage";
  delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  try {
    assert.throws(() => buildJob({
      version: "1.2.0",
      platform: "linux",
      executablePath: "/tmp/transient",
      assetPath: "/tmp/update.AppImage",
      stagingRoot: "/tmp/stage",
      tempRoot: "/tmp/update",
      logPath: "/tmp/update.log",
    }), /requires the stable install-launcher\.sh wrapper/);
  } finally {
    if (previousAppImage === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previousAppImage;
    if (previousWrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousWrapper;
  }
});

test("release comparison and platform assets are strict", () => {
  assert.equal(compareVersions("1.1.5", "1.1.4"), 1);
  assert.equal(compareVersions("1.1.4", "1.1.4"), 0);
  assert.equal(compareVersions("1.1.3", "1.1.4"), -1);
  assert.equal(compareVersions("1.2.0", "1.1.99"), 1);
  assert.equal(releaseAssetName("1.2.0", "darwin", "arm64"), "codex-web-gpt-1.2.0-mac-arm64.zip");
  assert.equal(releaseAssetName("1.2.0", "darwin", "x64"), "codex-web-gpt-1.2.0-mac-x64.zip");
  assert.equal(releaseAssetName("1.2.0", "win32", "x64"), "codex-web-gpt-1.2.0-win-x64.exe");
  assert.equal(releaseAssetName("1.2.0", "linux", "x64"), "codex-web-gpt-1.2.0-linux-x64.AppImage");
  assert.equal(releaseAssetName("1.2.0", "linux", "arm64"), null);
});

test("checksums and release URLs bind the exact expected asset", () => {
  const hash = "a".repeat(64);
  assert.equal(expectedChecksum(`${hash}  launcher.zip\n`, "launcher.zip"), hash);
  assert.throws(() => expectedChecksum(`${hash}  other.zip\n`, "launcher.zip"), /no entry/);
  assert.equal(
    validateReleaseAssetUrl(
      "https://github.com/miuuyy/codex-chatgpt-web/releases/download/v1.2.0/launcher.zip",
      "1.2.0",
      "launcher.zip",
    ),
    "https://github.com/miuuyy/codex-chatgpt-web/releases/download/v1.2.0/launcher.zip",
  );
  assert.throws(
    () => validateReleaseAssetUrl("https://example.com/launcher.zip", "1.2.0", "launcher.zip"),
    /unexpected release asset URL/,
  );
});

test("macOS bundle resolution never guesses outside Contents/MacOS", () => {
  assert.equal(
    macApplicationPath("/Applications/Codex Web GPT.app/Contents/MacOS/Codex Web GPT"),
    "/Applications/Codex Web GPT.app",
  );
  assert.throws(() => macApplicationPath("/tmp/Codex Web GPT"), /Could not resolve/);
});

test("custom packaged builds disable public update checks before release access", async () => {
  let calls = 0;
  const controller = createUpdateController({
    currentVersion: "1.1.4",
    platform: "linux",
    arch: "x64",
    packaged: true,
    buildInfo: customBuildInfo,
    executablePath: "/tmp/launcher",
    runtimeExecutable: "/tmp/bun",
    logsDirectory: "/tmp/logs",
    dependencies: {
      fetchRelease: async () => {
        calls += 1;
        return {};
      },
    },
  });
  assert.deepEqual(controller.getState(), { status: "disabled", reason: "custom-build" });
  assert.deepEqual(await controller.checkOnce(), { status: "disabled", reason: "custom-build" });
  await assert.rejects(controller.beginInstall(), /disabled for this custom build/);
  assert.equal(calls, 0);
});

test("unknown packaged build identity also disables public updates", async () => {
  let calls = 0;
  const controller = createUpdateController({
    currentVersion: "1.1.4",
    platform: "win32",
    arch: "x64",
    packaged: true,
    buildInfo: null,
    executablePath: "C:\\Codex Web GPT.exe",
    runtimeExecutable: "C:\\runtime\\bun.exe",
    logsDirectory: "C:\\logs",
    dependencies: {
      fetchRelease: async () => { calls += 1; return {}; },
    },
  });
  assert.deepEqual(controller.getState(), { status: "disabled", reason: "unknown-build" });
  assert.deepEqual(await controller.checkOnce(), { status: "disabled", reason: "unknown-build" });
  await assert.rejects(controller.beginInstall(), /identity is unknown/);
  assert.equal(calls, 0);
});
test("detached worker replaces an installed Linux AppImage and removes the old version", {
  skip: process.platform === "win32" ? "Linux AppImage execution is not meaningful on Windows" : false,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-worker-test-"));
  const jobRoot = path.join(root, "job");
  const versionsRoot = path.join(root, "versions");
  const oldTarget = path.join(versionsRoot, "1.1.4", "Codex Web GPT.AppImage");
  const newTarget = path.join(versionsRoot, "1.2.0", "Codex Web GPT.AppImage");
  const wrapper = path.join(root, "bin", "codex-web-gpt");
  const marker = path.join(root, "launched");
  const source = path.join(jobRoot, "update.AppImage");
  const runnerSource = path.join(jobRoot, "run-appimage");
  const logPath = path.join(root, "logs", "update-worker.log");
  fs.mkdirSync(path.dirname(oldTarget), { recursive: true });
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.mkdirSync(jobRoot, { recursive: true });
  fs.writeFileSync(oldTarget, "old");
  fs.writeFileSync(wrapper, "old wrapper");
  fs.writeFileSync(source, `#!/bin/sh\nprintf launched > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  fs.writeFileSync(runnerSource, "#!/bin/sh\ntarget=\"$1\"\nshift\nexec \"$target\" \"$@\"\n", { mode: 0o755 });
  const jobPath = path.join(jobRoot, "job.json");
  fs.writeFileSync(jobPath, JSON.stringify({
    version: "1.2.0",
    platform: "linux",
    parentPid: 2_147_483_647,
    tempRoot: jobRoot,
    logPath,
    source,
    target: oldTarget,
    wrapper,
    runnerSource,
  }));
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "electron", "update-worker.cjs"), jobPath], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(newTarget), true);
    assert.equal(fs.existsSync(path.dirname(oldTarget)), false);
    assert.match(fs.readFileSync(wrapper, "utf8"), /versions\/1\.2\.0\/Codex Web GPT\.AppImage/);
    assert.doesNotMatch(fs.readFileSync(wrapper, "utf8"), /APPIMAGE_EXTRACT_AND_RUN/);
    assert.equal(fs.existsSync(path.join(versionsRoot, "run-appimage")), true);
    const deadline = Date.now() + 3_000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    assert.equal(fs.readFileSync(marker, "utf8"), "launched");
    assert.match(fs.readFileSync(logPath, "utf8"), /installed and relaunched/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

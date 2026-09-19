const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  inspectBuildInfo,
  readBuildInfoFile,
  sameBuildInfo,
  validateBuildInfo,
} = require("../electron/build-info.cjs");

const REVISION = "a".repeat(40);

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

function gitResults(...results) {
  let call = 0;
  return (command, args, options) => {
    assert.equal(command, "git");
    assert.deepEqual(options, {
      cwd: "C:/repository",
      encoding: "utf8",
      windowsHide: true,
    });
    const result = results[call];
    call += 1;
    assert.ok(result, `unexpected git call: ${args.join(" ")}`);
    assert.deepEqual(args, result.args);
    return result.value;
  };
}

test("inspectBuildInfo reports a clean Git revision", () => {
  const info = inspectBuildInfo("C:/repository", {
    spawnSync: gitResults(
      {
        args: ["rev-parse", "HEAD"],
        value: { status: 0, stdout: `${REVISION}\n` },
      },
      {
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
        value: { status: 0, stdout: "" },
      },
    ),
  });

  assert.deepEqual(info, buildInfo());
  assert.equal(Object.isFrozen(info), true);
});

test("inspectBuildInfo treats tracked changes and untracked files as dirty", () => {
  for (const output of [" M launcher/electron/main.cjs\n", "?? untracked.txt\n"]) {
    const info = inspectBuildInfo("C:/repository", {
      spawnSync: gitResults(
        {
          args: ["rev-parse", "HEAD"],
          value: { status: 0, stdout: `${REVISION}\n` },
        },
        {
          args: ["status", "--porcelain=v1", "--untracked-files=all"],
          value: { status: 0, stdout: output },
        },
      ),
    });
    assert.deepEqual(info, buildInfo({ dirty: true }));
  }
});

test("inspectBuildInfo returns unknown revision and dirty state outside Git", () => {
  let calls = 0;
  const info = inspectBuildInfo("C:/repository", {
    spawnSync(command, args) {
      calls += 1;
      assert.equal(command, "git");
      assert.deepEqual(args, ["rev-parse", "HEAD"]);
      return { status: 128, stdout: "" };
    },
  });

  assert.deepEqual(info, buildInfo({ sourceRevision: null, dirty: null }));
  assert.equal(calls, 1);
});

test("a valid revision with a failed status check has unknown dirty state", () => {
  const info = inspectBuildInfo("C:/repository", {
    spawnSync: gitResults(
      {
        args: ["rev-parse", "HEAD"],
        value: { status: 0, stdout: `${REVISION}\n` },
      },
      {
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
        value: { status: 1, stdout: "" },
      },
    ),
  });

  assert.deepEqual(info, buildInfo({ dirty: null }));
});

test("validation maps malformed or non-exact BuildInfo to unknown", () => {
  assert.equal(validateBuildInfo(null), null);
  assert.equal(validateBuildInfo({ ...buildInfo(), extra: true }), null);
  const { dirty: _dirty, ...missingField } = buildInfo();
  assert.equal(validateBuildInfo(missingField), null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-info-test-"));
  const malformedPath = path.join(root, "build-info.json");
  try {
    fs.writeFileSync(malformedPath, JSON.stringify(buildInfo()));
    const valid = readBuildInfoFile(malformedPath);
    assert.deepEqual(valid, buildInfo());
    assert.equal(Object.isFrozen(valid), true);
    fs.writeFileSync(malformedPath, "{not-json}");
    assert.equal(readBuildInfoFile(malformedPath), null);
    fs.writeFileSync(malformedPath, JSON.stringify({ ...buildInfo(), extra: true }));
    assert.equal(readBuildInfoFile(malformedPath), null);
    assert.equal(readBuildInfoFile(path.join(root, "missing.json")), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid revisions are represented as unknown", () => {
  for (const sourceRevision of ["abc", "g".repeat(40), "a".repeat(39), "a".repeat(41)]) {
    assert.equal(validateBuildInfo(buildInfo({ sourceRevision })), null);
  }

  let calls = 0;
  const info = inspectBuildInfo("C:/repository", {
    spawnSync() {
      calls += 1;
      return { status: 0, stdout: "not-a-full-revision\n" };
    },
  });
  assert.deepEqual(info, buildInfo({ sourceRevision: null, dirty: null }));
  assert.equal(calls, 1);
});

test("sameBuildInfo compares every frozen schema field", () => {
  const left = validateBuildInfo(buildInfo());
  const same = validateBuildInfo({ ...buildInfo() });
  const differentRevision = validateBuildInfo(buildInfo({ sourceRevision: "b".repeat(64) }));
  const differentDirty = validateBuildInfo(buildInfo({ dirty: true }));

  assert.equal(Object.isFrozen(left), true);
  assert.equal(sameBuildInfo(left, same), true);
  assert.equal(sameBuildInfo(left, differentRevision), false);
  assert.equal(sameBuildInfo(left, differentDirty), false);
  assert.equal(sameBuildInfo(null, null), false);
  assert.equal(sameBuildInfo(left, null), false);
  assert.equal(sameBuildInfo(left, { ...buildInfo(), extra: true }), false);
});

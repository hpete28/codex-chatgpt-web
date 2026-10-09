# F1: Custom build identity and update protection

Status: specified, not implemented. Priority: first. User outcome: identify the installed custom code and avoid replacing it through the public upstream updater.

## Existing foundations and change boundary

Reuse the runtime schema-2 manifest, `bundleId` verification, `runtime-install.cjs`, `createUpdateController` in `update.cjs`, launcher snapshot/Settings, and `doctor.ts`. Preserve strict release URLs/checksums and transactional installation. Bundle identity already solves same-version file replacement; do not redesign it.

Expected changes: build/package scripts, a small packaged identity reader, updater policy/tests, main/preload/types wiring as needed, Settings/i18n, doctor, runtime-layout/packaging tests, README and troubleshooting. Do not change browser, broker, context, model catalog, installation ownership or route journals.

## Required design

F1-R1. Add a versioned packaged `build-info.json` with exactly the public fields below. Generate it at build time; do not infer installed provenance from the user's current Git checkout at runtime.

```ts
type BuildInfo = {
  schemaVersion: 1;
  distribution: "custom";
  repository: "hpete28/codex-chatgpt-web";
  sourceRevision: string | null; // full Git commit, validated hexadecimal
  dirty: boolean | null;       // true/false when inspected, null when unavailable
};
```

The custom checkout defaults to this identity. No runtime repository picker or arbitrary update URL is introduced. A future public distribution mode needs its own task. Untracked nonignored files count as dirty, conservatively; release builds must come from a clean isolated worktree. Missing Git metadata in an ordinary development build yields null fields, never a fabricated revision. A distributable custom package requires an actual clean source revision; use the existing release/package entry points to enforce this, without preventing ordinary dirty-tree DEV builds.

F1-R2. Package identity with both launcher and runtime from the same build revision. Include the runtime copy under `app/` in the existing hashed file inventory so provenance changes affect `bundleId`. Preserve manifest schema 2. The launcher copy must be inside packaged resources; the packaged app must read it independently of the working directory. Validate shape, length and allowed values on read. Never accept an environment variable or editable user setting as proof of upstream identity.

F1-R3. Represent missing, malformed or legacy identity as **unknown** at read time. Legacy schema-2 bundles remain readable; do not reject an otherwise valid runtime just because it predates provenance. New package creation must enforce R1/R2. An unknown identity must not claim a verified source commit or clean build.

F1-R4. In this fork, custom **and unknown** identity disable public update checks and installs, at the controller boundary, not merely in the renderer. Extend disabled state with an optional fixed reason such as `custom-build` or `unknown-build`; keep unsupported-platform/DEV behavior. Direct IPC invocation must fail before network/download/staging/worker creation. Remove any path that can enable the public updater through a saved preference. The existing URL/checksum helper tests remain useful, but enabled-controller tests must be adjusted to the actual supported policy rather than adding a production bypass for tests.

F1-R5. Settings shows version, distribution, short source revision (full in diagnostic data), dirty/unknown state, and runtime bundle ID when available. Show launcher and runtime identity separately if they differ. Do not present a same-version launcher/runtime mismatch as healthy. Doctor should report an explicit warning when provenance is absent or mismatched; retain existing readiness/ownership checks. These are source identity claims, not cryptographic signatures or proof of live correctness.

F1-R6. Explain disabled updates in plain language: this custom build uses reviewed upstream integration and a separately authorized install. Update fork-facing README/troubleshooting instructions so their upstream installers are clearly labelled and are not the default repair path for this fork. Keep attribution and license text. Do not add a link promising fork installers that have not been produced.

## Acceptance

| ID | Observable check |
| --- | --- |
| F1-A1 | Clean committed candidate packages the exact revision in both copies; bundled runtime inventory hashes the identity file. |
| F1-A2 | Dirty/non-Git development source gives truthful dirty/unknown metadata; release package creation refuses it with an actionable error. |
| F1-A3 | Custom packaged app performs zero updater release/download calls on startup or direct install invocation; no update worker is spawned. |
| F1-A4 | Missing, malformed and legacy metadata cannot enable updates, but a valid legacy runtime is still readable. |
| F1-A5 | Same-version different revisions/bundle IDs display distinctly; mismatch and unknown states are visible and appear in doctor evidence. |
| F1-A6 | Existing file-integrity, same-version replacement, failed-candidate preservation and locked-cleanup tests pass. |
| F1-A7 | Package smoke verifies both identity files; isolated packaged/DEV visual check shows accurate labels. Existing state is not migrated destructively. |

Use `launcher/tests/update.test.cjs`, `runtime-install.test.cjs`, `packaging-contract.test.cjs`, `renderer-wiring.test.cjs`, root `tests/runtime-layout.test.ts`, and focused new identity/doctor tests where needed. Follow plan-wide gates. Test the controller and real packaged wiring, not only source-string matching.

## Explicit exclusions

No fork release feed, updater override switch, private signing system, rollback UI, automatic upstream merge, version-number inflation, or broad package renaming. This feature prevents a public updater path and identifies builds; it does not deploy one.

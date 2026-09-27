# Stock Codex Mixed-Root Production Cutover

## SEPTEMBER 26 PRODUCTION CUTOVER — COMPLETED (CURRENT AUTHORITY)

The stock-Codex cutover was completed and verified after the historical sections below were written. Do not repeat the earlier deployment or remove rollback assets merely because older phases below are phrased as pending.

- Installed Codex Web GPT: **6.1.0**, clean source/build revision `55f430876beee47319df703b4d377efe4d7d29f9`. Corrected Windows package is installed and the runtime is materialized.
- Current managed route: `http://127.0.0.1:17841/mixed-root/v1`; `mixedRootRouting=true`. Route journal inspection reports installed, active and no errors. The bridge health check reports `status=ok`, version 6.1.0, and `accepting_turns=true`.
- Global `~\.codex\config.toml`: root `model="gpt-6-sol"`; official `[agents] default_subagent_model="chatgpt-web/gpt-5.6-sol"`. The alpha9.2-only `web_only_subagent_models` entry was removed. Other unrelated settings were retained.
- USER-level `CODEX_CLI_PATH` was removed and verified absent. The official desktop was fully restarted; its actual app-server runs `C:\Users\Peter\AppData\Local\OpenAI\Codex\bin\d23520d1e41bfb24\codex.exe`, version `codex-cli 0.158.0-alpha.2`, under OpenAI desktop package `26.924.1866.0`. The stock Code Mode companion exists. No alpha9.2 app-server remains.
- Real installed-production Web turn **PASS**: `%TEMP%\stock-prod-web-probe-20260926213706\stdout-closed-stdin.jsonl`. A stock Codex Web-root request completed with the requested marker; Markdown-escaped underscores explain the old literal checker mismatch.
- Real production stock-native-root -> automatically selected Web-child delegation **PASS**: root thread `01a0e088-567d-7601-a2ff-a3b59c64b8c3`, child thread `01a0e088-a8d9-7912-b0cc-49e2f11db7b5`. Canonical rollouts show native `gpt-6-sol` root, one `chatgpt-web/gpt-5.6-sol` child, successful spawn, successful `wait_agent` returning the parsed completed child marker, and both sessions completed. Parent emitted its completion marker. Evidence is saved privately in the rollback checkpoint.
- Known non-blocking transport caveat: stock 0.158 first attempted WebSocket at the HTTP-only mixed-root endpoint, received 403 retries, then fell back to HTTPS/HTTP successfully. The real delegation completed. Consider a separate narrow transport-compatibility improvement only if this causes repeated user-facing delay; do not weaken lineage checks or disable TLS.
- The old Windows scheduled task `Codex Custom Update Watch` was **disabled, not deleted**, after stock acceptance; its XML was exported as rollback.
- Private rollback checkpoint: `C:\Users\Peter\AppData\Local\CodexMixedRootRollback\20260926-214120` contains pre-cutover config, model cache, integration journal/recovery, bridge config, prior override and scheduled-task XML. The old custom executable remains at `C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`. Prior bridge runtimes are retained.
- The test verifies root/child inference and parent continuation. A fresh post-restart iPhone remote UI turn and production connector tool-call attachment were not separately exercised; check these only if the user encounters a problem.

The installed application remains built from source revision `55f4308`; any subsequent documentation-only commit does not imply the application was rebuilt.

## Goal

Finish and deploy the mixed-root architecture so the official OpenAI Codex desktop/backend can stay stock and receive normal OpenAI updates, while `codex-chatgpt-web` handles protected ChatGPT Web descendant routing externally.

Target behavior:

```text
Official stock Codex
  -> request enters local mixed-root bridge
  -> verified root remains native OpenAI inference
  -> verified protected descendant routes to ChatGPT Web
  -> unverifiable or ambiguous lineage fails closed
```

The end state must not depend on a patched `codex.exe`.

Keep this work narrow: no broad refactors, no unnecessary abstractions, and no exhaustive test suite unless a focused failure requires it.

---

## Execution Rules

This task is running in Codex desktop.

Use native Codex filesystem, shell, git, process, and editing tools. Do not use DevSpace or silently fall back to it.

Inspect current state before making changes. This handoff records the last verified state, not necessarily the newest state.

Preserve newer work if HEAD has advanced.

Do not reset, clean, stash, overwrite, or delete unrelated/newer work.

Production deployment is authorized once the gates in this plan pass.

---

## Last Verified Candidate

Worktree:

`D:\Projects\codex-chatgpt-web-mixed-root-prototype-20260923`

Expected branch:

`codex/mixed-root-guard-prototype-20260923`

Last verified minimum baseline:

`7582553a4a54fb2118d1e64e19b233bd119d0edf`

Relevant history:

- `24d5a82` — `feat: prototype mixed-root stock Codex routing`
- `7582553` — `merge: integrate upstream v6.1.0 into mixed-root candidate`

Backup ref:

`backup/mixed-root-pre-v6.1-20260925`

Last verified package version:

`6.1.0`

Important: `7582553` is a minimum known-good baseline, not a commit to reset to. If newer commits exist, inspect and preserve them.

## SEPTEMBER 26 HISTORICAL PRE-CUTOVER UPDATE (SUPERSEDED)

This section records the earlier readiness and testing evidence. The production completion section at the top is authoritative. Inspect the live machine before any future deployment decision.

- Official OpenAI desktop updated to `OpenAI.Codex 26.924.1866.0`. Its managed executable is now `C:\Users\Peter\AppData\Local\OpenAI\Codex\bin\d23520d1e41bfb24\codex.exe`, version `codex-cli 0.158.0-alpha.2`. The former `13995fba...` path no longer exists. Do not pin production to either changing versioned path; verify actual process after restart.
- The USER-level `CODEX_CLI_PATH` and live desktop app-server still point to `C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`. Do not remove it until accepted production gates pass.
- September 26 early startup: packaged 6.1.0 launcher failed once because its browser idle document did not commit within 10 seconds. A controlled restart restored the production browser host and `http://127.0.0.1:17841/healthz` returned 6.1.0, `status=ok`, `accepting_turns=true`. Keep a current health check; this does not prove a live production Web turn.
- Source fixes in the mixed-root worktree: preserve legacy Web routes inside the capability-scoped Web-only model allowlist (both direct Responses and spawn hook); correct the stale Temporary Chat test method name; add `launcher/package.json` runtime `extraResources.filter=["**/*"]` to retain license/dependency fixture files; verify final Windows unpacked runtime using the existing full path/size/SHA-256 manifest validator in `launcher/scripts/package.cjs`; add package contract assertions. The focused Web-only suite passed 12/12 and the corrected Temporary Chat test passed.
- An isolated Electron Windows `--dir` package from those source edits under `%TEMP%\codex-webgpt-manifest-package-probe\win-unpacked` passed complete `validateRuntimeBundle` for all 6,018 manifest paths, sizes and SHA-256 hashes. The installed application has NOT yet been replaced by this corrected build.
- An opt-in `AppConfig.mixedRootRouting` property and managed `routeUrl(config)` switch to `/mixed-root/v1` now exist. Default/legacy installation remains `/v1`. The focused suite for mixed-root, native passthrough and Web-only passed 30/30, TypeScript typecheck and diff check passed, launcher packaging-contract 11 pass / 0 fail / 2 skip.
- Successful isolated DEV Web-root delegation evidence: `%TEMP%\dev-mixed-live-bJjbFK\evidence.json`. Two sessions, child completion and parent's `wait_agent` marker, zero unexpected native forwards. Its old checker reported false solely because stock 0.158 normalized the requested hidden `chatgpt-web/high` child to the approved visible `chatgpt-web/gpt-5.6-sol`.
- Successful isolated native-root delegation evidence: `%TEMP%\dev-mixed-live-dWLFWU\evidence.json`. Stock native `gpt-6-sol` root, five HTTP-200 native upstream forwards, exactly one Web child on `chatgpt-web/gpt-5.6-sol`, both completed, final parent marker, zero unexpected native forward. Its old checker reported false solely because stock Code Mode recorded multi-agent calls inside `custom_tool_call exec` rather than ordinary `function_call` entries. The smoke checker has now been updated for both formats.
- **Critical durable-selection proof PASSED:** `%TEMP%\dev-mixed-live-jltECx\evidence.json`, stock `codex-cli 0.158.0-alpha.2`, native `gpt-6-sol` root with isolated `[agents] default_subagent_model = "chatgpt-web/gpt-5.6-sol"`. The actual spawn tool call omitted `model`; Codex selected the Web child from its official durable setting. It passed with two completed sessions, `wait_agent` child marker received, four HTTP-200 native root forwards and zero unexpected native forwards. This removes the need for bridge-side model rewriting or custom Codex spawn logic.
- Stock 0.158 currently rejects the live global `~\.codex\config.toml` before thread start: `invalid length 1, expected struct AgentRoleToml with 3 elements in agents`. The old custom `[agents] web_only_subagent_models = ["chatgpt-web/high"]` must be retired with a backed-up migration; do not replace or delete unrelated settings. Set root `model = "gpt-6-sol"`, official `[agents] default_subagent_model = "chatgpt-web/gpt-5.6-sol"`, and managed route `/mixed-root/v1` only after the fresh bridge candidate is deployed and healthy. Preserve alpha9.2/config as rollback. Avoid copying `auth.json` to a project/test directory; the isolated DEV smoke already handles existing native auth in memory.
- The current source changes and this execution plan are not yet committed. Release packaging enforces clean committed build identity. Update this plan, explicitly commit the intended files, check `git status --porcelain` empty, then build the production installer. The old 5.0.8 bundle and repaired 6.1.0 runtime must remain recoverable until acceptance.

**Historical planned sequence:** This cutover sequence was subsequently executed. Refer to the production completion section above rather than rerunning it.

## RECOVERED CURRENT STATE - THIS OVERRIDES OLDER ASSUMPTIONS BELOW

A later machine audit recovered substantially more progress than the original handoff recorded. Treat this section as authoritative when it conflicts with older wording elsewhere in this document.

### 6.1.0 merge preserved the custom fork

The upstream 6.1.0 integration did NOT reset the project to vanilla upstream and did NOT wipe the main custom features.

Git ancestry proves these custom lines are already included in `7582553`:

- custom `main` at `1fb7f74`
- retained-work / Bigger Context line at `46bec52`
- custom-features line at `f998118`
- Web-only subagent line at `8ed6aa6`
- mixed-root pre-merge candidate at `24d5a82`

Compared directly with vanilla upstream 6.1.0 (`2933410`), `7582553` still contains a substantial custom delta: 72 files changed, about 6,192 custom insertions, and about 451 deletions.

Recovered custom behavior still present in the candidate includes:

- Bigger Context multipart transport and adaptive part handling
- accumulated-context staging and acknowledgement handling
- retained ChatGPT conversation reuse
- continuation of explicitly unfinished work
- native/retained compaction protections
- browser DOM/rebind recovery and active-turn preservation
- runtime-supervisor and launcher ownership/recovery hardening
- custom build identity and diagnostics
- observed-progress / diagnostic reporting
- false-capacity / overload classification protections
- Compatibility V1 retry behavior
- Web-only subagent protection
- mixed-root stock-Codex routing

Do not re-import these features from old branches unless a concrete semantic gap is proven.

The separate `codex/f1-ui-build-identity` branch (`62c0d3e`, `4337eae`) is not literally an ancestor of `7582553`, but the practical build-identity functionality is already present in `7582553` through another custom integration path: source revision metadata, custom-build identity, build identity UI, updater protection, build-info validation, and diagnostic reporting. Do not cherry-pick those two commits blindly.

### A real 6.1.0 Windows build and install already happened

The candidate runtime was built from clean source revision:

`7582553a4a54fb2118d1e64e19b233bd119d0edf`

with build metadata `dirty: false`.

The built runtime exists under the candidate worktree and correctly contains:

- `LICENSES\Bun-1.4.0.md`
- `LICENSES\libnotify-0.8.7-LGPL-2.1.md`
- `LICENSES\tiktoken-MIT.txt`

The Windows installer was produced at:

`launcher\artifacts\codex-web-gpt-6.1.0-win-x64.exe`

Codex Web GPT 6.1.0 was then installed at:

`C:\Users\Peter\AppData\Local\Programs\Codex Web GPT\`

The installed executable and embedded build metadata identify version 6.1.0 from the same clean source revision `7582553`.

### Confirmed Windows packaging/install defect and temporary recovery

The original 6.1.0 Windows install was incomplete even though the staged runtime was correct.

Initial evidence showed the installed directory:

`C:\Users\Peter\AppData\Local\Programs\Codex Web GPT\resources\runtime\LICENSES`

was empty even though `launcher\build\runtime\LICENSES` contained all expected files.

After restoring only the missing license files, launcher startup advanced and exposed a second missing file:

`app\node_modules\@mixmark-io\domino\test\w3c\level1\html\nyi\HTMLTableElement27.js`

That proved the defect was broader than `LICENSES`: the Windows packaged/installed runtime had dropped multiple files from an otherwise correct staged runtime.

Recovered packaging facts:

- `launcher/scripts/prepare-runtime.cjs` builds the staged runtime correctly
- `launcher\build\runtime\manifest.json` lists 6,018 required runtime files
- `launcher/package.json` uses `extraResources` to copy `build/runtime` to installed `resources/runtime`
- pre-package `launcher\build\runtime` contained all manifest files
- the original installed `resources\runtime` did not
- build identities for staged and installed 6.1.0 matched clean source revision `7582553a4a54fb2118d1e64e19b233bd119d0edf`

A temporary same-build recovery was then performed solely to restore usability:

1. stop the installed Codex Web GPT process;
2. copy the complete staged `launcher\build\runtime` tree into the matching installed `resources\runtime`;
3. verify all 6,018 manifest paths exist in the installed runtime;
4. restart Codex Web GPT;
5. allow its normal `setup --full` transaction to materialize the durable runtime.

That recovery succeeded.

Current recovered bridge state:

- installed application: Codex Web GPT 6.1.0
- durable runtime: `~\.codex-chatgpt-web\versions\6.1.0-win32-x64`
- config `releaseVersion`: `6.1.0`
- config runtime command now points to `6.1.0-win32-x64\app\cli.js`
- production bridge: `http://127.0.0.1:17841`
- `/healthz`: HTTP 200 / `status: ok`
- `accepting_turns: true`
- model-catalog request: HTTP 200
- production launcher/browser host: running

This proves the repaired launcher/runtime is alive, but it is not by itself end-to-end proof that a real ChatGPT Web turn works. Before doing disruptive packaging/reinstall work, run one minimal real Web GPT request through the repaired 6.1.0 bridge. If it succeeds, preserve that working state. If ChatGPT authentication or Temporary Chat requires an interactive action, stop only for that action.

This is a safe temporary runtime repair, not the permanent packaging fix.

Do not undo this working state merely to reproduce the installer failure. Keep the current 6.1.0 bridge usable while fixing packaging at source.

The permanent fix must make a freshly produced Windows package/install contain the complete runtime without manual copying. Add a focused package/install regression that validates the final packaged or installed runtime against the manifest, not merely the `LICENSES` directory.

That permanent gate must validate every manifest entry using:

- relative path
- expected file size
- SHA-256

Do not treat file existence alone as sufficient package integrity proof.

Before replacing the currently working installed app, record a rollback checkpoint containing the healthy 6.1.0 build identity, durable runtime path, runtime command, bridge port/health, and the available 5.0.8 fallback. Prefer validating an unpacked or isolated package first. A future reinstall is acceptable only after the package-completeness gate proves the final payload is complete.

### Production cutover has NOT happened

At the last machine inspection:

`CODEX_CLI_PATH=C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`

was still set at USER scope.

The actual Codex desktop app-server was still running:

`C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`

version:

`codex-cli 0.155.0-alpha.9.2`

The official OpenAI desktop-managed backend was separately present at:

`C:\Users\Peter\AppData\Local\OpenAI\Codex\bin\13995fba801849b0\codex.exe`

recovered version:

`codex-cli 0.155.0-alpha.16.4`

The official desktop package was `OpenAI.Codex 26.917.9434.0`.

There was also a separate global npm Codex 0.154.0 app-server running from prior testing. Do not confuse that process with the official desktop-managed backend. If it is still present, identify ownership before stopping it.

The 6.1.0 bridge is now materialized and healthy after the temporary same-build runtime repair described above. This does NOT mean the stock-Codex cutover is complete: `CODEX_CLI_PATH` remains on the custom alpha9.2 backend until the remaining Web-only/mixed-root validation and permanent packaging repair are complete.

### Clean-source packaging requirement and handoff file

The Windows packaging script explicitly requires a clean committed source revision:

`Custom package creation requires a clean committed source revision`

The current execution-plan directory is untracked in this worktree:

`?? docs/exec-plans/`

That means the handoff itself can make the repository dirty and block packaging.

Preserve this handoff, but before any release/package build make the repository intentionally clean. Preferred approach: include the handoff/documentation in an explicit project commit together with the authorized changes or in a dedicated documentation commit. If there is a documented reason not to commit it, move the authoritative copy outside the repository before packaging. Do not hide it with an ad-hoc ignore rule solely to satisfy the clean-tree check.

Immediately before packaging, require:

`git status --porcelain`

to return no entries.

### Recovered focused regression evidence

A focused custom regression run against `7582553` under Bun 1.4.0 produced:

- root/custom subset: 215 pass, 4 fail
- launcher/build-identity/diagnostic/runtime-supervisor subset: 78 pass, 0 fail, 1 skip

The great majority of Bigger Context, retained-compaction, work-continuation, overload handling, runtime-supervisor, and mixed-root coverage passed.

Do not rerun the entire broad subset immediately. First diagnose and repair the four known failures plus the packaging defect, then rerun only affected focused suites and required release gates.

### Four known focused failures

Treat these as findings to diagnose, not four automatically confirmed product defects.

1. `Temporary Chat preparation preserves composer observation failures without misdiagnosing login`
   - The test calls a private/internal method that is now undefined after the upstream 6.1 browser refactor.
   - Likely stale test/API drift.
   - Preserve the intended failure-classification behavior; update the test seam if runtime behavior is correct. Change runtime only if behavior actually regressed.

2. `approved Web requests execute once and Web failures never fall back to native`
   - Expected response JSON status `completed`; observed no `status` field.
   - Compare current 6.1 Responses shape with the Web-only wrapper.
   - Preserve the core contract: exactly one approved Web execution and never native fallback on Web failure.
   - Fix code or test according to the actual current contract rather than merely making the assertion green.

3. `protected compaction retains the capability on its internal Responses request`
   - Expected HTTP 200; observed HTTP 400.
   - Trace the internal compaction Responses request through current 6.1 validation.
   - Verify whether the protected capability is missing, stripped, or rejected by a changed request shape.
   - Preserve the security contract: protected compaction stays on the approved Web route and cannot silently fall back native.
   - Treat this as a high-priority potential product/security regression.

4. `spawn hook preserves explicit Web choices and makes inherited Web selection explicit`
   - An inherited Web child expected to be allowed with explicit `chatgpt-web/high`, but the current hook denied it as lacking an approved Web model.
   - Compare current 6.1 spawn input shape and custom inheritance logic.
   - Preserve explicit Web choices and safe inherited Web selection where canonical policy authorizes it.
   - Continue denying native overrides, malformed arguments, and provider-replacement roles.
   - This is directly relevant to the final durable descendant-routing goal.

---

## Existing Implementation

The mixed-root implementation already exists. Do not rebuild it.

Relevant files include:

- `src/mixed-root-routing.ts`
- `src/native-passthrough.ts`
- `src/server.ts`
- `src/adapters/chatgpt-web/codex-rollout-environment.ts`
- `scripts/dev-mixed-root-live-smoke.ts`
- `tests/mixed-root-routing.test.ts`
- `tests/native-passthrough.test.ts`

The current design already provides:

- explicit `/mixed-root/...` policy boundary
- provider authorization requirement
- Codex thread/turn identity extraction
- canonical rollout ancestry validation
- root vs descendant depth determination
- native passthrough for verified roots
- approved `chatgpt-web/*` enforcement for protected Web descendants
- Web-only credential rejection on native passthrough
- fail-closed behavior for missing, forged, inconsistent, or ambiguous lineage

Do not weaken those controls.

---

## Critical Production Requirement: Descendant Routing

A test that explicitly asks:

`spawn_agent(model="chatgpt-web/high")`

is useful, but is not sufficient production behavior.

Normal stock Codex should not require special wording in every user prompt.

Determine the smallest durable mechanism for:

```text
verified root
  -> native OpenAI

verified protected descendant
  -> ChatGPT Web
```

Use this priority:

1. Prefer an official current stock-Codex configuration mechanism for descendant/subagent model selection if one exists.
2. If none exists, use the already-authenticated canonical descendant lineage at the bridge boundary to perform the minimum necessary protected model/routing selection.
3. Never trust request-supplied descendant metadata without matching canonical rollout ancestry.
4. Native roots must remain native.
5. Protected descendants must never reach native OpenAI inference.
6. Missing/forged/ambiguous lineage must fail closed.

Do not build a generalized policy engine.

---

## Production Route Requirement

The final stock Codex client must actually use the mixed-root boundary.

Verify final provider routing uses:

`http://127.0.0.1:<production-port>/mixed-root/v1`

or the equivalent production-generated mixed-root route.

Do not leave the final Codex provider on a legacy `/v1` path that bypasses mixed-root policy.

Production evidence must prove:

- root traffic enters mixed-root policy and continues to native OpenAI
- protected descendant traffic enters the same boundary and routes to ChatGPT Web
- forged/unverified descendants cannot obtain protected routing

---

## Codex Backend State

At the last verified inspection:

Official desktop-managed backend:

`codex-cli 0.155.0-alpha.16.4`

Its bundled catalog included at least:

- `gpt-6-astra`
- `gpt-6-sol`
- `gpt-6-luna`
- `gpt-5.6-sol`

The desktop was still actually using the custom backend because the USER environment variable remained:

`CODEX_CLI_PATH=C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`

Custom backend:

`codex-cli 0.155.0-alpha.9.2`

Re-inspect all of this before changing anything.

The final production target is the backend managed by the official OpenAI desktop application after `CODEX_CLI_PATH` is removed.

Do not replace the desktop-managed backend with a separately installed CLI merely to match a public stable version.

---

## Current Public Codex Compatibility Baseline

Public stable Codex reviewed on September 25, 2026:

`0.157.0`

Treat public stable Codex as compatibility/reference evidence and, if useful, an isolated test target.

Keep these distinct:

1. public stable Codex CLI release
2. current OpenAI desktop-managed Codex backend
3. actual backend used by the desktop after cutover

Recent upstream changes relevant to this bridge include:

- GPT-6 Sol/Luna availability
- canonicalized multi-agent spawning
- improved child spawn persistence
- provisional-child cleanup on failed/cancelled startup
- compaction resume metadata
- creator user/account metadata
- background/app-server lifecycle changes
- networking fixes
- model-catalog changes

These are compatibility inputs. Do not reimplement OpenAI's multi-agent system inside the bridge.

---

## Rollout / Session Compatibility

Newer `SessionMeta` can include fields such as:

- `creator_user_id`
- `creator_account_id`
- `session_id`
- `forked_from_id`
- `forked_from_ordinal_exclusive`
- `runtime_workspace_roots`
- `agent_nickname`
- `agent_role`
- `agent_path`
- `selected_capability_roots`
- `history_base`
- `subagent_history_start_ordinal`
- `multi_agent_version`
- `context_window`

Additional fields must not break existing validation.

Do not require new fields when legitimate older rollouts omit them.

Do not make creator IDs the primary routing authority. Canonical spawn ancestry remains authoritative.

Newer compaction can also carry `resume_metadata`, including:

- `multi_agent_version`
- `last_started_turn_id`
- `previous_turn_settings`

Review existing latest-turn, compaction-source-turn, resume, and descendant-lineage handling only where current behavior requires it.

---

## Revert / Multiple Rollout Compatibility

Current Codex can retain a stable thread ID while revert/history operations use a distinct rollout identity/file.

The bridge historically rejected ancestry when multiple matching rollout candidates existed.

Add one focused regression for this case.

Prefer authoritative current Codex state/index data where available, such as the current thread/rollout mapping in SQLite.

Required behavior:

- identify the current valid rollout when authoritative state makes that possible
- ignore stale historical candidates when the current state disambiguates them
- still fail closed when the current rollout cannot be uniquely established

Do not build a generalized history subsystem.

---

## Known Validation

The Web-root live flow previously succeeded:

```text
Web GPT parent
  -> Web GPT child
  -> child completes
  -> parent receives result via wait_agent
```

An early checker false-negative came from Markdown-escaped underscores and was corrected.

The mixed-root live smoke now supports:

`CODEX_MIXED_ROOT_SMOKE_EXE`

It can target the current official Codex executable.

The native-root model is selected dynamically:

1. `gpt-6-sol`
2. fallback `gpt-5.6-sol`

Do not hardcode it back to GPT-5.6.

### Bun finding

An earlier native-root test failed with TLS certificate verification under Bun `1.3.14`. A later Windows-trust attempt progressed further but Bun `1.3.14` crashed before completion.

The deployed Codex Web GPT runtime contains Bun:

`1.4.0`

Focused tests were rerun under Bun `1.4.0`:

- `tests/mixed-root-routing.test.ts`
- `tests/native-passthrough.test.ts`

Result:

`17 pass / 0 fail`

Also green:

- TypeScript typecheck
- `git diff --check`

Therefore do not redesign networking based on the old Bun `1.3.14` failure.

Reproduce first under Bun `1.4.0`.

Never disable TLS verification or add an insecure certificate bypass.

---

# Execution Plan

## CURRENT RESUME ORDER - FOLLOW THIS BEFORE THE OLDER PHASE FLOW

The project should resume from the recovered working state above. Upstream 6.1.0 is already integrated, built, installed, temporarily repaired, materialized, and serving a healthy production bridge on port 17841.

1. Re-audit current branch/HEAD/worktree and preserve anything newer than `7582553`.
2. Verify the currently repaired 6.1.0 bridge is still healthy and accepting turns.
3. Run one minimal real Web GPT request through the repaired 6.1.0 bridge. `/healthz` alone is not sufficient end-to-end proof. If the turn succeeds, preserve the working state while developing the permanent fix. If authentication is required, stop only for that interactive step.
4. Diagnose and fix the Windows package/install omission at source. The permanent gate must validate every `manifest.json` entry in the final packaged/unpacked payload by path, size, and SHA-256 because the defect dropped more than `LICENSES`.
5. Diagnose and reconcile the four known focused test failures. Classify each as runtime regression, security/policy regression, or stale test drift before changing code.
6. Rerun only affected focused suites plus mixed-root/Web-only/native-passthrough coverage, typecheck, `git diff --check`, and the focused Windows package/install integrity gate.
7. Preserve this handoff but resolve its current untracked status before release packaging. Ensure `git status --porcelain` is empty and the source revision is committed/clean; do not hide the handoff with an ad-hoc ignore solely to satisfy packaging.
8. Commit the required fixes and build a clean 6.1.0 Windows candidate from that commit.
9. Before touching the working installed app, record the healthy repaired 6.1.0 rollback checkpoint and prove the newly built package/unpacked payload is manifest-complete by path, size, and SHA-256.
10. Perform a controlled reinstall/update only after package integrity is proven. Verify it reaches `/healthz` on 6.1.0 without any manual runtime copy and then run one real Web GPT request again. Keep the prior working repaired runtime and 5.0.8 fallback recoverable until this passes.
11. Run the isolated DEV Web-root smoke and the critical stock/native-root -> protected Web-child smoke.
12. Prove durable descendant routing without requiring special model wording in every user prompt.
13. Only after those gates pass, remove the USER-level `CODEX_CLI_PATH`, relaunch official Codex, verify the OpenAI-managed backend is actually running, and perform one real production delegation acceptance test.
14. Retain the old alpha9.2 backend and the prior working bridge runtime until production acceptance is stable.

Do not redo the upstream 6.1 merge. Do not reset to vanilla upstream. Do not blindly cherry-pick old feature branches already represented semantically. Do not intentionally break the currently healthy 6.1.0 bridge just to reproduce a known installer defect. Do not treat the temporary manual runtime sync as the permanent fix.

## Phase 1 — Inspect

Verify before editing:

- worktree / branch / current HEAD
- whether HEAD is newer than `7582553`
- git status
- backup ref
- package version
- current official OpenAI desktop package
- desktop-managed `codex.exe` path/version
- bundled model catalog
- USER `CODEX_CLI_PATH`
- actual running Codex app-server executable
- Bun `1.4.0` runtime path
- production bridge/launcher state and port
- isolated DEV harness state

Do not change production during this phase.

---

## Phase 2 — Restore Isolated DEV Harness

Use the existing DEV environment:

`~\.codex-chatgpt-web-dev`

Restore only the DEV launcher/browser/profile.

Verify:

- DEV launcher/browser host alive
- control endpoint responds
- Temporary Chat usable and authenticated
- `Codex Native2 DEV` connector available
- DEV broker/socket configuration matches

Do not touch production browser/configuration.

If a real interactive sign-in is required, stop only for that step and report the exact action needed.

---

## Phase 3 — Web-Root Smoke

Run the existing mixed-root Web-root smoke once using:

- current official Codex executable
- Bun `1.4.0`
- isolated DEV bridge/browser

PASS requires:

- exactly one parent and one child
- child uses `chatgpt-web/high`
- child completes
- parent calls `wait_agent`
- parent receives child result
- parent completes
- no unintended native protected inference

If it passes once, do not repeat it unnecessarily.

---

## Phase 4 — Native-Root Smoke

Run the main gate:

```text
official stock Codex native root
  -> native GPT-6 Sol when available
  -> protected ChatGPT Web child
  -> child completes
  -> root receives result
  -> root completes
```

PASS requires:

- root actually reaches native OpenAI inference
- one child is created
- child routes through ChatGPT Web
- child never reaches native OpenAI inference
- root receives result through `wait_agent`
- root completes
- no TLS bypass
- no patched Codex binary
- no unintended extra child

If this fails, diagnose the exact Bun `1.4.0` failure before changing architecture.

---

## Phase 5 — Prove Durable Descendant Selection

After the explicit smoke passes, verify how production will select the protected Web child without prompt-specific model instructions.

Prefer official stock-Codex configuration.

If unavailable, implement only the smallest safe bridge-side model/routing selection after canonical descendant ancestry has been authenticated.

Add only focused tests for the behavior actually changed.

---

## Phase 6 — Minimal Compatibility Gates

Run targeted checks for:

- native root routing
- protected Web descendant routing
- forged descendant rejection
- missing lineage rejection
- ambiguous lineage rejection
- current/reverted rollout resolution
- resume/compaction ancestry where touched
- closed/failed child edge behavior where relevant

Also run:

- relevant focused tests
- TypeScript typecheck
- `git diff --check`

Avoid the repository's longest/full test suite unless a focused failure makes it necessary.

---

## Phase 7 — Build Release Candidate

Once the live DEV gates pass:

- preserve exact source commit
- commit only necessary compatibility changes
- build/package using the repository's existing release mechanism
- run the lightweight normal runtime/package release smoke

Do not refactor unrelated code or upgrade unrelated dependencies.

---

## Phase 8 — Deploy Bridge First

Before production deployment, record:

- current production config
- runtime version
- port
- launcher ownership/state
- `CODEX_CLI_PATH`
- current custom Codex path
- current official desktop-managed Codex path/version

Preserve rollback.

Deploy the mixed-root-capable Codex Web GPT `6.1.0` candidate using the repository's existing launcher/runtime mechanism.

Verify:

- process starts
- `/healthz` responds
- expected version is running
- launcher owns the expected runtime
- connector/browser integration works
- ordinary ChatGPT Web routing works
- mixed-root endpoint is available

Keep `CODEX_CLI_PATH` unchanged during this bridge deployment.

---

## Phase 9 — Cut Desktop Back to Stock

Only after the new bridge is healthy:

1. Record the current USER `CODEX_CLI_PATH`.
2. Fully close Codex desktop/app-server processes using the custom backend.
3. Remove the USER-level `CODEX_CLI_PATH`.
4. Keep the custom executable on disk as rollback.
5. Relaunch official Codex desktop normally.
6. Inspect the actual running app-server child process.

Prove the desktop is no longer using:

`C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`

Record the actual stock executable path, version, and command line.

---

## Phase 10 — Production Acceptance

Run one controlled production delegation:

```text
stock OpenAI-managed Codex root
  -> native OpenAI inference
  -> protected ChatGPT Web child
  -> child completes
  -> result returns to root
  -> root completes
```

PASS requires:

- root remained native
- protected child used ChatGPT Web
- protected child never reached native OpenAI
- stock OpenAI-managed `codex.exe` is running
- `CODEX_CLI_PATH` is absent
- request traversed mixed-root policy
- normal local Codex tools still work
- Code Mode still works
- production bridge remains healthy
- basic continuation/resume works if practical

One clean production acceptance run is enough.

Do not declare migration complete before this passes.

---

## Rollback

Keep rollback immediately usable.

If stock production fails:

1. fully close Codex desktop
2. restore USER environment variable:

`CODEX_CLI_PATH=C:\CodexBuilds\web-only-alpha9.2\debug\codex.exe`

3. restore/restart the prior known-good bridge runtime if necessary
4. relaunch Codex
5. verify the custom backend is active again

Do not delete:

- custom backend
- backup refs
- historical worktrees
- prior runtime needed for rollback

After production acceptance is stable, the old custom-Codex update/watch workflow may be retired.

---

## Completion Report

At completion report only the important final state:

- final branch
- final commit
- Codex Web GPT version deployed
- production bridge health/port
- production mixed-root endpoint
- official desktop package/version
- actual running stock `codex.exe` path/version
- `CODEX_CLI_PATH` removed: YES/NO
- Web-root smoke: PASS/FAIL
- native-root -> Web-child smoke: PASS/FAIL
- durable child routing: PASS/FAIL and mechanism
- production delegation: PASS/FAIL
- resume/continuation result if tested
- rollback runtime/path
- rollback `CODEX_CLI_PATH`
- remaining blocker, if any

Do not stop after analysis when execution can continue safely. Continue through validation, deployment, stock-backend cutover, and production acceptance unless a real interactive user action is required.

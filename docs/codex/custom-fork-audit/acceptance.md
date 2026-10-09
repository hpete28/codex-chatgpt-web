# Custom regression and acceptance map

Root `AGENTS.md` is authoritative. This map locates existing evidence; it does not assert every behavior is proven by one named test or by this audit. Read the assertions, not only filenames. Add regression coverage for new defects where practical, and never weaken existing assertions to land a feature.

| Required custom behavior | Implementation starting point | Existing test starting point |
| --- | --- | --- |
| 3× semantic capacity, 2–8 physical parts | `prompt.ts`, `usage.ts`, `input-tokens.ts` under `src/adapters/chatgpt-web` | `tests/chatgpt-web-usage.test.ts`, `tests/prompt-contract.test.ts` |
| Accumulated stage sizing; all context staged before execution; final ACK | `prompt.ts`, `browser-worker.ts` | Above plus `tests/browser-worker-contract.test.ts`, `tests/chatgpt-web-harness.test.ts` |
| Active user revision across native compaction | `index.ts`, compaction modules | `tests/server-compaction.test.ts`, `tests/retained-compaction.test.ts` |
| Retained conversation reuse and explicit unfinished work | `index.ts`, `turn-broker.ts`, `work-state.ts` | `tests/work-continuation.test.ts`, `tests/chatgpt-web-harness.test.ts`, `tests/turn-broker-lifecycle.test.ts` |
| ACK/DOM rebind and owned-tab independence | `browser-worker.ts`, `src/launcher-browser-host.ts`, launcher browser host | `tests/browser-worker-contract.test.ts`, `tests/launcher-browser-host.test.ts`, `launcher/tests/browser-host.test.cjs` |
| No false capacity classification; V1 High-to-High recovery | `src/lib/errors.ts`, `index.ts`, `retry-policy.ts` | `tests/chatgpt-web-harness.test.ts`, `tests/compaction-v1.test.ts`, `tests/compaction-browser-recovery.test.ts` |
| Cold-thread history and environment | `environment.ts`, `thread-environment.ts`, `codex-rollout-environment.ts` | `tests/environment.test.ts`, `tests/subagent-environment-history.test.ts` |
| Launcher and supervisor cold starts | `launcher/electron/browser-host.cjs`, `runtime-supervisor.cjs` | `launcher/tests/browser-host.test.cjs`, `launcher/tests/runtime-supervisor.test.cjs` |
| Installation integrity and locked cleanup | `launcher/electron/runtime-install.cjs` | `launcher/tests/runtime-install.test.cjs`, `tests/runtime-layout.test.ts` |

## Commands

These are existing commands, to run from the candidate worktree with Bun **1.4.0**. An explicit executable path may replace `bun`. F1/F3 begin with their narrow launcher/helper suites. For F2/core telemetry changes, the focused custom set includes:

```powershell
bun test ./tests/chatgpt-web-usage.test.ts ./tests/prompt-contract.test.ts ./tests/work-continuation.test.ts ./tests/browser-worker-contract.test.ts ./tests/chatgpt-web-harness.test.ts ./tests/retained-compaction.test.ts ./tests/server-compaction.test.ts ./tests/compaction-v1.test.ts ./tests/compaction-browser-recovery.test.ts ./tests/launcher-helper-client.test.ts ./tests/launcher-browser-host.test.ts ./tests/turn-broker-lifecycle.test.ts
node --test launcher/tests/browser-host.test.cjs launcher/tests/runtime-supervisor.test.cjs launcher/tests/control-server.test.cjs
bun run typecheck
bun run launcher:typecheck
```

At integration use `bun run verify` and `git diff --check`. F1 packaging additionally uses `bun run app:package` and `bun run app:smoke`. Tests needed after changes to environment/history must include their mapped suites. Do not repeat expensive successful gates unless code or environment changes invalidate their evidence.

## Live acceptance boundaries

Use `docs/dev-chat.md` and an isolated candidate-built DEV launcher with `Codex Native2 DEV`. Confirm profile paths and candidate identity before any test. Do not alter the official connector, route, logged-in profile, or running production installation. The DEV harness's outer tool receipts are simulated; record them as such.

- F1: inspect candidate identity in the packaged app, confirm the custom update-disabled explanation, and verify no update request occurs. Confirm matching launcher/runtime revisions and accurate bundle ID. A mismatch fixture must be visible, not repaired automatically.
- F2: run an ordinary response and a simulated tool turn, exercise multipart context and native compaction using documented DEV controls, and check the Activity summary against the actual events. Exercise a controlled continuation boundary and cancellation. Use deterministic tests for rare 8-part/reordering/failure conditions; do not generate unnecessary live traffic just to hit every fixture case. Record which scenarios were live versus synthetic.
- F3: run doctor explicitly in DEV only if wanted, then export a report; confirm actual freshness and profile. Repeat with unavailable optional evidence using controlled fixtures or an isolated setup. Verify JSON fields and absence of private payloads before sharing anything.

These feature checks do not substitute for `docs/release-validation.md` if later preparing a stable release. Record platform limitations and unexecuted checks. A substantial High/Sol run is required before making claims that the previously observed long-run incident is solved; the new progress UI alone cannot establish that.

## Evidence record template

For each feature, attach a short execution note to the candidate review:

```text
Feature / acceptance IDs:
Base revision / candidate revision:
Worktree / branch:
Bun executable and version / OS:
Focused checks (command, result, meaningful skip):
Integrated verify / package smoke:
Live DEV checks (candidate identity, profile, actual vs simulated):
Unexecuted or failed acceptance:
Known limitations and scope deviations:
Promotion/deployment state: not performed unless separately authorized
```

No production readiness claim is allowed merely because files were built, tests were green, or the launcher opened.

# Audit of the custom application

## Scope and evidence

This is a source and focused-test audit of the user's custom checkout, not an audit of the upstream website or latest upstream release. No remote fetch, upstream integration, production browser interaction, installation, or restart was performed.

| Identity | Observed value |
| --- | --- |
| Local main and locally recorded origin/main | `aeb4321738b48a1a5b79f0c18f9b054b722b5f2b` |
| Locally recorded upstream/main | `973c287edf53c37d3d9fa2356010d635a6ccf25b` |
| Upstream-only / local-only commits | `0 / 29` relative to those local refs |
| Custom delta from recorded upstream | 37 files; 3,237 insertions, 321 deletions |
| Declared version | Runtime and launcher 5.0.7 |
| Required / shell Bun | 1.4.0 / 1.3.14 |
| Node used for focused launcher tests | 22.23.0 |

Remote refs are cached evidence, not a claim about today's remote heads. The package metadata still names upstream; Git ownership and the actual code delta establish the fork under audit. Multiple historical DevSpace worktrees exist, including an integration worktree at this HEAD. None was modified or removed. Running Bun and Codex Web GPT processes were observed by name/PID only; their installed revision and live readiness were not established.

Unrelated untracked files `.tmp-w01.mp3` and `tests/codex-web-gpt-diagnostics-2026-09-09.jsonl` were preserved and not used as audit input. No existing `docs/codex` or `.specify` directory was found before this package.

## What this custom app already does

The app bridges native Codex Responses to task-owned ChatGPT browser conversations. Its Electron launcher owns login, tabs, setup, a supervised runtime, and the Full-mode tunnel. Browser-only, Full, Zero Risk, isolated DEV chat, compaction, cancellation, and up to five concurrent task tabs already exist.

The fork's value is reliable sustained work, particularly larger contexts and retained conversations. Do not propose those as missing features:

| Custom capability | Local implementation and evidence |
| --- | --- |
| 3× semantic context, adaptive 2–8 physical parts | `src/adapters/chatgpt-web/prompt.ts`: `CHATGPT_BIGGER_CONTEXT_PARTS`, `CHATGPT_BIGGER_CONTEXT_MAX_TRANSPORT_PARTS`; `usage.ts`: `resolveBiggerContextMultipartParts` |
| Accumulated staging and final ACK handling | Custom diffs in `prompt.ts`, `input-tokens.ts`, `browser-worker.ts`; prompt, usage, browser-worker and harness tests |
| Explicit unfinished-work continuation | `work-state.ts`, `turn-broker.ts`, `index.ts`; `tests/work-continuation.test.ts` |
| Cold retained-thread history recovery | `codex-rollout-environment.ts`, `environment.ts`, `thread-environment.ts`; environment/history tests |
| DOM/viewport and observation recovery | Custom `browser-worker.ts` changes; `tests/browser-worker-contract.test.ts` |
| Startup and installation resilience | Custom `browser-host.cjs`, `runtime-supervisor.cjs`, `runtime-install.cjs` and tests |

The repo also already has integrity-checked runtime bundles, transactional installation, a doctor, safe-log export, browser diagnostic capture, CI across three operating systems, and a comprehensive `verify` command. Recommendations below extend these capabilities.

## Ranked additions

Ratings are qualitative engineering estimates, not measured usage analytics. H/M/L mean high/medium/low. Effort is relative: S is a narrow surface; M spans a few existing components; L crosses process boundaries and needs live verification.

| Rank | Feature | User / developer impact | Frequency | Effort | Risk | Alignment / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | F1: custom build identity and upstream-update protection | H / H | Every update or incident | M | M: packaging/updater | H / strong |
| 2 | F2: per-turn observed progress in Activity | H / M | Every long turn | L, constrained MVP | M–H: helper/control boundary | H / strong for gap, benefit inferred |
| 3 | F3: one structured diagnostic report | M / H | Every support incident | M | M: data handling | H / strong |

### F1: Show which build is running and protect custom builds

**Observed:** `launcher/electron/update.cjs` hard-codes `miuuyy/codex-chatgpt-web`; `createUpdateController` enables checks for packaged supported platforms and chooses candidates by version. `launcher/electron/main.cjs` disables updates for DEV but provides no custom-fork policy. `LauncherSnapshot` exposes version without source revision. README download buttons and troubleshooting reinstall guidance point upstream.

**Existing protection:** `scripts/build-runtime-bundle.ts` writes a schema-2 file manifest and `bundleId`; `runtime-install.cjs` validates file hashes and replaces stale same-version bundles. This is real integrity protection. The gap is source provenance and fork-aware update policy, not missing hashing.

**Consequence:** a packaged custom build can offer a newer upstream installer that does not include the custom delta. This is a source-supported risk, not evidence that the running app has already been overwritten. An automatic check does not itself install an update; installation remains a user action.

**Addition:** package explicit custom identity, show launcher/runtime provenance, and disable the built-in public updater for custom or unknown builds. Keep manual reviewed integration and installation. Do not build a private release service or merely change the repository URL to a fork with unverified release assets.

### F2: Make long-running work understandable

**Observed:** `launcher/src/types.ts` represents tabs with coarse status and trace ID. `ActivitySurface` in `App.tsx` renders a reverse-chronological general log. The worker already records stage timing, multipart acknowledgements and browser evidence; `turn-progress.ts` carries authoritative tool activity; continuation is decided in `index.ts`/`turn-broker.ts`.

**Gap:** no unified per-turn projection of these signals in the inspected renderer. Users have logs and tabs, but no concise view explaining whether context is staging, a response is running, a recovery is active, or a clean Web boundary is continuing required work.

**Addition:** a bounded read-only turn summary in Activity. Clearly separate transport state from model-reported work state. This is the highest recurring usability gain but has the greatest implementation risk, so ship after F1 and use a frozen event contract.

**Do not add:** a scheduler, durable task engine, queue beyond five tabs, arbitrary retry buttons, percentage complete, time-to-finish estimates, or text-based detection of task completion.

### F3: Export a diagnostic report with enough context to investigate

**Observed:** `logging.cjs` exports sanitized JSONL from current/rotated launcher logs; the launcher provides a Save dialog. `doctor.ts` produces checks, including ownership and proxy health. Browser diagnostics and DEV evidence also exist, but they are separate surfaces. No combined provenance/health/selected-turn report was found in the inspected export path.

**Addition:** a small versioned JSON report containing build identity, profile/mode, cached doctor result freshness, and optional F2 summary. Keep the existing safe-log export. Use an explicit field allowlist; do not bundle whole profiles or browser diagnostics.

**Why separate from F2:** incident reporting remains useful even if live progress instrumentation is delayed. F3 must tolerate absent F2 data.

## Documentation corrections to include with implementation

1. `docs/architecture.md` says Bigger Context has a three-part maximum; the custom code distinguishes a 3× semantic limit from 2–8 physical chunks. Correct that paragraph without changing code limits.
2. `docs/work-continuation.md` describes the initial clean-boundary extension and says it does not recover stopped-thinking. Current `work-state.ts` also defines `stalledResponseContinuationPrompt`, and the custom worker contains stalled-observation recovery. Clarify the historical scope and document the separate current recovery paths from code; do not reinterpret every stall as continuation permission.
3. Fork-facing README and troubleshooting entry points should distinguish upstream public installers from a reviewed custom build. Preserve upstream attribution and licenses.

These are small companion changes, not a separate documentation overhaul.

## What should not be built now

- A second task/Goal system: native Codex ownership and the existing work-state contract already handle this boundary.
- More browser slots, quota workarounds, model switching, or automatic resend: no measured need offsets the ownership and duplication risks.
- A new context planner: reuse the custom compiler, budgets, attachments and compaction logic.
- A new telemetry server, database, charts platform, cloud upload or account system: local bounded state suffices.
- A general updater rewrite, private release pipeline, or one-click rollback: useful only after a separate distribution/deployment decision.
- A monolith cleanup or UI redesign: they add merge conflicts without delivering the three user outcomes.
- A new regression framework: map and run existing suites first; add focused behavioral tests only for new behavior.

## Validation and confidence limits

Executed `node --test launcher/tests/update.test.cjs launcher/tests/logging.test.cjs launcher/tests/runtime-install.test.cjs`: **23 passed, 0 failed, 1 Linux-only skip** on Windows. These establish the inspected existing helpers' focused behavior; they do not test proposed features or certify the whole application.

No Bun tests, full verify, runtime build, package build, authenticated turn, or live acceptance was run. The shell Bun mismatch is recorded rather than silently using the wrong runtime. No fresh remote release information or external issue status is claimed. Source references are repository paths and symbols at the audited revision; implementation must recheck them if HEAD changes.

# Implementation plan for Sol 5.6 High and bounded agents

## Outcome and scope

Deliver one requested feature at a time. The success criteria are the selected spec's acceptance cases, preservation of the custom contract in [acceptance.md](acceptance.md), and recorded validation at the actual candidate revision. Audit completion does not mean feature implementation has been approved.

No product code is changed by this planning package. Estimates deliberately avoid calendar promises; F2 is materially larger than F1/F3.

## Before each feature

1. Read root `AGENTS.md`, this package, and the feature spec. Verify `git status --short`, branch, HEAD, worktrees and remotes. Check for ongoing work on the feature before making a new branch. Do not inspect private logs or production settings just to establish source identity.
2. Compare the current checkout with audited `aeb4321738b48a1a5b79f0c18f9b054b722b5f2b`. Recheck relevant implementations for upstream/custom changes and duplicate functionality. Document material differences in the feature's execution notes; don't silently rewrite the scope.
3. Use a separate worktree/branch such as `codex/custom-build-protection`, `codex/turn-progress`, or `codex/diagnostic-report`. Preserve dirty/untracked work. Do not work in a running installation or reuse someone else's active worktree.
4. Locate Bun **1.4.0** and verify its executable version before all Bun commands. Use an explicit path if the shell resolves another version. Do not change the repo pin or global installation to bypass this requirement.
5. Record candidate baseline, intended file ownership and acceptance IDs in a small execution note. No extra plan framework is required.

## Delivery sequence

| Slice | Deliverable | Exit condition |
| --- | --- | --- |
| F1a | Packaged source identity and shared reader; custom/unknown update policy | F1-A1–A4 tests pass; no public updater path available for custom/unknown identity |
| F1b | Settings/doctor visibility, packaging checks, fork install guidance | F1-A5–A7; relevant build/package smoke and isolated launcher check |
| F2a | Shared event DTO, validation, bounded projector | F2-A1–A5 using injected events; no scheduler or browser decisions added |
| F2b | Real emitters and owned-process propagation | Cross-process ordering/ownership tests; F2-A6; existing transport regressions pass |
| F2c | Activity turn selector/summary and labels | F2-A7–A9; isolated DEV acceptance |
| F3a | Allowlisted report builder and bounded collector | F3-A1–A5; no raw diagnostic aggregation |
| F3b | Save dialog, renderer action, provenance/freshness display | F3-A6–A8 and isolated export check |

F1a/b are one feature, not competing branches. F2a freezes its DTO before F2b/F2c proceed. F3 depends on F1 identity, but its report accepts `turn: null` if F2 is unavailable. Never make F1 wait for F2.

## Delegation without drift

Use at most two implementation agents at once. The lead owns integration and all shared contracts. For F1 and F3, serial implementation may be faster and safer than delegation.

| Owner | Allowed work | Must not do |
| --- | --- | --- |
| Lead Sol 5.6 High | Freeze DTOs/policy, backend wiring, shared tests, review diffs, integrate and validate | Delegate the same mutable files to two agents; report simulation as live success |
| Agent A, 5.6 High | Feature-specific pure helper and its unit tests after lead approves exact inputs/outputs | Change browser submission, recovery, cancellation, capability/token or context semantics |
| Agent B, 5.6 High | `App.tsx`, local styles, i18n and renderer wiring against frozen types | Invent backend fields, add dependencies, alter other surfaces or broaden feature scope |

The lead owns `launcher/src/types.ts`, Electron main/preload/control boundaries, and any protocol definitions. Agents return patches or commits plus test output; they do not independently merge or deploy. If worktrees are used, integrate the contracts first, then helper and UI changes. Agents may inspect all relevant code but edit only assigned files.

Every agent handoff must include: feature and acceptance IDs, baseline revision, owned files, frozen data contract, exclusions, exact checks, and the requirement to report incomplete work. Missing fields are not permission to invent behavior. If an existing primitive differs materially from the spec, propose the smallest compatible adjustment to the lead before changing the contract.

## Verification

Run targeted tests after each meaningful slice. Run root and launcher typechecks for changed typed boundaries. At the integrated feature candidate run `bun run verify`, then `git diff --check`. `verify` already includes root/launcher tests, dependency audits, typechecks, renderer build, runtime bundle and runtime smoke; don't immediately rerun all constituent commands without a reason.

For packaging changes in F1 also run `bun run app:package` and `bun run app:smoke` against the candidate. Build release candidates from recorded committed source in isolation. A packaging smoke is not authenticated live acceptance. Use the relevant DEV/live checklist in acceptance.md before any production readiness claim. Preserve audit failures and distinguish environment/network problems from code failures; neither may be reported as a pass.

For F2, inspect changes to core files before running broader gates: telemetry must be observational and nonblocking. Tests must demonstrate that absent/rejected telemetry cannot affect a turn's result, ACK ordering, retry count, or cancellation behavior.

## Stop and report

Stop dependent implementation if identity is ambiguous, the same effect may have been submitted twice, rate limits appear, a required test fails, or a spec change would alter the custom contract. Diagnose in isolation; never repair by installing into production, weakening assertions, raising timeouts broadly, removing failing tests, or changing context limits.

Before declaring a feature done, report files changed, acceptance IDs satisfied, exact commands/results, unexecuted live checks, candidate revision, and rollback boundary. Rollback before deployment is simply not promoting the candidate. Production rollout/rollback procedures require a separate authorized deployment task using the supported repository procedure. This plan does not authorize a push, merge, release, runtime replacement or production restart.

# Custom fork improvement package

Audited on 2026-09-18 at `aeb4321738b48a1a5b79f0c18f9b054b722b5f2b` in `D:\Projects\codex-chatgpt-web`, branch `main`, writable fork `hpete28/codex-chatgpt-web`.

This package is a recommendation and implementation handoff, **not authorization to implement, merge, publish, or deploy**. The requested audit and planning work is complete. Feature work starts only when requested.

Read in this order:

1. [Audit report](audit.md): evidence, priorities, existing capabilities, and limitations.
2. [Implementation plan](implementation-plan.md): sequence, agent ownership, checks, and stopping rules.
3. The selected feature specification: [F1 custom build protection](F1-build-protection.md), [F2 turn progress](F2-turn-progress.md), or [F3 diagnostic report](F3-diagnostic-report.md).
4. [Regression and acceptance map](acceptance.md): custom behavior that all implementations must preserve.

Recommended order: **F1 → F2 → F3**. F1 is independently useful and is the recommended first implementation. Do not treat the three features as one release requirement. F3 can ship without F2, with its optional turn-summary section absent.

These plain Markdown specifications are sufficient for this work. No Spec Kit bootstrap, new application framework, task database, or generated boilerplate is needed. The repository currently has no `.specify` scaffolding.

## Handoff prompt for Sol 5.6 High

> Implement F1 only from docs/codex/custom-fork-audit. Read AGENTS.md, README.md in the audit package, implementation-plan.md, F1-build-protection.md, and acceptance.md. First verify repository, branch, HEAD, dirty files, and existing worktrees. Compare current code with the audited revision; confirm the gap still exists. Preserve unrelated work. Use an isolated codex/ branch and worktree. Follow the specified behavior and exclusions. You may delegate bounded tasks to 5.6 High agents using the ownership rules in the plan. Do not implement F2/F3, change model/context/recovery behavior, fetch or merge upstream, publish, or deploy. Complete the relevant checks with Bun 1.4.0 and report exact evidence and any unexecuted acceptance. Do not claim live acceptance from synthetic tests.

Change the feature ID and referenced spec when commissioning a later feature. The model names identify the intended implementers; they are not runtime model-routing changes.

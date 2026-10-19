# Upstream 6.1.11 integration candidate — 2026-10-19

Status: **isolated candidate only**. This is not a production release or approval to install.

## Baseline and separation

- Production source and installed runtime: custom WebGPT 6.1.6, revision `f56f7c9`.
- Upstream source integrated: `miuuyy/codex-chatgpt-web` tag `v6.1.11`, revision `9fe005e`.
- Candidate branch: `sync/upstream-20261019-v6.1.11` in `D:\Projects\codex-chatgpt-web-sync-20261019-v6.1.11`.
- Backup tag: `backup/main-before-upstream-20261019-v6.1.11`.
- Canonical `main` and installed `C:\Users\Peter\AppData\Local\Programs\Codex Web GPT` remain unchanged.

## Reviewed behavior and merger resolutions

- Retained fork's mixed-root and Web-only subagent isolation, native Codex model routing and context controls.
- Retained fork's native task/compaction continuity and MCP tool-broker ownership and cancellation.
- Retained fork's transactional Bigger Context: all JSON history records must be acknowledged before the final **small** execution commit. Additional physical transport stages **do not** increase the measured semantic context window.
- Adapted upstream generation-progress events, queued tool diagnostics, and browser renderer-crash recovery.
- Preserved a user's intentionally disconnected route during cold-start recovery. Explicit setup remains able to connect.
- Preserved validation that browser-Origin requests must not invoke the local unauthenticated native route.
- Fixed a merge regression where Luna final multipart messages inherited Sol's more generous transport budget.
- Updated affected fixtures to test the fork's protocol rather than upstream's execution-on-final-stage protocol.
- Privacy gate: current production config explicitly uses `useSavedChats: false`, and the integrated code must preserve that. Upstream's default for newly created configs is `true`; that default was not changed by this integration and must be reviewed explicitly before a new installation.

## Verification checkpoints

- Runtime TypeScript: passed.
- Launcher TypeScript: passed.
- Browser/compaction focused tests: 166 passed, 0 failed.
- Launcher focused suite: 309 passed, 3 skipped, 0 failed.
- Native browser harness: 113 passed, 0 failed (including oversized Luna contract rejection).
- Full repository suite first run: 1066 passed, 4 failed; failures were in physical-stage planning and upstream assumptions about message counts; they were fixed and individually retested. A final full-suite rerun on the final commit is required before promotion.
- Package integrity and developer-profile smoke must pass before promotion. Do **not** run the installer or any production-changing browser task as a test.

## Unresolved acceptance criteria

1. **Reboot failure remains open:** upstream can recover a crashed renderer after startup, but no verified, self-healing initial browser-bootstrap recovery has been implemented for the observed 10-second timeout. Do not call this a permanent cold-start fix.
2. Verify a tool-capable connector turn end-to-end using a read-only probe in an isolated profile. Local doctor alone does not establish connector availability.
3. Run complete clean-tree tests and a source/package smoke, then do a controlled real Windows reboot with user approval if contemplating a production release.
4. Review saved chats' new upstream default against the requirement to remain in Temporary Chat and ensure explicit `false` survives every migration.
5. If validation reveals a regression, leave production on 6.1.6 and fix the candidate only.

## Rollback and promotion

Do not merge this branch into `main` or replace the installed launcher until approval and all gates above pass. The pre-merge backup tag and installed 6.1.6 are the rollback anchors. Use a custom build from a clean committed candidate, not the upstream public installer.

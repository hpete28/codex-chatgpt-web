# Project Agent Instructions

## Upstream synchronization trigger

Treat the exact request **“check Codex Web GPT upstream and safely integrate anything new”** (and clear equivalents that explicitly ask to safely integrate upstream changes) as a standing project workflow trigger.

The trigger authorizes fetching and inspecting `upstream`, integrating new `upstream/main` commits in isolation, validating the integration, and—only if validation succeeds—promoting the validated integration to local `main` and pushing `main` to the user's writable `origin` fork.

It does **not** by itself authorize deployment to the running production installation. Production deployment requires the user to also say **“and deploy to production”** or otherwise explicitly authorize deployment.

### Mandatory safe workflow

1. Start with a read-only state audit:
   - `git status --short`
   - current branch/HEAD and worktrees
   - `git remote -v`
   - fetch `upstream` and `origin` with pruning
   - compare `main`, `origin/main`, and `upstream/main`
   - identify upstream-only commits, tags, and relevant release notes
2. Preserve all unrelated local/untracked work. Never add, modify, delete, stash, or commit unrelated files just to make the sync easier.
3. If `upstream/main` has no commits not already represented in `main`, report that and stop. Do not create a needless merge commit.
4. Before integration, create a recoverable backup ref/tag for the current canonical `main` tip.
5. Create an isolated integration branch/worktree based on current `main`, named like `sync/upstream-YYYYMMDD[-<version-or-sha>]`. Do not perform the first merge directly on canonical `main` or against the running production checkout.
6. Merge `upstream/main` into that isolated integration line. Resolve conflicts semantically. Do not blindly prefer either side and do not discard custom behavior merely to make Git clean.
7. Explicitly review overlapping auto-merges even when Git reports no textual conflict.
8. Preserve or deliberately supersede the custom regression contract below. If upstream now implements one of these behaviors differently, compare implementations and retire the custom implementation only when the upstream version is proven equivalent or better.
9. Run focused regression tests for every touched subsystem, TypeScript/type checks, broader relevant tests, runtime build/package smoke as applicable, and `git diff --check`. Use the repository-pinned Bun version.
10. If any material test/build/semantic validation fails, stop with canonical `main`, `origin/main`, and production unchanged. Report the blocker and keep the isolated integration branch/worktree for diagnosis.
11. If validation succeeds, re-check that canonical `main` has not moved since the integration started. Then promote the validated integration to local `main` without dropping history and push it to the user's writable `origin` fork.
12. Re-fetch and prove local `main == origin/main`. Leave `upstream` configured as fetch-only/read-only for normal workflow.
13. Do not delete backup refs, historical worktrees, or reconciliation artifacts as part of the sync unless the user explicitly asks for cleanup.
14. Deploy to production only when separately authorized. For an authorized deployment, drain/replace/restart using the repository's supported production procedure and run live post-deployment acceptance before declaring success.

### Custom regression contract that upstream integrations must protect

- Bigger Context semantic capacity remains 3x unless deliberately changed with evidence.
- Bigger Context physical browser transport remains adaptive 2–8 chunks unless an upstream design is proven to supersede it.
- Accumulated-context staging sizing remains correct.
- All multipart context is staged before execution as designed.
- Final multipart acknowledgement handling remains correct.
- Native compaction preserves the active user revision.
- Retained ChatGPT conversation reuse remains functional.
- Explicitly unfinished work continues in the retained conversation.
- Bigger Context ACK/DOM rebind recovery remains functional.
- An unrelated hung ChatGPT tab cannot block the owned tab.
- Generic failures are not falsely classified as model-capacity failures.
- Compatibility V1 High-to-High overload recovery remains valid.
- Launcher cold-start recovery remains functional.
- Runtime-supervisor cold-start hardening remains functional.

### Remote ownership model

- `origin` is the user's writable fork: `hpete28/codex-chatgpt-web`.
- `upstream` is the original developer repository: `miuuyy/codex-chatgpt-web`.
- Never rewrite/reset custom `main` to `upstream/main`.
- Never use a blind upstream pull on canonical `main` for this workflow.
- Never force-push canonical `main` merely to synchronize upstream.

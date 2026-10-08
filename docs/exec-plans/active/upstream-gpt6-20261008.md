# October 8 upstream and GPT-6 runtime update

## Requested outcome and protected state

The user authorized inspecting and updating the current runtime to latest upstream while preserving customizations, and removing the GPT-5.6 requirement for Web subagents.

Canonical main and origin/main began at `112a2690543ce0511f8997dced5bc5d89ee218db`. Backup tag: `backup/main-before-upstream-20261008`. The installed custom launcher identifies clean revision `66b64020b1848c429e2604bf7dd88b67d0e23afd`, version 6.1.3. Integrate that installed history before merging upstream `3077638`, including 6.1.6 and the subsequent parallel-tab model-picker fix.

Candidate: `D:\Projects\codex-chatgpt-web-sync-20261008`, branch `sync/upstream-20261008-v6.1.6`. The original checkout remains on its existing feature branch; its uncommitted launcher edits, untracked docs, audio and diagnostic files are outside this work. Historical worktrees and backup refs remain available. Upstream remains fetch-only.

## Semantic merge decisions

Keep custom build identity, upstream updater protection, diagnostic export and observations together with upstream activity/navigation improvements. Keep the browser-independent native runtime startup and gate browser-dependent upgrades on browser readiness. Preserve early verified CDP initialization, mixed-root WebSocket negotiation and bounded logout recovery from the installed revision.

Keep 3x GPT-5.6 and Pro context, adaptive 2–8 physical stages, accumulated-context sizing, staging every complete record before a small execution commit, final ACK ownership, active-revision compaction, retained conversation continuation, DOM recovery, unrelated-tab independence, typed failure classification, V1 capacity recovery and supervisor hardening. Incorporate upstream's safer Instant upload headroom. If the full context cannot fit eight Instant-sized stages, retain smaller stages at Medium/Pro instead of discarding records.

GPT-6 Sol deliberately uses upstream's measured family/account limits: 240,000 context with 220,000 compaction on Pro at Medium/High/Extra High; other GPT-6 Sol account/effort combinations retain standard context. GPT-6 Pro and GPT-5.6 retain 3x context. This cap does not change the physical staging contract. Internal shared `gpt-5.6-sol` transport identity is not a browser model requirement: upstream carries explicit model family separately and verifies the visible selection.

Preserve native catalog rows and prioritize GPT-6 Web reasoning/Pro in the five-entry V1 override registry. Keep GPT-5.6 available for retained chats. Subagent smoke defaults and current documentation now select GPT-6 Web models; native smoke uses GPT-6.1 Sol. The actual desktop backend is `0.162.0-alpha.2` at `C:\Users\Peter\AppData\Local\OpenAI\Codex\bin\9691020b546a15b2\codex.exe`; the unversioned binary is a different older client and must not be used as evidence for current compatibility.

Keep the non-Bun TOML parser and redact parser errors, plus the existing Windows Node zstd decoder. New upstream cancellation fixtures exposed a Bun 1.4.0 Windows failure when mixing aborted in-process Bun.serve requests with Node HTTP. Use Node HTTP fixtures matching the actual launcher, drain handlers before teardown and handle the intentionally cancelled request body. Preserve the cancellation and deadline assertions.

## Acceptance and deployment gates

Use pinned Bun 1.4.0, including its PATH for nested scripts. Require focused custom/context regressions, complete runtime and launcher suites, both typechecks, version synchronization, both dependency audits, current-client catalog and V1/V2 lifecycle checks, Web-only inheritance/depth/native-rejection checks, interrupt/cancellation checks, diff check, clean committed runtime/launcher builds, runtime release smoke and isolated packaged startup with verified source identity. Logs and exact build evidence live in ignored `output/`.

Promote only after material validation succeeds and canonical-main compare-and-swap proves the initial tip unchanged. Push without rewriting history, refetch, and prove main equals origin/main. Before deployment, checkpoint the complete prior installed application, durable runtime, configuration and integration state. Drain and wait for active work; preserve the signed-in profile. Validate installed hashes and revision, real CDP readiness and health, then run an authenticated GPT-6 Web-parent/High-child spawn and targeted wait. Preserve native defaults and verify routing/custom settings. Report any genuine acceptance limitation instead of claiming success from build output.

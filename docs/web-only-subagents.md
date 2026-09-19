# Web-only subagent provider: scope and design

This is an opt-in provider boundary and a separate optional spawn guardrail, not a
client-wide authorization policy. It does not secure a process that can select
another provider, read native credentials, change its configuration, or issue
native requests outside this bridge. Do not describe it as complete protection
for an arbitrary Web parent in the desktop app.

## Evidence and root cause

Audit date: 2026-09-19. Desktop Codex: `0.155.0-alpha.9.2`.
Canonical custom baseline: `1fb7f7434d3933b989dc87897f6ff23279d94c94`, installed
runtime 5.0.8, Compatibility V1. The original checkout was instead an older F1
branch at `4337eae999aec6c59fef81f511b2f207c3557eb6`; it and its untracked work
were left intact. The isolated fix uses the full 5.0.8 custom integration.

Local parent rollout `01a0b5de-3b9f-75c3-a196-0b838045a0bd` records explicit
`gpt-5.6-sol` spawns at 19:03:11 and 19:03:23 UTC on September 18. Child turn
contexts confirm native Sol. Spawns without model overrides at 19:29:59 and
19:31:17 have Web High child turn contexts. The 23:28:02 full-history fork
`01a0b6d9-3174-7361-a672-13c822785d0a` contains inherited Web context followed by
`thread_settings_applied` setting model `gpt-5.6-sol`, provider `openai`, and a
native turn context. Inherited contexts and completion events are not evidence
that the new child executed successfully. The later native child
`01a0b6f5-8dfa-7a91-bf9b-b7ceee6aeabe` records an aborted turn. The parent also
records rejection of `fork_context: true` plus `agent_type`, and an empty spawn
with `Provide one of: message or items`.

The 23:28 child has `task_complete.error.codex_error_info = usage_limit_exceeded`
at 23:28:07 UTC. A `task_complete` event with this error is a failed turn, not
successful task completion.

The normal catalog deliberately includes native models. V1 has a bounded child
model registry; ordering preserves Sol plus useful Web efforts. V2 inherits the
native catalog protocol and needs the bridge's plaintext collaboration marker.
Neither ordering nor a model default is an authorization constraint. Codex runs
the collaboration tools and applies child settings; the bridge sees the selected
model only when the child's Responses request arrives. Previously any non-Web
model immediately entered native passthrough.

Official references (consulted during implementation):

- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents): explicit
  spawn values and custom role configuration can override model defaults.
- [Hooks](https://learn.chatgpt.com/docs/hooks): PreToolUse supports spawn interception,
  but specialized paths can bypass hooks and hook failures can continue execution.
  SubagentStart cannot stop creation through `continue: false`.

## Implemented boundary

`webOnlySubagents` is absent by default. When configured it enables a separate
`/web-only/v1` provider using a random capability that is not a native OpenAI
credential. The normal `/v1` provider and native/mixed catalog remain available.

Both Responses and compaction check the capability and the account's available
Web routes before adapter construction or native forwarding. Missing models,
native models and invented Web slugs receive an explicit policy error. The same
capability on `/v1` remains protected. Stale/disabled capabilities are rejected;
the native forwarding function independently refuses all reserved Web-only
credentials and protected URLs, including search/images/catalog endpoints.
Only Responses, compaction and local model discovery are exposed to this token.
No native retry or replacement model is introduced.

Authorization is based on possession of a dedicated provider capability, **not**
on thread IDs, alleged parent IDs, rollout inheritance or agent names. Changing
those fields cannot relax it. Existing canonical rollout checks still handle
Web environment ownership. This is not new cryptographic parent/child identity
authentication. The capability survives lifecycle operations only while Codex
retains that provider and credential. A resumed child on another provider is
outside this boundary.

The optional `hook web-only-subagents` command is for a dedicated profile only.
Its decision function rejects explicit native/unavailable models and custom agent roles
(which can replace provider settings), checks a nonempty message, and makes an
omitted model explicit using `defaultModel` or the current Web model. It never
rewrites an explicit native model. It does not fabricate successful spawn, send,
wait or stop results. Actual lifecycle results remain owned by Codex.

**Creation-time enforcement failed the installed-client probe.** With the installed
`0.155.0-alpha.9.2`, both inline TOML and `hooks.json`, a wildcard matcher, enabled
hooks, and an isolated invocation bypassing hook trust, the probe recorded no hook
invocations and a native child was created. It then made one native-model request,
which the actual provider policy rejected with HTTP 400 before any native forwarding.
Do not rely on this hook or its defaultModel setting on that client. The exported
hook logic is unit-tested; its integration is unverified. The conformance probe
intentionally exits nonzero until creation-time denial and successful Web-child
completion are both confirmed. Root + native child + Web child were observed,
instead of the required root + Web child only.

## Configuration and lifecycle

In a **candidate** bridge home's `config.json`, add:

```json
"webOnlySubagents": {
  "token": "cw-web-only-<64 lowercase hex characters from 32 cryptographically random bytes>",
  "defaultModel": "chatgpt-web/high"
}
```

`defaultModel` applies only when the optional hook actually runs; it does not
rewrite HTTP requests or existing child settings. Omit it to inherit the parent's
model. On the current client, use its explicit `agents.default_subagent_model`
setting for an alternate approved Web default in the isolated profile, and verify
the effective child model; explicit spawn/role settings can still override it,
so the provider guard is essential.
Use an account-available Web model. Generate the random bytes locally; keep the
token out of logs and source control. Do not reuse `controlToken` or native
credentials. Restart the candidate bridge after configuration changes.

Prepare an isolated Codex home with a dedicated provider and no copied native
auth file. Point it at the candidate listener, for example:

```toml
model = "chatgpt-web/high"
model_provider = "web_only"
model_catalog_json = "/absolute/path/to/web-only-models.json"

[model_providers.web_only]
name = "Web-only subagents"
base_url = "http://127.0.0.1:17842/web-only/v1"
env_key = "CODEX_WEB_ONLY_TOKEN"
wire_api = "responses"
supports_websockets = false

[agents]
max_depth = 2

[features]
multi_agent = true
multi_agent_v2 = false

[[hooks.PreToolUse]]
matcher = "^(spawn_agent|Agent)$"
[[hooks.PreToolUse.hooks]]
type = "command"
command = '"<candidate-bun>" "<candidate-cli>" --home "<candidate-bridge-home>" hook web-only-subagents'
timeout = 10
```

Paths/quoting must match the platform. Use the runtime's `buildWebOnlyModelCatalog`
with the chosen Codex binary's `debug models --bundled` JSON to prepare the local
catalog. The protected `/models` endpoint can instead derive it from a usable
local `models_cache.json`; it never sends the capability to OpenAI. If neither
is available it fails with a diagnostic rather than native discovery. Hook trust
must be established in Codex; verify the hook in a fresh mock task before relying
on it. Set `CODEX_WEB_ONLY_TOKEN` only for that launched process.

Start a **fresh** task: changing the bridge does not rewrite the existing desktop
task's pinned provider, catalog, hooks or delegation protocol. Do not retrofit
the current production task. Disabling means removing this configuration and
restarting the candidate listener, then deliberately selecting the ordinary
provider for new mixed/native tasks. Old Web-only tokens stay blocked from native
passthrough even after disablement.

## Required client work for a complete guarantee

Codex must persist an immutable descendant routing policy in trusted thread state;
enforce it after role/default/explicit settings resolve and before child creation,
settings changes, follow-up, resume and every model request; bind provider and
credentials as well as model; and propagate it through forks/compaction. A policy
violation must fail without native fallback. It needs a trusted, scoped policy
identity across app-server/client boundaries, not caller-controlled metadata.
The bridge cannot infer this securely from a shared native bearer plus thread ID.

## Deployment and rollback

No production deployment is part of this change. Validate the candidate in a
separate listener/home/browser/connector first. Never point the existing live
smoke script at production to simulate isolated acceptance. After explicit
deployment approval, build from the reviewed committed revision, use the
repository's drain/install/restart procedure, and run one protected Web child
before testing parallel or nested children. Check its *effective* post-settings
model and returned output, message acknowledgement and bounded wait results.
Then verify an attempted native selection fails with zero native forwarding.

Rollback by stopping the candidate, removing its dedicated profile/hook and
capability, and retaining the existing 5.0.8 production installation. For an
approved later deployment, retain that immutable bundle and restore it through
the supported drained installation procedure. No reset, force-push or cleanup
of historical worktrees is needed.

## Validation ledger (2026-09-19)

All repository checks used Bun 1.4.0. No native model inference was used for
testing; real-client tests used deterministic local Responses servers and fake
or local-only credentials.

| Check | Observed result |
| --- | --- |
| Full runtime suite, before the final two added tests | 794 passed, 1 skipped, 2 failed (797 total) |
| Final focused policy/catalog/passthrough/subagent/compaction suites | 63 passed, 0 failed |
| Launcher suite after installing its pinned dependencies | 341 passed, 3 skipped, 1 failed (345 total) |
| Runtime TypeScript, version consistency, launcher TypeScript and renderer build | Passed |
| V1 explicit Web child + grandchild + wait + interrupted follow-up | Passed against real client/local mock |
| V1 inherited Web child + grandchild + follow-up | Passed against real client/local mock |
| V2 explicit Web child + grandchild + follow-up | Passed against real client/local mock |
| V1 maximum depth | Passed: client removed spawn tool at depth 2 and rejected attempted deeper spawn |
| Existing V1 mixed/native-child lifecycle | Passed against real client/local mock |
| Creation-time hook conformance | Failed: native child created; HTTP model guard blocked execution |
| DEV browser-backed live acceptance | Blocked: DEV descriptor owner PID 10608 was not running |

The three broad-suite failures are file-symlink creation `EPERM` failures on
Windows. The identical two runtime integration cases and one launcher rollback
case were rerun against unchanged baseline `1fb7f74` and reproduced. They remain
failed, not waived or relabeled as passed. The initial launcher run also lacked
Electron dependencies; its result was superseded after a frozen-lockfile install.

The hook probe's inherited full-history Web child returned its output to the
parent, but the probe deliberately remains failed because creation-time native
denial did not occur. The initial Pro-based mock additionally exposed client
reasoning-effort normalization (`ultra` requested, `medium` observed); the routing
acceptance matrix uses supported High and does not claim to repair Pro effort.

Still unverified: browser-backed single/parallel/nested execution; end-to-end
protected close/stop/resume/cancellation and compaction across a client restart;
scope binding when a client switches provider; default override through a hook
that actually executes; and creation-time authorization. Unit tests cover the
request boundary after changed model/identity, error terminal status, protected
compaction, stale/revoked credentials, and invalid hook arguments. These narrower
tests do not establish those unexecuted end-to-end guarantees.

Run the opt-in client probes from the repository, supplying an explicit Codex
executable path:

```text
bun run scripts/smoke-codex-subagents.ts --v1 --web-only <codex-executable>
bun run scripts/smoke-codex-subagents.ts --v1 --web-only --inherit-model <codex-executable>
bun run scripts/smoke-codex-subagents.ts --v1 --web-only --check-depth <codex-executable>
bun run scripts/smoke-codex-subagents.ts --v2 --web-only <codex-executable>
bun run scripts/smoke-web-only-subagents.ts <codex-executable>
```

The last command is the strict creation-time conformance probe and is expected
to exit nonzero on the audited client. It retains its isolated evidence directory,
including `acceptance.json`, effective applied/turn models, hook invocation
presence, child count, and rejection count. It does not promote or deploy anything.
Review all retained mock evidence before using the candidate as a production policy.

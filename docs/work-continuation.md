# Retained Web work continuation

## Problem and evidence

On 5.0.6 (`e85e369`), a browser response can finish normally before a substantive Codex task is
finished. One user-observed High/Sol response ended at about 26m25s with required work remaining.
That observation does not establish a universal time limit. The browser's completed-response DOM
and the broker completion fence establish transport completion and settled tool activity, not
semantic task completion. The adapter previously turned that outcome directly into a native final.

[Issue #194](https://github.com/miuuyy/codex-chatgpt-web/issues/194) and
[PR #195](https://github.com/miuuyy/codex-chatgpt-web/pull/195) are prior art, not merged requirements.
The initial proposal combined a duration-based audit with stopped-thinking recovery. The revised
PR retained only one stopped-thinking recovery; both were closed without a substantiated live
reproduction. This change does not recover stopped-thinking, infer a deadline, or replay a prompt.

## Contract

The existing `codex_tool_call` control plane accepts `codex.control.work_state` for eligible owners.
The model records `status`, `remaining`, and concrete `progress` evidence serially after outstanding
tool results settle. `continue` means required, authorized, actionable work remains. `complete`
clears remaining work; `blocked` identifies work that cannot safely proceed. Simple direct answers
need no control call. The connector's public tool names and schemas do not change.

On a normal Web completion, the adapter checks that recorded state only after `worker.run` has
physically settled, including the launcher's retain acknowledgement. A `continue` state must also
have an unchanged committed broker fence with no pending activities or invocations. The adapter
then sends a short continuation through `prepareResume`, requiring the exact retained conversation.
It preserves the original native turn, stream journal, tool-result ownership, cancellation signal,
and conversation key. The continuation explicitly requires reassessment against existing evidence,
not repetition of completed work.

The native owner token remains internal and stable across these messages. Each new Web message gets
a fresh browser capability and binding; previous browser tokens/bindings remain retired. Rotation
invalidates delayed completion-fence revisions and old activity cleanup cannot mutate the new
message. No browser/helper IPC, public connector schema, native Codex tool, scheduler, persistent
task store, installation, or updater changes are required.

`complete`, `blocked`, absent state, and compaction do not schedule a continuation. Browser errors,
uncertain submission, revoked capabilities, missing retained conversations, and cancellation fail
closed. A consumed state cannot authorize a later message without another report; identical
progress at consecutive boundaries fails closed. There is no elapsed-time or fixed-round trigger.
Luna, Browser-only, Zero Risk, structured-output turns, and remote owners without this extension
keep their existing behavior. Native compaction remains authoritative and can intercept newly
requested work through its existing tool-result handoff.

## Evidence limits and acceptance

This is an explicit model-reported signal, not an independent proof of task completion. Native
Goal state is not an authoritative feed to this adapter, and an active Goal or unfinished plan can
also mean blocked work. Prose classification and duration cannot safely distinguish those cases.
If the model never records remaining work, a clean final retains the old behavior. A stale report
can cause one reassessment message; the model is instructed to clear it before its final answer.
Live testing must establish whether High/Sol follows this contract reliably; synthetic tests alone
do not prove that the reported long-run failure is fixed in practice.

Focused tests cover real MCP handler round trips, completed/blocked/missing state, multiple fresh
progress reports, stable native ownership, retired capabilities, canonical tool results, in-flight
effects, cancellation, initial failure, ambiguous follow-up submission, retained-chat requirements,
exact native request replay, and compaction priority. Existing browser completion, retained
compaction, native interruption, and structured-output suites remain relevant gates.

For live acceptance, use a candidate-built isolated DEV launcher and `Codex Native2 DEV`, preserving
the official profile and connector. Exercise a controlled early clean boundary with recorded work
remaining, followed by actual tool use in the same chat; test complete, blocked, cancel, and compact
cases too. DEV outer-tool receipts are simulations and must not be reported as real filesystem
effects. Also reproduce a substantive High/Sol run before claiming the 26-minute incident resolved.

Keep the work on a small branch over `origin/main`. Build from its recorded commit and retain
redacted validation evidence outside the patch. Normal upstream updates remain normal; until
upstream accepts the change, rebase/cherry-pick the patch and revalidate. Do not install a candidate
over the official runtime before live acceptance and the user's production-install review.

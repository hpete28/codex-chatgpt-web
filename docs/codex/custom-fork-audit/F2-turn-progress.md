# F2: Per-turn observed progress

Status: specified, not implemented. Priority: second. User outcome: understand what a long-running turn is doing without interpreting a mixed process log.

## Scope

Extend Activity with a turn selector and compact current summary: phase, time of last observed progress, acknowledged multipart count when known, continuation count, and terminal transport outcome. Keep the existing general log. Show only existing owned turns; add no new browser activity or polling of ChatGPT DOM.

Reuse `BrowserTabState.traceId`, worker stage/ACK callbacks, `ChatGptExternalTurnProgress`, existing helper/control transport and launcher snapshot. The producer owns observations; the renderer owns only presentation. Do not parse prose, console strings, or model output to derive a phase.

## Frozen MVP contract

Use one shared DTO definition and one validator. The following is a proposed new telemetry DTO, not an assertion that the existing IPC already carries these fields:

```ts
type TurnObservation = {
  traceId: string;
  sequence: number; // positive, increasing for this trace from one sequencer
  at: string;       // ISO timestamp of observation
  phase: "preparing" | "staging" | "responding" | "tools"
       | "recovering" | "continuing" | "compacting"
       | "finished" | "cancelled" | "failed";
  acknowledgedParts?: number;
  totalParts?: number;
  continuationCount?: number;
  workState?: "continue" | "complete" | "blocked";
};
```

F2-R1. The adapter-side turn coordinator owns the sequencer, including worker/helper observations and continuation boundaries. Only it publishes finalized observations to the launcher through the existing owned control channel. Add a telemetry-only control message if required; do not overload or acknowledge lifecycle/lease heartbeats as semantic progress. The lead freezes this protocol addition and all producer/consumer definitions in F2a before delegation.

F2-R2. Bind updates to the current owned trace and existing process ownership checks. Never use capability tokens, conversation URLs or task text as a correlation key. Ignore unknown/retired traces, duplicate/out-of-order sequence values, malformed counts and observations after a terminal state. Validate counts as integers with `0 <= acknowledgedParts <= totalParts <= 8` when present. Trace IDs are identifiers, not authorization credentials.

F2-R3. Emit phase changes only from existing evidence: preparation start; actual stage ACK; response observation; active/settled tool transitions; recovery entry; committed continuation decision; native compaction entry; existing terminal result. `finished` means the native transport finished, not that all requested work succeeded. `workState` is an optional **model-reported** enum, never an independent completion judgment. Omit `remaining` and `progress` free text entirely.

F2-R4. For continuation, preserve a native-turn summary using the coordinator's existing ownership context even if a Web segment has a fresh trace/capability. Maintain any segment-to-summary association locally and retire it with the turn. Do not reuse or leak a capability as a summary ID. Increment continuation count only after a continuation is actually committed. Recovery does not itself increment continuation count. No new durable task identity is introduced.

F2-R5. Telemetry cannot await renderer delivery or control acknowledgements on the execution path. Use a bounded best-effort send that drops/coalesces intermediate observations under pressure; retain the latest terminal observation for the next snapshot when possible. Failed delivery must not reject the turn, extend a deadline, count as tool progress, trigger recovery or resend a prompt. Do not build a generic event bus.

F2-R6. Keep summaries for active owned turns and at most the 20 most recently completed native turns in launcher memory. Keep only the latest summary per turn, not an unbounded event list. Remove completed summaries oldest first; do not evict active summaries. Restart clears this in-memory view. Existing logs retain their own policy. No disk history or database is added.

F2-R7. Activity displays unknown fields as unavailable; a missing event must not imply idle, failure or success. “Last observed progress” uses producer observation time, not UI refresh or heartbeat time. No percent complete, stall alarm based only on age, ETA, or guessed token budget. Manual mode uses already-known manual lifecycle only and never enables DOM access. If a stage is unobservable, omit it.

## File ownership

Lead owns DTO/control validation and wiring in `src/launcher-browser-host.ts`, helper protocol files, `index.ts`, `browser-worker.ts`, Electron control server/browser host/main, and `launcher/src/types.ts`. Helper agent can implement a small pure projector and tests after interfaces are frozen. UI agent owns Activity additions, styling, labels and renderer tests. Avoid reorganizing those large source files.

## Acceptance

| ID | Observable check |
| --- | --- |
| F2-A1 | Interleaved events for two turns remain isolated; selection shows the correct summary. |
| F2-A2 | Reordered/duplicate events and retired traces cannot overwrite newer or terminal state. |
| F2-A3 | ACK count advances only on exact real ACK evidence; 2-, 3-, and 8-part fixtures display correctly without changing execution. |
| F2-A4 | A clean Web boundary with committed continuation shows continuing/count; absent/blocked/complete work state adds no continuation. |
| F2-A5 | Bounded retention and dropped/invalid telemetry preserve terminal state when available and never mutate turn lifecycle. |
| F2-A6 | Missing, slow and failing telemetry sinks do not alter tool dispatch, cancellation, retries, ACK ordering or final result. Test the real process boundary as well as the pure projector. |
| F2-A7 | UI distinguishes finished transport from model-reported work state and presents absent data honestly. |
| F2-A8 | Manual mode does not access the DOM; the five-tab cap and existing close/cancel behavior are unchanged. |
| F2-A9 | Isolated DEV turn demonstrates stage/tool/continuation or compaction signals from actual emitters; fixture-only UI screenshots are not live acceptance. |

Run affected helper/control/browser tests plus the custom suites in acceptance.md. Update the two drifted architecture/continuation descriptions identified in the audit after checking the current source. Do not alter their underlying semantics to make documentation simpler.

## Non-goals

No queue, retry/resume buttons, extra slots, task scheduler, persistent work-state database, automatic recovery policy changes, telemetry server, or claim that a long quiet interval proves a hang. No new dependency is necessary.

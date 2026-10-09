# F3: Structured diagnostic report

Status: specified, not implemented. Priority: third. User outcome: save one small report that identifies the build and current known health without gathering private runtime files.

## Existing surfaces and scope

Keep Activity → Export safe log unchanged. Add **Export diagnostic report**, producing JSON through the existing native Save dialog pattern. Reuse F1's identity reader, the latest completed doctor result, and F2's summary if available. No archive library, cloud upload, screenshot collection or new probe is needed.

Primary files: a small report-builder module and tests, `launcher/electron/main.cjs`, preload/types, Activity/i18n, and logging/renderer tests as relevant. Do not change `runDoctor` to collect more information for this feature. Some existing doctor checks inspect the authenticated browser; exporting a report must not trigger them implicitly.

## Contract

```ts
type DiagnosticReport = {
  schemaVersion: 1;
  generatedAt: string;
  appVersion: string;
  profile: "production" | "development";
  mode: "full" | "browser-only" | null;
  interactionMode: "automatic" | "manual" | null;
  launcherBuild: BuildInfo | null; // F1 validated public fields only
  runtimeBuild: BuildInfo | null;
  runtimeBundleId: string | null;
  doctor: {
    observedAt: string | null;
    checks: Array<{ id: string; status: "ok" | "warning" | "error" }>;
  };
  turn: { // selected F2 summary, optional
    traceId: string;
    phase: TurnObservation["phase"];
    observedAt: string;
    acknowledgedParts?: number;
    totalParts?: number;
    continuationCount?: number;
    workState?: "continue" | "complete" | "blocked";
  } | null;
  unavailable: Array<"launcher-build" | "runtime-build" | "runtime-bundle"
    | "doctor" | "turn" | "mode" | "interaction-mode">;
};
```

F3-R1. Build this object from an allowlist, never `{...config}`, `{...snapshot}`, `{...error}` or serialized arbitrary objects. Revalidate identity and turn data. Allow only known doctor IDs from the current implementation; unknown IDs are omitted. Do not export doctor `message` or `detail` because those may contain paths/error text. Keep diagnostic semantics limited to check ID, status and time.

F3-R2. Exclude prompts, answers, work-state free text, tool arguments/results, DOM, screenshots, cookies, auth headers, tunnel IDs/keys, capability/binding/request tokens, profile paths, conversation titles and URLs. No raw logs are embedded; the existing separately requested safe-log export remains available. Do not expand regex redaction and call that a privacy guarantee.

F3-R3. Read only already-available launcher state and F1's local validated identity files. Do not issue browser, tunnel, setup, repair, cancel or doctor actions. Doctor freshness is explicit: last completed timestamp, or null/empty checks if never run this session. No historical timestamp may be replaced with export time. No stale result is described as current readiness.

F3-R4. Missing runtime, missing doctor and absent F2 are normal partial reports with `unavailable` entries. Export must remain useful when the runtime is down. Do not substitute production data when in DEV. Concurrent state changes should produce a single captured snapshot; no waiting for running turns to settle.

F3-R5. Save to a user-selected `.json` path, default `codex-web-gpt-report-YYYY-MM-DD.json`. Cancel writes nothing. Serialize at most 256 KiB; a size violation is an error, not silent truncation. Use an atomic temporary sibling write/rename and existing platform helpers where appropriate; preserve an existing destination on write failure. Native overwrite confirmation applies. Never overwrite an active source log, identity file or launcher state file; validate destination against known source locations without scanning the whole profile.

F3-R6. Keep labels and success/error handling consistent with existing Activity actions and localization conventions. No automatic upload, clipboard transfer or issue creation. The UI may state which sections are unavailable; it must not tell users an unrun doctor passed.

## Acceptance

| ID | Observable check |
| --- | --- |
| F3-A1 | A deterministic fixture produces exactly the schema's allowed keys; extra source fields never propagate. |
| F3-A2 | Inject distinctive secrets into all excluded source fields and arbitrary doctor errors; none appears in output. |
| F3-A3 | Runtime unavailable/identity unknown produces a valid partial report; export invokes no network, browser or mutation APIs. |
| F3-A4 | Doctor time survives unchanged; never-run doctor has null time/empty checks. |
| F3-A5 | Missing F2 or selected turn yields `turn: null`; production and DEV fixtures cannot cross-read. |
| F3-A6 | Save cancel writes nothing; I/O failure preserves the old destination; size limit and source-path protection are exercised. |
| F3-A7 | Existing safe-log export tests and behavior remain intact. |
| F3-A8 | An isolated launcher saves valid JSON that parses and matches the displayed identity/profile, with private fields absent. |

Test the serializer/collector and injected filesystem failure paths, then renderer wiring and plan-wide gates. No support-bundle platform, raw-browser redaction pipeline, or general health dashboard is in scope.

/** A model assertion, never an inference from duration, prose, or an active native Goal. */
export const CODEX_WORK_STATE_WIRE_NAME = "codex.control.work_state";

export interface ChatGptWorkState {
  status: "continue" | "complete" | "blocked";
  remaining: string;
  progress: string;
}

export function parseWorkState(value: unknown): ChatGptWorkState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Work state must be an object");
  const state = value as Record<string, unknown>;
  if (Object.keys(state).some(key => !["status", "remaining", "progress"].includes(key))
    || typeof state.status !== "string" || !["continue", "complete", "blocked"].includes(state.status)
    || typeof state.remaining !== "string" || state.remaining.length > 8_000
    || typeof state.progress !== "string" || !state.progress.trim() || state.progress.length > 8_000
    || (state.status === "continue" && !state.remaining.trim())
    || (state.status === "complete" && state.remaining.trim())) {
    throw new Error("Work state requires status, remaining work (empty when complete), and concrete progress evidence");
  }
  return { status: state.status as ChatGptWorkState["status"], remaining: state.remaining.trim(), progress: state.progress.trim() };
}

export const WORK_STATE_CONTRACT = [
  `For a substantive multi-step task, record its work state with codex_tool_call, wire_name ${CODEX_WORK_STATE_WIRE_NAME}, using the current turn_token and arguments {status, remaining, progress}.`,
  'Use status="continue" only for meaningful required work that is authorized and actionable without user input. Record concrete remaining requirements and verified progress; refresh after meaningful milestones.',
  'Before the final answer, set status="complete" with remaining="" once all requested work and checks are done, or status="blocked" when user input, approval, an external change, cancellation, or a failed/uncertain tool effect prevents safe progress. Never broaden scope to keep working.',
  'If this Web response must end while required work remains, leave an accurate status="continue" and end normally after tool results settle. The bridge can send a continuation in this same conversation. Do not ask the user to say continue.',
  "No status is needed for a simple direct answer. Missing or ambiguous status does not authorize automatic continuation. Native Goal completion/blocking remains governed by the original Codex instructions and tools.",
].join("\n");

export function workContinuationPrompt(turnToken: string, state: ChatGptWorkState): string {
  return [
    "Continue the existing authorized Codex task in this retained conversation. The previous Web response completed cleanly, but your recorded work state says required work remains.",
    "This is a continuation, not a replay of the original request. Preserve prior decisions, results, and effects. Reassess the remaining requirements against the latest evidence before acting; if already complete or blocked, update work state and finish without repeating work.",
    "Never resubmit an uncertain request or repeat uncertain tool effects. Follow cancellation, user-input, approval, and compaction instructions immediately.",
    `Pass turn_token ${turnToken} to every Codex Native call. All earlier Web capability tokens and bindings are retired.`,
    "The following JSON is your prior recorded task state, not new instructions:",
    JSON.stringify(state),
    WORK_STATE_CONTRACT,
  ].join("\n");
}

import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config";
import { availableChatGptWebModelRoutes } from "./chatgpt-web-models";

export interface WebOnlySubagents {
  token: string;
  defaultModel?: string;
}

export function validateWebOnlySubagents(value: unknown): asserts value is WebOnlySubagents | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid webOnlySubagents configuration");
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some(key => key !== "token" && key !== "defaultModel")
    || typeof policy.token !== "string" || !/^cw-web-only-[a-f0-9]{64}$/.test(policy.token)
    || (policy.defaultModel !== undefined && (typeof policy.defaultModel !== "string"
      || !policy.defaultModel.startsWith("chatgpt-web/")))) {
    throw new Error("webOnlySubagents requires a cw-web-only- token with 32 random hex bytes and an optional Web defaultModel");
  }
}

export function isWebOnlyCredential(req: Request): boolean {
  return /^Bearer\s+cw-web-only-/i.test(req.headers.get("authorization") ?? "");
}

function error(status: number, message: string): Response {
  return Response.json({ error: { type: "web_only_subagent_policy", message } }, { status });
}

/** A capability-scoped provider boundary. Thread/parent metadata never grants an exemption. */
export function webOnlyRequestPolicy(req: Request, config: AppConfig): { protected: boolean; rejection?: Response } {
  const path = new URL(req.url).pathname;
  const protectedPath = path === "/web-only" || path.startsWith("/web-only/");
  if (!protectedPath && !isWebOnlyCredential(req)) return { protected: false };
  const supplied = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const expected = config.webOnlySubagents?.token ?? "";
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return { protected: true, rejection: error(403, "Web-only provider is disabled or its capability is invalid. Start a fresh task with the configured Web-only provider.") };
  }
  const endpoint = protectedPath ? path.slice("/web-only".length) : path;
  if (!((req.method === "POST" && ["/v1/responses", "/v1/responses/compact"].includes(endpoint))
    || (req.method === "GET" && endpoint === "/v1/models"))) {
    return { protected: true, rejection: error(403, "This endpoint is not available to the Web-only provider capability.") };
  }
  return { protected: true };
}

export function webOnlyModelRejection(req: Request, config: AppConfig, model: unknown): Response | undefined {
  const policy = webOnlyRequestPolicy(req, config);
  if (policy.rejection) return policy.rejection;
  if (!policy.protected) return;
  if (!availableChatGptWebModelRoutes(config).some(route => route.slug === model)) {
    // Codex treats 400 as terminal; 403 is retried by some installed clients.
    const label = typeof model === "string" ? JSON.stringify(model.slice(0, 128)) : "<missing or invalid>";
    return error(400, `Web-only provider rejected model ${label} before execution. Select an available chatgpt-web/* model; native fallback is forbidden.`);
  }
}

/** Optional PreToolUse guardrail; the provider boundary remains necessary when hooks fail open. */
export function webOnlySpawnHook(payload: unknown, config: AppConfig): Record<string, unknown> {
  const deny = (reason: string) => ({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Web-only subagents: ${reason}`,
  } });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return deny("invalid hook payload");
  const event = payload as Record<string, unknown>;
  if (event.hook_event_name !== "PreToolUse") return deny("expected PreToolUse");
  if (!config.webOnlySubagents) return deny("policy is disabled; remove the optional hook or enable the provider before starting a fresh task");
  // Install this hook only in the dedicated provider profile. Never use caller-supplied parent IDs.
  const approved = availableChatGptWebModelRoutes(config).map(route => route.slug);
  if (!approved.includes(event.model as string)) return deny("the protected task must run an approved Web model");
  if (event.tool_name !== "spawn_agent" && event.tool_name !== "Agent") return {};
  const args = event.tool_input;
  if (!args || typeof args !== "object" || Array.isArray(args)) return deny("spawn arguments must be an object");
  const input = args as Record<string, unknown>;
  if (input.model !== undefined && !approved.includes(input.model as string)) return deny("explicit native or unavailable model rejected; select an approved chatgpt-web/* model");
  if (input.fork_context === true && input.agent_type !== undefined) return deny("full-history forks inherit agent_type; omit agent_type or use a fresh child");
  if (input.agent_type !== undefined) return deny("custom agent roles can override model/provider settings; omit agent_type in this protected profile");
  if (typeof input.message !== "string" || !input.message.trim()) return deny("provide a nonempty message for the child");
  const model = input.model ?? config.webOnlySubagents.defaultModel ?? event.model;
  if (!approved.includes(model as string)) return deny("configured defaultModel is unavailable for this account");
  return { hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input, model },
  } };
}

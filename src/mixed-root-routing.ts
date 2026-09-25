import { getCodexHome } from "./codex-integration-shared";
import { extractCodexTurnIdentityFromBody } from "./adapters/chatgpt-web/environment";
import { resolveCodexRoutingLineage } from "./adapters/chatgpt-web/codex-rollout-environment";
import { availableChatGptWebModelRoutes } from "./chatgpt-web-models";
import type { AppConfig } from "./config";
import { readJsonRequestBody } from "./http-body";
import { isWebOnlyCredential } from "./web-only-subagents";

function reject(message: string, status = 400): Response {
  return Response.json({ error: { type: "mixed_root_routing_policy", message } }, { status });
}

/** The URL is the opt-in boundary; the canonical Codex rollout supplies ancestry on every turn. */
export async function mixedRootRequestPolicy(req: Request, config: AppConfig): Promise<{ protected: boolean; rejection?: Response; body?: Record<string, unknown> }> {
  const path = new URL(req.url).pathname;
  if (path !== "/mixed-root" && !path.startsWith("/mixed-root/")) return { protected: false };
  if (isWebOnlyCredential(req)) return { protected: true, rejection: reject("Web-only capabilities cannot use the mixed-root native route", 403) };
  if (!/^Bearer\s+\S+$/i.test(req.headers.get("authorization") ?? "")) {
    return { protected: true, rejection: reject("Mixed-root route requires provider authorization", 403) };
  }
  const endpoint = path.slice("/mixed-root".length);
  if (req.method === "GET" && endpoint === "/v1/models") return { protected: true };
  if (req.method !== "POST" || (endpoint !== "/v1/responses" && endpoint !== "/v1/responses/compact")) {
    return { protected: true, rejection: reject("Endpoint is unavailable on the mixed-root route", 403) };
  }
  try {
    const raw = await readJsonRequestBody(req);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid Responses body");
    const body = raw as Record<string, unknown>;
    const turnHeader = endpoint === "/v1/responses/compact" ? req.headers.get("x-codex-turn-metadata") : null;
    const clientMetadata = body.client_metadata && typeof body.client_metadata === "object" && !Array.isArray(body.client_metadata)
      ? body.client_metadata as Record<string, unknown> : {};
    const identity = extractCodexTurnIdentityFromBody(turnHeader
      ? { ...body, client_metadata: { ...clientMetadata, "x-codex-turn-metadata": turnHeader } }
      : body);
    if (!identity.threadId || !identity.turnId || typeof body.model !== "string") {
      throw new Error("missing Codex thread, turn, or model identity");
    }
    const lineage = resolveCodexRoutingLineage({
      codexHome: getCodexHome(), threadId: identity.threadId, turnId: identity.turnId,
      model: body.model, parentThreadId: identity.parentThreadId, agentName: identity.agentName,
    });
    const approved = availableChatGptWebModelRoutes(config).some(route => route.slug === body.model);
    if (lineage.depth > 0 && !approved) {
      return { protected: true, rejection: reject("Protected descendant requires an approved chatgpt-web/* model before inference") };
    }
    if (lineage.depth === 0 && body.model.startsWith("chatgpt-web/") && !approved) {
      return { protected: true, rejection: reject("Protected Web root model is unavailable") };
    }
    return { protected: true, body };
  } catch (error) {
    return { protected: true, rejection: reject(`Cannot authenticate protected Codex lineage: ${error instanceof Error ? error.message : String(error)}`) };
  }
}

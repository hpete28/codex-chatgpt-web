import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { compactRequest, responseRequest, startServer } from "../src/server";
import { forwardNativeCodexRequest } from "../src/native-passthrough";
import { augmentNativeModelCatalog, buildWebOnlyModelCatalog } from "../src/model-catalog";
import { validateWebOnlySubagents, webOnlyRequestPolicy, webOnlySpawnHook } from "../src/web-only-subagents";

const token = `cw-web-only-${"a".repeat(64)}`;
function config() {
  return { ...defaultConfig("browser-only"), solAvailable: true, webOnlySubagents: { token } };
}
function request(model: unknown, path = "/web-only/v1/responses", metadata: unknown = {}, credential = token) {
  return new Request(`http://127.0.0.1${path}`, { method: "POST",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, input: [{ role: "user", content: "test" }], client_metadata: metadata }),
  });
}

test("configuration is opt-in and rejects malformed capabilities and native defaults", () => {
  expect(defaultConfig("full").webOnlySubagents).toBeUndefined();
  for (const value of [null, true, {}, { token: "secret" }, { token, defaultModel: "gpt-5.6-sol" }, { token, extra: true }]) {
    expect(() => validateWebOnlySubagents(value)).toThrow();
  }
  expect(() => validateWebOnlySubagents({ token, defaultModel: "chatgpt-web/high" })).not.toThrow();
});

test("direct Responses and compaction reject native, missing, and forged Web slugs before constructing an adapter", async () => {
  let adapters = 0;
  const forbidden = () => { adapters++; throw new Error("must not execute"); };
  for (const model of ["gpt-6-astra", "gpt-5.6-sol", "chatgpt-web/forged", undefined, ""]) {
    for (const handler of [responseRequest, compactRequest]) {
      const response = await handler(request(model), config(), forbidden);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("before execution");
    }
  }
  expect(adapters).toBe(0);
});

test("changed, forged, stale and absent lineage cannot exempt the protected credential", async () => {
  for (const metadata of [{}, { thread_id: "new-root" }, { thread_id: "old-child", parent_thread_id: "native-parent" },
    { thread_id: "nested", parent_thread_id: "forged", model: "chatgpt-web/high" }]) {
    const response = await responseRequest(request("gpt-5.6-sol", "/v1/responses", metadata), config());
    expect(response.status).toBe(400);
  }
});

test("capability cannot escape to another route, survive revocation, or use malformed auth", () => {
  for (const path of ["/admin/shutdown", "/v1/images/generations", "/v1/alpha/search", "/healthz"]) {
    expect(webOnlyRequestPolicy(request("gpt-5.6-sol", path), config()).rejection?.status).toBe(403);
  }
  expect(webOnlyRequestPolicy(request("chatgpt-web/high"), defaultConfig("full")).rejection?.status).toBe(403);
  expect(webOnlyRequestPolicy(request("chatgpt-web/high", undefined, {}, `cw-web-only-${"b".repeat(64)}`), config()).rejection?.status).toBe(403);
  expect(webOnlyRequestPolicy(request("chatgpt-web/high", undefined, {}, "native-key"), config()).rejection?.status).toBe(403);
  expect(webOnlyRequestPolicy(request("chatgpt-web/high", undefined, {}, "é".repeat(token.length)), config()).rejection?.status).toBe(403);
});

test("native forwarding itself never sends protected capabilities, including disabled/stale tokens", async () => {
  let forwarded = 0;
  const upstream = async () => { forwarded++; return Response.json({ ok: true }); };
  for (const endpoint of ["responses", "responses/compact", "models", "alpha/search", "images/generations", "images/edits"] as const) {
    await expect(forwardNativeCodexRequest(request("gpt-5.6-sol", "/v1/responses"), endpoint, upstream)).rejects.toThrow("Web-only");
  }
  expect(forwarded).toBe(0);
  // An intentionally native parent/child or existing mixed task still has native authorization.
  expect((await forwardNativeCodexRequest(request("gpt-5.6-sol", "/v1/responses", {}, "native-key"), "responses", upstream)).status).toBe(200);
  expect(forwarded).toBe(1);
  expect(webOnlyRequestPolicy(request("gpt-5.6-sol", "/v1/responses", {}, "native-key"), config()).protected).toBe(false);
});

test("approved Web requests execute once and Web failures never fall back to native", async () => {
  for (const failed of [false, true]) {
    let ran = 0;
    const response = await responseRequest(request("chatgpt-web/high"), config(), () => ({ name: "isolated-mock", async runTurn(_p, _i, emit) {
      ran++;
      if (failed) emit({ type: "error", message: "Web route failed" });
      else { emit({ type: "text_delta", text: "WEB_RESULT" }); emit({ type: "done", stopReason: "stop" }); }
    } }));
    const body = await response.json() as { status: string };
    expect(body.status).toBe(failed ? "failed" : "completed");
    expect(ran).toBe(1);
  }
});

test("protected compaction retains the capability on its internal Responses request", async () => {
  let turns = 0;
  const response = await compactRequest(request("chatgpt-web/high", "/web-only/v1/responses/compact"), config(), () => ({
    name: "mock-compactor", async runTurn(parsed, incoming, emit) {
      turns++;
      expect(parsed._compactionRequest).toBe(true);
      expect(incoming.headers.get("authorization")).toBe(`Bearer ${token}`);
      emit({ type: "text_delta", text: "Retain the current user task and Web route.", phase: "final_answer" });
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }));
  expect(response.status).toBe(200);
  expect((await response.json() as { output: unknown[] }).output.length).toBeGreaterThan(0);
  expect(turns).toBe(1);
  // A subsequent native model-switch request cannot use compaction/history as an exemption.
  expect((await responseRequest(request("gpt-5.6-sol", "/v1/responses", { thread_id: "resumed-child" }), config())).status).toBe(400);
});

test("HTTP routing preserves the policy through aliases and rejects native endpoint access", async () => {
  const cfg = config(); cfg.port = 0;
  const server = startServer(cfg, { fetchUpstream: async () => { throw new Error("unexpected network request"); } });
  try {
    for (const path of ["/web-only/v1/responses", "/v1/responses", "/web-only/v1/responses/compact", "/v1/alpha/search"]) {
      const req = request("gpt-5.6-sol", path);
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", headers: req.headers, body: await req.text() });
      expect(response.status).toBe(path === "/v1/alpha/search" ? 403 : 400);
      expect(await response.text()).toContain("Web-only");
    }
  } finally { await server.stop(true); }
});

test("Web-only roster never changes the mixed roster or advertises unavailable account models", () => {
  const source = { models: [{ slug: "gpt-5.6-sol", priority: 1, visibility: "list", supported_reasoning_levels: [], tool_mode: "code_mode_only" }] };
  for (const protocol of ["compatibility-v1", "native"] as const) {
    const cfg = config(); cfg.subagentProtocol = protocol;
    const mixed = augmentNativeModelCatalog(source, cfg).models as { slug: string }[];
    const web = buildWebOnlyModelCatalog(source, cfg).models as { slug: string }[];
    expect(mixed.some(row => row.slug === "gpt-5.6-sol")).toBe(true);
    expect(web.every(row => row.slug.startsWith("chatgpt-web/"))).toBe(true);
    expect(web.some(row => row.slug === "chatgpt-web/pro")).toBe(false);
    expect(source.models).toHaveLength(1);
  }
});

test("protected model discovery is local-only, preserves capability secrecy, and fails closed without a cache", async () => {
  const home = mkdtempSync(join(tmpdir(), "web-only-models-"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  const cfg = config(); cfg.port = 0;
  let fetches = 0;
  const server = startServer(cfg, { fetchUpstream: async () => { fetches++; throw new Error("must not fetch"); } });
  try {
    const url = `http://127.0.0.1:${server.port}/web-only/v1/models`;
    const headers = { authorization: `Bearer ${token}` };
    expect((await fetch(url, { headers })).status).toBe(409);
    writeFileSync(join(home, "models_cache.json"), JSON.stringify({ models: [{
      slug: "gpt-5.6-sol", visibility: "list", priority: 1, supported_reasoning_levels: [], tool_mode: "code_mode_only",
    }] }));
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(token);
    const rows = (JSON.parse(text) as { models: { slug: string }[] }).models;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.slug.startsWith("chatgpt-web/"))).toBe(true);
    expect(fetches).toBe(0);
  } finally {
    await server.stop(true);
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

function hook(input: unknown, model = "chatgpt-web/high") {
  return webOnlySpawnHook({ hook_event_name: "PreToolUse", tool_name: "spawn_agent", model, tool_input: input }, config());
}
test("spawn hook preserves explicit Web choices and makes inherited Web selection explicit", () => {
  for (const input of [{ message: "task" }, { message: "task", fork_context: true }, { message: "task", model: "chatgpt-web/medium" }]) {
    expect(hook(input)).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow", updatedInput: {
      ...input, model: "model" in input ? input.model : "chatgpt-web/high",
    } } });
  }
  const cfg = config(); cfg.webOnlySubagents = { token, defaultModel: "chatgpt-web/medium" } as typeof cfg.webOnlySubagents;
  expect(webOnlySpawnHook({ hook_event_name: "PreToolUse", tool_name: "spawn_agent", model: "chatgpt-web/high", tool_input: { message: "task" } }, cfg))
    .toMatchObject({ hookSpecificOutput: { updatedInput: { model: "chatgpt-web/medium" } } });
});
test("spawn hook denies native overrides, invalid arguments, and roles that can replace the provider", () => {
  for (const input of [{ message: "task", model: "gpt-5.6-sol" }, { message: "task", model: "chatgpt-web/pro" }, {},
    { message: "" }, { message: "task", fork_context: true, agent_type: "worker" }, { message: "task", agent_type: "worker" }, null]) {
    expect(hook(input)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  }
});

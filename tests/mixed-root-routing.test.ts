import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { forwardNativeCodexRequest } from "../src/native-passthrough";

const rootId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const grandId = "33333333-3333-4333-8333-333333333333";
const turnId = "44444444-4444-4444-8444-444444444444";
const resumedTurnId = "55555555-5555-4555-8555-555555555555";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "mixed-root-policy-"));
  const sessions = join(home, "sessions", "2026", "09", "23");
  mkdirSync(sessions, { recursive: true });
  const path = (id: string, suffix = "11-00-00") => join(sessions, `rollout-2026-09-23T${suffix}-${id}.jsonl`);
  const record = (id: string, parent?: string, model = "chatgpt-web/high") => [
    { type: "session_meta", payload: parent ? {
      id, session_id: rootId, creator_user_id: "creator-user", creator_account_id: "creator-account",
      parent_thread_id: parent, agent_path: null, agent_nickname: "worker", agent_role: "default",
      thread_source: "subagent", multi_agent_version: "v1",
      source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: null, agent_nickname: "worker", agent_role: "default" } } },
    } : {
      id, session_id: id, creator_user_id: "creator-user", creator_account_id: "creator-account",
      source: "exec", thread_source: "user", multi_agent_version: "v1",
    } },
    { type: "turn_context", payload: { turn_id: turnId, model, multi_agent_version: "v1" } },
  ];
  const write = (id: string, parent?: string, model?: string) => writeFileSync(path(id), `${record(id, parent, model).map(value => JSON.stringify(value)).join("\n")}\n`);
  write(rootId, undefined, "gpt-5.6-sol");
  write(childId, rootId);
  write(grandId, childId);
  return { home, path, write };
}

function body(thread: string, model: string, parent?: string, turn = turnId) {
  return {
    model, stream: false, input: [{ role: "user", content: "proof" }],
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({
      thread_id: thread, turn_id: turn,
      ...(parent ? { parent_thread_id: parent, agent_name: "/root" } : {}),
    }) },
  };
}

test("mixed-root route authenticates canonical ancestry and rejects native descendants before forwarding", async () => {
  const f = fixture();
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = f.home;
  const config = defaultConfig("browser-only");
  config.port = 0;
  let forwarded = 0;
  let adapted = 0;
  const dependencies: NonNullable<Parameters<typeof startServer>[1]> = {
    fetchUpstream: async () => { forwarded++; return Response.json({ native: true }); },
    adapterFactory: () => ({ name: "deterministic", async runTurn(_parsed, _incoming, emit) {
      adapted++;
      emit({ type: "text_delta", text: "WEB_OK", phase: "final_answer" });
      emit({ type: "done", stopReason: "stop", endTurn: true });
    } }),
  };
  let server = startServer(config, dependencies);
  const send = (id: string, model: string, parent?: string, endpoint = "/v1/responses", turn = turnId, extraHeaders = {}) =>
    fetch(`http://127.0.0.1:${server.port}/mixed-root${endpoint}`, { method: "POST",
      headers: { authorization: "Bearer local-native-test", "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body(id, model, parent, turn)),
    });
  try {
    expect((await send(rootId, "gpt-5.6-sol")).status).toBe(200);
    expect(forwarded).toBe(1);
    for (const [id, parent] of [[childId, rootId], [grandId, childId]] as const) {
      expect((await send(id, "gpt-5.6-sol", parent)).status).toBe(400);
      expect((await send(id, "gpt-5.6-sol", parent, "/v1/responses/compact",
        turnId, { "x-codex-turn-metadata": JSON.stringify({ thread_id: id, turn_id: turnId, parent_thread_id: parent, agent_name: "/root" }) })).status).toBe(400);
    }
    expect(forwarded).toBe(1);
    expect(adapted).toBe(0);
    await expect(forwardNativeCodexRequest(new Request(`http://127.0.0.1:${server.port}/mixed-root/v1/responses`, {
      method: "POST", headers: { authorization: "Bearer local-native-test", "content-type": "application/json" },
      body: JSON.stringify(body(childId, "gpt-5.6-sol", rootId)),
    }), "responses", dependencies.fetchUpstream)).rejects.toThrow("verified Codex rollout lineage");
    expect(forwarded).toBe(1);
    expect((await send(childId, "chatgpt-web/high", rootId)).status).toBe(200);
    expect((await send(grandId, "chatgpt-web/high", childId)).status).toBe(200);
    expect(adapted).toBe(2);

    expect((await send(childId, "chatgpt-web/high", grandId)).status).toBe(400);
    rmSync(f.path(rootId));
    expect((await send(grandId, "chatgpt-web/high", childId)).status).toBe(400);
    f.write(rootId, undefined, "gpt-5.6-sol");
    writeFileSync(f.path(rootId, "12-00-00"), "{}\n");
    expect((await send(childId, "chatgpt-web/high", rootId)).status).toBe(400);
    rmSync(f.path(rootId, "12-00-00"));

    appendFileSync(f.path(childId), `${JSON.stringify({ type: "turn_context", payload: { turn_id: resumedTurnId, model: "gpt-5.6-sol" } })}\n`);
    expect((await send(childId, "gpt-5.6-sol", rootId, "/v1/responses", resumedTurnId)).status).toBe(400);
    expect(forwarded).toBe(1);
    await server.stop(true);
    server = startServer(config, dependencies);
    expect((await send(childId, "gpt-5.6-sol", rootId, "/v1/responses", resumedTurnId)).status).toBe(400);
    expect(forwarded).toBe(1);
    const ordinary = await fetch(`http://127.0.0.1:${server.port}/v1/responses`, {
      method: "POST", headers: { authorization: "Bearer local-native-test", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [{ role: "user", content: "ordinary" }] }),
    });
    expect(ordinary.status).toBe(200);
    expect(forwarded).toBe(2);
  } finally {
    await server.stop(true);
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    rmSync(f.home, { recursive: true, force: true });
  }
});

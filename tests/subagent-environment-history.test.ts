import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import { chatGptTurnUserRevisionHistory, extractChatGptTurnEnvironment, extractChatGptTurnUserRevision } from "../src/adapters/chatgpt-web/environment";
import { parseRequest } from "../src/responses/parser";
import type { CodexParsedRequest } from "../src/types";

const root = resolve(process.cwd());
const parentThreadId = "thread_parent";
const parentTurnId = "turn_parent";
const childThreadId = "thread_child";
const childTurnId = "turn_child";
const codexHome = resolve(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
const visualizationRoot = join(codexHome, "visualizations", "2026", "09", "07", parentThreadId);
const environment = `<environment_context>
  <cwd>${root}</cwd>
  <filesystem><workspace_roots><root>${root}</root><root>${visualizationRoot}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>`;
const item = (id: string, role: "developer" | "user", text: string, turnId: string) => ({
  type: "message",
  id,
  role,
  content: [{ type: "input_text", text }],
  internal_chat_message_metadata_passthrough: { turn_id: turnId },
});
const request = (
  threadId: string,
  turnId: string,
  input: Array<Record<string, unknown>>,
  parent?: string,
): CodexParsedRequest => ({
  modelId: "gpt-5.6-sol",
  stream: true,
  context: { messages: [], tools: [] },
  options: { reasoning: "high" },
  _rawBody: {
    client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({
        request_kind: "turn",
        thread_id: threadId,
        turn_id: turnId,
        ...(parent ? {
          parent_thread_id: parent,
          agent_name: "/root/reviewer",
          subagent_kind: "thread_spawn",
        } : {}),
        sandbox: "none",
        workspaces: { [root]: {} },
      }),
    },
    input,
  },
});

test("fork-context child accepts its inherited parent visualization root", () => {
  const parentInput = [
    item("msg_parent_environment", "user", environment, parentTurnId),
    item("msg_parent_prompt", "user", "Inspect the workspace.", parentTurnId),
  ];
  const store = new ChatGptThreadEnvironmentStore();
  const child = request(childThreadId, childTurnId, [
    ...parentInput,
    item("msg_child_developer", "developer", "Review only.", childTurnId),
    item("msg_child_prompt", "user", "Inspect the change.", childTurnId),
  ], parentThreadId);

  expect(store.resolve(child).cwd).toBe(root);
});

test("Compatibility V1 accepts only the canonical first-task retry after a High capacity failure", () => {
  const nativeParentThreadId = "11111111-1111-4111-8111-111111111111";
  const nativeChildThreadId = "22222222-2222-4222-8222-222222222222";
  const failedTurnId = "33333333-3333-4333-8333-333333333333";
  const retryTurnId = "44444444-4444-4444-8444-444444444444";
  const codexHome = mkdtempSync(join(tmpdir(), "codex-v1-subagent-restart-"));
  const rolloutDir = join(codexHome, "sessions", "2026", "09", "09");
  const rolloutPath = join(rolloutDir, `rollout-2026-09-09T10-40-57-${nativeChildThreadId}.jsonl`);
  const task = item("msg_child_task", "user", "Read package.json and return CHILD_OK <version>.", failedTurnId);
  (task.internal_chat_message_metadata_passthrough as Record<string, unknown>).content_item_kinds = ["user.text"];
  const currentEnvironment = item("msg_retry_environment", "user", environment, retryTurnId);
  (currentEnvironment.internal_chat_message_metadata_passthrough as Record<string, unknown>).content_item_kinds = ["environments.environment_context"];
  const records = (
    errorInfo = "server_overloaded",
    extraPreviousUser?: Record<string, unknown>,
    previousModel = "chatgpt-web/high",
    currentModel = "chatgpt-web/high",
  ) => [
    {
      type: "session_meta",
      payload: {
        id: nativeChildThreadId,
        parent_thread_id: nativeParentThreadId,
        source: { subagent: { thread_spawn: { parent_thread_id: nativeParentThreadId, depth: 1, agent_path: null } } },
        thread_source: "subagent",
        multi_agent_version: "v1",
      },
    },
    { type: "event_msg", payload: { type: "task_started", turn_id: failedTurnId } },
    { type: "turn_context", payload: { turn_id: failedTurnId, model: previousModel, multi_agent_version: "v1" } },
    { type: "response_item", payload: task },
    ...(extraPreviousUser ? [{ type: "response_item", payload: extraPreviousUser }] : []),
    {
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: failedTurnId,
        last_agent_message: null,
        error: { message: "Selected model is at capacity. Please try a different model.", codex_error_info: errorInfo },
      },
    },
    { type: "event_msg", payload: { type: "task_started", turn_id: retryTurnId } },
    { type: "response_item", payload: currentEnvironment },
    { type: "turn_context", payload: { turn_id: retryTurnId, model: currentModel, multi_agent_version: "v1" } },
  ];
  const parsed = request(nativeChildThreadId, retryTurnId, [task, currentEnvironment]);

  const writeRollout = (values: unknown[]) => {
    mkdirSync(rolloutDir, { recursive: true });
    writeFileSync(rolloutPath, `${values.map(value => JSON.stringify(value)).join("\n")}\n`);
  };

  try {
    writeRollout(records());
    expect(extractChatGptTurnUserRevision(parsed, { codexHome })).toEqual(task.content);

    writeRollout(records("other"));
    expect(() => extractChatGptTurnUserRevision(parsed, { codexHome }))
      .toThrow("conflicts with native Codex turn_id");

    writeRollout(records("server_overloaded", undefined, "chatgpt-web/medium"));
    expect(() => extractChatGptTurnUserRevision(parsed, { codexHome }))
      .toThrow("conflicts with native Codex turn_id");

    const stale = item("msg_stale", "user", "Old unrelated instruction.", failedTurnId);
    (stale.internal_chat_message_metadata_passthrough as Record<string, unknown>).content_item_kinds = ["user.text"];
    writeRollout(records("server_overloaded", stale));
    const staleParsed = request(nativeChildThreadId, retryTurnId, [task, stale, currentEnvironment]);
    expect(() => extractChatGptTurnUserRevision(staleParsed, { codexHome }))
      .toThrow("conflicts with native Codex turn_id");
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("V2 parent instructions bind the current environment without changing native message roles", () => {
  const environmentItem = { ...item("msg_environment", "user", environment, childTurnId) };
  delete (environmentItem as Record<string, unknown>).internal_chat_message_metadata_passthrough;
  const task = {
    type: "agent_message", id: "amsg_task", author: "/root", recipient: "/root/reviewer",
    content: [{ type: "input_text", text: "Inspect the workspace." }],
  };
  const raw = request(childThreadId, childTurnId, [environmentItem, task], parentThreadId)._rawBody as Record<string, unknown>;
  raw.model = "chatgpt-web/high";
  const parsed = parseRequest(raw);
  expect(extractChatGptTurnEnvironment(parsed).cwd).toBe(root);
  expect(extractChatGptTurnUserRevision(parsed)).toEqual(task.content);
  expect(parsed.context.messages.at(-1)?.role).toBe("agentMessage");
  expect(parsed._rawBody).toEqual(raw);

  // A reply from a nested child or a peer is context, not a superseding parent instruction.
  const reply = { ...task, id: "amsg_reply", author: "/root/reviewer/worker", content: [{ type: "input_text", text: "Done." }] };
  for (const author of [reply.author, "/root/peer"]) {
    const continued = parseRequest({ ...raw, input: [environmentItem, task, { ...reply, author }] });
    expect(extractChatGptTurnUserRevision(continued)).toEqual(task.content);
    expect(chatGptTurnUserRevisionHistory(continued).map(revision => revision.itemId)).toEqual([task.id]);
  }
  const followup = { ...task, id: "amsg_followup", content: [{ type: "input_text", text: "Review the second file." }] };
  const continued = parseRequest({ ...raw, input: [environmentItem, task, reply, followup] });
  expect(extractChatGptTurnUserRevision(continued)).toEqual(followup.content);
  expect(chatGptTurnUserRevisionHistory(continued).map(revision => revision.itemId)).toEqual([task.id, followup.id]);

  for (const invalid of [
    { ...task, id: undefined }, { ...task, author: "/root/peer" },
    { ...task, recipient: "/root/other" }, { ...task, author: "/root/reviewer/worker" },
  ]) {
    const rejected = parseRequest({ ...raw, input: [environmentItem, invalid] });
    expect(() => extractChatGptTurnEnvironment(rejected)).toThrow("missing cwd");
    expect(() => extractChatGptTurnUserRevision(rejected)).toThrow("current-turn user message");
  }
  const stale = parseRequest({ ...raw, input: [environmentItem, { ...task, internal_chat_message_metadata_passthrough: { turn_id: parentTurnId } }] });
  expect(() => extractChatGptTurnEnvironment(stale)).toThrow("missing cwd");
  expect(() => extractChatGptTurnUserRevision(stale)).toThrow("conflicts with native Codex turn_id");
  const metadata = JSON.parse((raw.client_metadata as Record<string, string>)["x-codex-turn-metadata"]!);
  for (const changes of [{ parent_thread_id: undefined }, { parent_thread_id: childThreadId }, { subagent_kind: undefined }, { agent_name: "/root" }]) {
    const rejected = parseRequest({ ...raw, client_metadata: { "x-codex-turn-metadata": JSON.stringify({ ...metadata, ...changes }) } });
    expect(() => extractChatGptTurnEnvironment(rejected)).toThrow("missing cwd");
    expect(() => extractChatGptTurnUserRevision(rejected)).toThrow("current-turn user message");
  }
  const restricted = parseRequest({ ...raw, client_metadata: { "x-codex-turn-metadata": JSON.stringify({ ...metadata, sandbox: "read-only" }) } });
  expect(() => extractChatGptTurnEnvironment(restricted)).toThrow("missing cwd");
});

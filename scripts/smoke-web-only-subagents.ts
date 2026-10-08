/** Real Codex tool execution against a local deterministic backend; no real model credentials. */
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { defaultConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";
import { bridgeToResponsesSSE } from "../src/bridge";
import type { AdapterEvent } from "../src/types";
import { webOnlyModelRejection } from "../src/web-only-subagents";
import { codexCommandHook } from "../src/codex-interrupt-hook";

const codex = resolve(process.argv[2] ?? "missing-codex-executable");
const bundled = spawnSync(codex, ["debug", "models", "--bundled"], { encoding: "utf8", timeout: 15_000 });
if (bundled.status !== 0) throw new Error(`Cannot read bundled models: ${bundled.stderr}`);
const root = mkdtempSync(join(tmpdir(), "web-only-policy-smoke-"));
const codexHome = join(root, "codex-home");
mkdirSync(codexHome);
const cfg = { ...defaultConfig("browser-only"), solAvailable: true, webOnlySubagents: { token: `cw-web-only-${randomBytes(32).toString("hex")}` } };
// Keep the native model in this mock catalog so only a working hook can deny its spawn.
writeFileSync(join(root, "models.json"), JSON.stringify(augmentNativeModelCatalog(JSON.parse(bundled.stdout), cfg)));
writeFileSync(join(root, "hook.ts"), [
  `import { appendFileSync } from "node:fs";`,
  `import { webOnlySpawnHook } from ${JSON.stringify(pathToFileURL(resolve("src/web-only-subagents.ts")).href)};`,
  `const input = await Bun.stdin.json();`,
  `appendFileSync(${JSON.stringify(join(root, "hook-events.jsonl"))}, JSON.stringify({event: input.hook_event_name, model: input.model, tool: input.tool_name}) + "\\n");`,
  `console.log(JSON.stringify(input.hook_event_name === "PreToolUse" ? webOnlySpawnHook(input, ${JSON.stringify(cfg)}) : {}));`,
].join("\n"));
const command = codexCommandHook([process.execPath, join(root, "hook.ts")]);
const matcher = "^(spawn_agent|Agent)$";
let step = 0;
let rootId: string | undefined;
let childId: string | undefined;
let childRequests = 0;
let rejectedNativeRequests = 0;
const failures: string[] = [];
const map = new Map(["spawn_agent", "wait_agent"].map(name => [name, { namespace: "multi_agent_v1", name }]));
async function* call(name: string, args: object): AsyncGenerator<AdapterEvent> {
  yield { type: "tool_call_start", id: `call_${crypto.randomUUID()}`, name };
  yield { type: "tool_call_delta", arguments: JSON.stringify(args) };
  yield { type: "tool_call_end" };
  yield { type: "done", stopReason: "tool_use", endTurn: false };
}
async function* final(text: string): AsyncGenerator<AdapterEvent> {
  yield { type: "text_delta", text, phase: "final_answer" };
  yield { type: "done", stopReason: "stop", endTurn: true };
}
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  if (new URL(req.url).pathname !== "/web-only/v1/responses") return new Response("not found", { status: 404 });
  const body = await req.json() as any;
  if (body.model !== "chatgpt-web/gpt-6-sol") {
    rejectedNativeRequests++;
    failures.push(`Native/unapproved execution attempted: ${body.model}`);
    return webOnlyModelRejection(req, cfg, body.model)!;
  }
  const id = body.client_metadata?.thread_id;
  rootId ??= id;
  let events: AsyncIterable<AdapterEvent>;
  if (id !== rootId) {
    childRequests++;
    events = final("PROTECTED_CHILD_OK");
  } else {
    const outputs = (body.input ?? []).filter((item: any) => item.type === "function_call_output");
    const latest = outputs.at(-1)?.output ?? "";
    if (step === 0) events = call("spawn_agent", { message: "native attempt", model: "gpt-6.1-sol" });
    else if (step === 1) {
      if (!latest.includes("Web-only subagents")) failures.push(`Native spawn was not denied by hook: ${latest}`);
      if (childRequests !== 0) failures.push("Child executed before policy denial");
      events = call("spawn_agent", { message: "return PROTECTED_CHILD_OK", fork_context: true });
    } else if (step === 2) {
      try { childId = JSON.parse(latest).agent_id; } catch {}
      if (!childId) failures.push(`Web spawn not confirmed: ${latest}`);
      events = childId ? call("wait_agent", { targets: [childId], timeout_ms: 1000 }) : final("FAILED");
    } else {
      if (!latest.includes("PROTECTED_CHILD_OK")) failures.push(`Child completion not confirmed: ${latest}`);
      events = final("WEB_ONLY_POLICY_SMOKE_OK");
    }
    step++;
  }
  return new Response(bridgeToResponsesSSE(events, "chatgpt-web/gpt-6-sol", map), { headers: { "content-type": "text/event-stream" } });
} });
const configPath = join(codexHome, "config.toml");
writeFileSync(configPath, [
  'model = "chatgpt-web/gpt-6-sol"', 'model_provider = "mock"',
  `model_catalog_json = ${JSON.stringify(join(root, "models.json"))}`,
  '[model_providers.mock]', 'name = "Local mock only"', `base_url = "http://127.0.0.1:${server.port}/web-only/v1"`,
  'env_key = "WEB_ONLY_MOCK_KEY"', 'wire_api = "responses"', 'supports_websockets = false',
  '[agents]', 'max_depth = 2', '[features]', 'multi_agent = true', 'multi_agent_v2 = false', 'hooks = true',
  '[[hooks.PreToolUse]]', `matcher = ${JSON.stringify(matcher)}`,
  '[[hooks.PreToolUse.hooks]]', 'type = "command"', `command = ${JSON.stringify(command)}`, 'timeout = 10',
].join("\n"));
try {
  // This isolated home contains only the hook written above; no user/plugin hook trust is changed.
  const child = Bun.spawn([codex, "--dangerously-bypass-hook-trust", "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "Run mock policy test"], {
    cwd: root, env: { ...process.env, CODEX_HOME: codexHome, WEB_ONLY_MOCK_KEY: cfg.webOnlySubagents.token,
    },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), 45_000);
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  clearTimeout(timeout);
  writeFileSync(join(root, "stdout.jsonl"), stdout);
  writeFileSync(join(root, "stderr.txt"), stderr);
  if (status !== 0 || !stdout.includes("WEB_ONLY_POLICY_SMOKE_OK")) failures.push(`Client exited ${status} or did not finish`);
  if (childRequests !== 1) failures.push(`Expected one Web child request, got ${childRequests}`);
  const files = readdirSync(join(codexHome, "sessions"), { recursive: true }).filter((p): p is string => typeof p === "string" && p.endsWith(".jsonl"));
  if (files.length !== 2) failures.push(`Expected root + one Web child rollout, got ${files.length}`);
  const sessions = files.map(file => {
    const records = readFileSync(join(codexHome, "sessions", file), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const settings = records.filter(row => row.payload?.type === "thread_settings_applied").map(row => row.payload.thread_settings?.model);
    const turnModels = records.filter(row => row.type === "turn_context").map(row => row.payload?.model);
    return { file, appliedModels: settings, turnModels, errors: records.filter(row => row.payload?.error).map(row => row.payload.error) };
  });
  writeFileSync(join(root, "acceptance.json"), JSON.stringify({
    creationTimePassed: failures.length === 0, rejectedNativeRequests, webChildRequests: childRequests,
    hookInvoked: existsSync(join(root, "hook-events.jsonl")), sessions, failures,
  }, null, 2));
  if (failures.length) throw new Error(`${failures.join("; ")}\nEvidence: ${root}\n${stderr.slice(-3000)}`);
  console.log(`WEB_ONLY_POLICY_SMOKE_OK: native spawn denied before creation; inherited full-history Web child completed. Evidence: ${root}`);
} finally { await server.stop(true); }

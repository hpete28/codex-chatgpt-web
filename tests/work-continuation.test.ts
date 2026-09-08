import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker, callTurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { parseWorkState } from "../src/adapters/chatgpt-web/work-state";

const brokers: TurnBroker[] = [];
afterEach(async () => { await Promise.all(brokers.splice(0).map(broker => broker.close())); });

async function setup(enabled = true) {
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(join(tmpdir(), `cgw-work-${randomUUID()}`)));
  brokers.push(broker);
  const token = await broker.register({ cwd: tmpdir(), roots: [tmpdir()], writableRoots: [tmpdir()],
    sandboxPolicy: { type: "dangerFullAccess" }, tools: [] });
  if (enabled) broker.enableWorkContinuation(token);
  const claim = (browserToken = token) => callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath,
    { method: "claim", token: browserToken });
  const settle = (activityId: string, browserToken = token) => callTurnBroker(broker.socketPath,
    { method: "activity_complete", token: browserToken, activityId });
  const record = async (status = "continue", progress = "Implementation finished; required tests still pending", browserToken = token) => {
    const claimed = await claim(browserToken);
    try {
      await callTurnBroker(broker.socketPath, { method: "work_state", bindingId: claimed.bindingId,
        arguments: { status, remaining: status === "complete" ? "" : "Run required checks", progress } });
    } finally { await settle(claimed.activityId, browserToken); }
    return claimed.bindingId;
  };
  const finish = () => {
    const revision = broker.beginCompletionFence(token);
    expect(revision).toBeNumber();
    expect(broker.commitCompletionFence(token, revision!)).toBeTrue();
    return revision!;
  };
  return { broker, token, claim, settle, record, finish };
}

test.each(["complete", "blocked", "missing"])("%s work state does not authorize a second message", async status => {
  const f = await setup();
  if (status !== "missing") await f.record(status);
  f.finish();
  expect(f.broker.continueCompletedTurn(f.token)).toBeUndefined();
});

test("continuation requires settled effects and a committed fence", async () => {
  const f = await setup();
  await f.record();
  expect(() => f.broker.continueCompletedTurn(f.token)).toThrow("committed");
  const claim = await f.claim();
  await expect(f.record("complete")).rejects.toThrow("all other tool results");
  const invocation = callTurnBroker<BrokerToolResult>(f.broker.socketPath,
    { method: "invoke", bindingId: claim.bindingId, wireName: "exec_command", arguments: { cmd: "test" } });
  const calls = await f.broker.nextToolBatch(f.token);
  await f.settle(claim.activityId);
  expect(f.broker.beginCompletionFence(f.token)).toBeUndefined();
  expect(() => f.broker.continueCompletedTurn(f.token)).toThrow("committed");
  f.broker.completeTool(f.token, calls[0]!.callId, { content: [] });
  await invocation;
  f.finish();
  expect(f.broker.continueCompletedTurn(f.token)?.turnToken).not.toBe(f.token);
});

test("rotation preserves the native owner waiter and permanently retires old Web capabilities", async () => {
  const f = await setup();
  const oldBinding = await f.record();
  const oldRevision = f.finish();
  const next = f.broker.continueCompletedTurn(f.token)!;
  expect(f.broker.commitCompletionFence(f.token, oldRevision)).toBeFalse();
  await expect(f.claim()).rejects.toThrow("already finished");
  await expect(callTurnBroker(f.broker.socketPath, { method: "invoke", bindingId: oldBinding, wireName: "exec_command" }))
    .rejects.toThrow("already finished");
  const waiting = f.broker.nextToolBatch(f.token);
  const claim = await f.claim(next.turnToken);
  expect(claim.bindingId).not.toBe(oldBinding);
  const invoked = callTurnBroker<BrokerToolResult>(f.broker.socketPath,
    { method: "invoke", bindingId: claim.bindingId, wireName: "exec_command", arguments: { cmd: "next check" } });
  const calls = await waiting;
  expect(calls[0]?.arguments?.cmd).toBe("next check");
  f.broker.completeTool(f.token, calls[0]!.callId, { content: [{ type: "text", text: "canonical result" }] });
  expect((await invoked).content).toEqual([{ type: "text", text: "canonical result" }]);
  await f.settle(claim.activityId, next.turnToken);
  f.finish();
  // A consumed state cannot accidentally authorize another Web message.
  expect(f.broker.continueCompletedTurn(f.token)).toBeUndefined();
});

test("a delayed old activity cleanup cannot mutate the new epoch", async () => {
  const f = await setup();
  await f.record();
  f.finish();
  f.broker.continueCompletedTurn(f.token);
  const revision = f.broker.beginCompletionFence(f.token);
  await f.settle("activity_delayed_cleanup_000001");
  expect(f.broker.beginCompletionFence(f.token)).toBe(revision);
});

test("compaction takes priority over recorded remaining work", async () => {
  const f = await setup();
  await f.record();
  f.broker.requestCompaction(f.token, { content: [] });
  f.finish();
  expect(f.broker.continueCompletedTurn(f.token)).toBeUndefined();
});

test.each(["owner", "browser"])("revoking the %s capability cancels the continuation owner", async target => {
  const f = await setup();
  await f.record();
  f.finish();
  const next = f.broker.continueCompletedTurn(f.token)!;
  const retirement = f.broker.waitForRetirement(f.token);
  f.broker.revoke(target === "owner" ? f.token : next.turnToken);
  await retirement;
  await expect(f.claim(next.turnToken)).rejects.toThrow("already finished");
  expect(() => f.broker.continueCompletedTurn(f.token)).toThrow("retired");
});

test("unchanged progress fails closed", async () => {
  const f = await setup();
  await f.record();
  f.finish();
  const next = f.broker.continueCompletedTurn(f.token)!;
  await f.record("continue", undefined, next.turnToken);
  f.finish();
  expect(() => f.broker.continueCompletedTurn(f.token)).toThrow("no new recorded progress");
});

test("fresh evidence authorizes multiple boundaries without a duration timer", async () => {
  const f = await setup();
  let current = f.token;
  for (let milestone = 1; milestone <= 3; milestone += 1) {
    await f.record("continue", `Verified milestone ${milestone}`, current);
    f.finish();
    const next = f.broker.continueCompletedTurn(f.token)!;
    expect(next.turnToken).not.toBe(current);
    current = next.turnToken;
  }
  await f.record("complete", "All required checks passed", current);
  f.finish();
  expect(f.broker.continueCompletedTurn(f.token)).toBeUndefined();
});

test("unsupported owners cannot opt themselves into automatic work", async () => {
  const f = await setup(false);
  await expect(f.record()).rejects.toThrow("not enabled");
});

test.each([{}, { status: "maybe", remaining: "x", progress: "x" },
  { status: ["continue"], remaining: "x", progress: "x" },
  { status: "continue", remaining: "", progress: "x" },
  { status: "complete", remaining: "unfinished", progress: "x" },
  { status: "continue", remaining: "x", progress: "" },
  { status: "continue", remaining: "x", progress: "x", replay: true },
])("malformed work state never authorizes continuation: %j", state => {
  expect(() => parseWorkState(state)).toThrow();
});

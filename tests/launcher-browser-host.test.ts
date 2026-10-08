import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAUNCHER_BROWSER_HOST_KIND,
  LAUNCHER_BROWSER_IDLE_URL,
  LauncherManualTurnTimedOutError,
  LauncherRetainedConversationUnavailableError,
  LauncherBrowserTurnCancelledError,
  endLauncherManualTurn,
  inspectLauncherBrowserHost,
  inspectLauncherBrowserHostLiveness,
  notifyLauncherTurn,
  markLauncherManualTurnStarted,
  readLauncherBrowserHostDescriptor,
  releaseLauncherRetainedConversation,
  selectLauncherPage,
  startLauncherManualTurn,
  waitForLauncherManualSent,
  waitForLauncherManualTerminal,
} from "../src/launcher-browser-host";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

// The actual launcher control host uses Node HTTP. Keep cancellation fixtures
// on that transport too: Bun 1.4.0 on Windows corrupts Node HTTP after an
// aborted fetch to an in-process Bun.serve handler.
async function controlFixture(fetch: (req: Request) => Response | Promise<Response>) {
  const pending = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    const handling = (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await fetch(new Request(`http://127.0.0.1${request.url}`, {
        method: "POST", body: Buffer.concat(chunks),
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    })();
    pending.add(handling);
    void handling.catch(() => response.destroy()).finally(() => pending.delete(handling));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    async stop() {
      await Promise.allSettled(pending);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

const roots: string[] = [];

test("launcher activity follows actual send callbacks and current-turn tool counts", async () => {
  const messages: Array<{ phase: string; progress?: { stage: string; activeToolCalls: number } }> = [];
  const server = await controlFixture(async request => {
    const message = await request.json() as typeof messages[number];
    messages.push(message);
    return Response.json(message.phase === "start"
      ? { surfaceId: "a".repeat(32), reused: false, connectorBound: false }
      : { cancelledByUser: false });
  });
  const waitForStage = async (stage: string) => {
    const deadline = Date.now() + 1_000;
    while (!messages.some(message => message.progress?.stage === stage) && Date.now() < deadline) await Bun.sleep(5);
    expect(messages.some(message => message.progress?.stage === stage)).toBeTrue();
  };
  let activeToolCalls = 0;
  let activated = 0;
  let submitted = 0;
  try {
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      config: { browserHost: "launcher", browserHostDescriptorPath: descriptorFile(`http://127.0.0.1:${server.port}`) },
      runBrowserTurn: async (turn: { onSendActivated(): Promise<void>; onSubmitted(): Promise<void> }) => {
        await waitForStage("preparing");
        await turn.onSendActivated();
        await waitForStage("sending");
        activeToolCalls = 2;
        await turn.onSubmitted();
        await waitForStage("chatgpt");
        return "done";
      },
    });
    await expect(worker.runExclusive({
      traceId: "activity-fixture", capabilities: { localToolsEnabled: true },
      externalProgress: { snapshot: () => ({ activeToolCalls }) },
      onSendActivated: () => { activated++; }, onSubmitted: () => { submitted++; },
    })).resolves.toBe("done");
    expect(messages.filter(message => message.progress).map(message => message.progress)).toEqual([
      { stage: "preparing", activeToolCalls: 0 }, { stage: "sending", activeToolCalls: 0 },
      { stage: "chatgpt", activeToolCalls: 2 },
    ]);
    expect(messages.at(-1)?.phase).toBe("end");
    expect([activated, submitted]).toEqual([1, 1]);
  } finally { await server.stop(); }
});

test("a blocked sign-in replaces an opaque navigation abort with a non-retryable session error", async () => {
  let needsSignIn: unknown = true;
  const server = await controlFixture(async req => {
    const activity = await req.json() as { phase: string };
    return Response.json(activity.phase === "start"
      ? { surfaceId: "a".repeat(32), reused: false, connectorBound: false }
      : { cancelledByUser: false, authenticationRequired: needsSignIn });
  });
  try {
    const descriptor = descriptorFile(`http://127.0.0.1:${server.port}`);
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      config: { browserHost: "launcher", browserHostDescriptorPath: descriptor },
      runBrowserTurn: async () => { throw new Error("page.goto: net::ERR_ABORTED"); },
    });
    const turn = { traceId: "auth-redirect", capabilities: { localToolsEnabled: false } };
    await expect(worker.runExclusive(turn)).rejects.toMatchObject({
      status: 401, code: "chatgpt_sign_in_required", retryable: false,
    });
    needsSignIn = false;
    await expect(worker.runExclusive(turn)).rejects.toThrow("page.goto: net::ERR_ABORTED");
    needsSignIn = "true";
    await expect(notifyLauncherTurn(descriptor, { phase: "end", traceId: "auth-redirect", helperPid: process.pid, status: "failed" }))
      .rejects.toThrow("invalid authentication state");
  } finally { await server.stop(); }
});

test("startup waits beyond five seconds and distinguishes its deadline from caller cancellation", async () => {
  let calls = 0;
  const pendingHandlers = new Set<Promise<void>>();
  let thirdStarted!: () => void;
  const thirdRequest = new Promise<void>(resolve => { thirdStarted = resolve; });
  const server = await controlFixture(async () => {
    calls++;
    if (calls === 3) thirdStarted();
    const delay = Bun.sleep(calls === 1 ? 5_100 : 250);
    pendingHandlers.add(delay);
    await delay;
    pendingHandlers.delete(delay);
    return Response.json({ surfaceId: "a".repeat(32), reused: false, connectorBound: false });
  });
  try {
    const descriptor = descriptorFile(`http://127.0.0.1:${server.port}`);
    const activity = { phase: "start" as const, traceId: "bounded-start", helperPid: process.pid };
    await expect(notifyLauncherTurn(descriptor, activity)).resolves.toMatchObject({ reused: false });
    await expect(notifyLauncherTurn(descriptor, activity, 50)).rejects.toThrow("start timed out after 50ms");
    const controller = new AbortController();
    const pending = notifyLauncherTurn(descriptor, activity, undefined, controller.signal);
    await thirdRequest;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(3);
  } finally {
    // Cancelled clients do not cancel the fixture's handler. Drain it before
    // stopping Bun's server; destroying it during the delay corrupts subsequent
    // node:http handling in Bun 1.4.0 on Windows.
    await Promise.all(pendingHandlers);
    await server.stop();
  }
}, 10_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function descriptorFile(
  controlEndpoint = "http://127.0.0.1:39111",
  profile: "production" | "development" = "production",
  endpoint = "http://127.0.0.1:39110",
): string {
  const root = mkdtempSync(join(tmpdir(), "codex-launcher-descriptor-"));
  roots.push(root);
  const path = join(root, "launcher-browser.json");
  writeFileSync(path, `${JSON.stringify({
    version: 3,
    kind: LAUNCHER_BROWSER_HOST_KIND,
    profile,
    pid: process.pid,
    endpoint,
    control: {
      endpoint: controlEndpoint,
      token: "launcher-control-token-0123456789abcdefghijklmnop",
    },
    helper: {
      executable: process.execPath,
      script: import.meta.path,
    },
    partition: profile === "development"
      ? "persist:codex-web-gpt-dev-chatgpt"
      : "persist:codex-web-gpt-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL,
    surfaceId: "launcher_surface_id_0123456789AB",
    surfaceTargets: { ["launcher_surface_id_0123456789AB"]: "native-owned-target" },
    createdAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  return path;
}

test("launcher descriptor is owner-only, loopback-only, and process-bound", () => {
  const path = descriptorFile();
  expect(readLauncherBrowserHostDescriptor(path)).toMatchObject({
    kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: "production",
    pid: process.pid,
    endpoint: "http://127.0.0.1:39110",
    surfaceId: "launcher_surface_id_0123456789AB",
  });
  if (process.platform !== "win32") {
    chmodSync(path, 0o644);
    expect(() => readLauncherBrowserHostDescriptor(path)).toThrow("unsafe permissions");
  }
});

test("launcher turn control sends authenticated lifecycle events", async () => {
  let received: { authorization?: string; body?: unknown } = {};
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received = {
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(request.url === "/v1/turn/start"
      ? '{"ok":true,"surfaceId":"launcher_surface_id_0123456789AB","reused":true,"connectorBound":true}\n'
      : request.url === "/v1/turn/end"
        ? '{"ok":true,"cancelledByUser":false}\n'
        : '{"ok":true}\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    await expect(notifyLauncherTurn(path, {
      phase: "start",
      traceId: "abc123def456",
      helperPid: process.pid,
      conversationKey: "a".repeat(64),
      connectorIdentity: "Codex Native2",
      requireRetainedConversation: true,
    })).resolves.toEqual({
      surfaceId: "launcher_surface_id_0123456789AB",
      reused: true,
      connectorBound: true,
      trackUsage: false,
    });
    expect(received.authorization).toBe("Bearer launcher-control-token-0123456789abcdefghijklmnop");
    expect(received.body).toEqual({
      phase: "start",
      traceId: "abc123def456",
      helperPid: process.pid,
      conversationKey: "a".repeat(64),
      connectorIdentity: "Codex Native2",
      requireRetainedConversation: true,
    });
    await notifyLauncherTurn(path, {
      phase: "heartbeat",
      traceId: "abc123def456",
      helperPid: process.pid,
      refreshViewport: true,
    });
    expect(received.body).toEqual({
      phase: "heartbeat",
      traceId: "abc123def456",
      helperPid: process.pid,
      refreshViewport: true,
    });
    await expect(notifyLauncherTurn(path, {
      phase: "end",
      traceId: "abc123def456",
      helperPid: process.pid,
      status: "completed",
      retain: true,
      connectorBound: true,
    })).resolves.toEqual({ cancelledByUser: false });
    expect(received.body).toEqual({
      phase: "end",
      traceId: "abc123def456",
      helperPid: process.pid,
      status: "completed",
      retain: true,
      connectorBound: true,
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("launcher turn control retries a transient start transport failure", async () => {
  let attempts = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain request */ }
    attempts += 1;
    if (attempts === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true,"surfaceId":"launcher_surface_id_0123456789AB","reused":false,"connectorBound":false}\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    await expect(notifyLauncherTurn(path, {
      phase: "start",
      traceId: "retry123456",
      helperPid: process.pid,
    }, 1_000)).resolves.toEqual({
      surfaceId: "launcher_surface_id_0123456789AB",
      reused: false,
      connectorBound: false,
      trackUsage: false,
    });
    expect(attempts).toBe(2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("launcher retained-conversation release uses its authenticated exact-key endpoint", async () => {
  let received: { url?: string; authorization?: string; body?: unknown } = {};
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received = {
      url: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true,"released":1}\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    await expect(releaseLauncherRetainedConversation(path, "b".repeat(64))).resolves.toBe(1);
    expect(received).toEqual({
      url: "/v1/turn/release",
      authorization: "Bearer launcher-control-token-0123456789abcdefghijklmnop",
      body: { conversationKey: "b".repeat(64) },
    });
    await expect(releaseLauncherRetainedConversation(path, "not-a-key"))
      .rejects.toThrow("retained conversation key is invalid");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("launcher turn control preserves explicit user cancellation as a terminal signal", async () => {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain request */ }
    response.writeHead(409, { "content-type": "application/json" });
    response.end('{"error":"turn closed by user","code":"turn_cancelled"}\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    const error = await notifyLauncherTurn(path, {
      phase: "start",
      traceId: "cancelled123",
      helperPid: process.pid,
    }).catch(cause => cause);
    expect(error).toBeInstanceOf(LauncherBrowserTurnCancelledError);
    expect((error as Error).message).toBe("turn closed by user");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("launcher turn control preserves a missing retained conversation as a typed signal", async () => {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain request */ }
    response.writeHead(409, { "content-type": "application/json" });
    response.end('{"error":"retained source missing","code":"retained_conversation_unavailable"}\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    const error = await notifyLauncherTurn(path, {
      phase: "start",
      traceId: "missing123456",
      helperPid: process.pid,
      conversationKey: "a".repeat(64),
      requireRetainedConversation: true,
    }).catch(caught => caught);
    expect(error).toBeInstanceOf(LauncherRetainedConversationUnavailableError);
    expect(error.message).toContain("retained source missing");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("launcher session verification uses the authenticated control channel instead of Bun CDP", async () => {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    expect(request.url).toBe("/v1/session/inspect");
    expect(request.headers.authorization).toBe("Bearer launcher-control-token-0123456789abcdefghijklmnop");
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({ detectCapabilities: true });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      authenticated: true,
      temporary: true,
      solAvailable: true,
      extraHighAvailable: true, proAvailable: true,
      url: "https://chatgpt.com/?temporary-chat=true",
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    expect(await inspectLauncherBrowserHost(path, { detectCapabilities: true })).toEqual({
      solAvailable: true,
      extraHighAvailable: true, proAvailable: true,
      url: "https://chatgpt.com/?temporary-chat=true",
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("launcher liveness verification checks only owned process and loopback CDP metadata", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    expect(request.url).toBe("/json/version");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      webSocketDebuggerUrl: "ws://127.0.0.1:39120/devtools/browser/test",
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(
      "http://127.0.0.1:39111",
      "development",
      `http://127.0.0.1:${address.port}`,
    );
    await expect(inspectLauncherBrowserHostLiveness(path, {
      expectedProfile: "development",
    })).resolves.toMatchObject({
      profile: "development",
      endpoint: `http://127.0.0.1:${address.port}`,
    });
    expect(requests).toBe(1);
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

test("launcher session verification reports its own deadline instead of a generic abort", async () => {
  const server = createServer(async (request, response) => {
    try {
      for await (const _chunk of request) { /* consume request */ }
    } catch {
      // The five-millisecond deadline may abort before the request body arrives.
      response.destroy();
      return;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 30));
    if (!response.destroyed) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"late"}\n');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    await expect(inspectLauncherBrowserHost(path, { detectCapabilities: true, timeoutMs: 5 }))
      .rejects.toThrow("session inspection timed out after 5ms");
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

test("launcher descriptor rejects non-loopback browser ownership", () => {
  const path = descriptorFile();
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.endpoint = "https://example.com:443";
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  expect(() => readLauncherBrowserHostDescriptor(path)).toThrow("http://127.0.0.1");
});

test("launcher profile checks reject cross-profile browser ownership", async () => {
  const path = descriptorFile("http://127.0.0.1:39111", "development");
  expect(readLauncherBrowserHostDescriptor(path)).toMatchObject({
    profile: "development",
    partition: "persist:codex-web-gpt-dev-chatgpt",
  });
  await expect(inspectLauncherBrowserHost(path, { expectedProfile: "production", timeoutMs: 5 }))
    .rejects.toThrow("belongs to development");
});

function nativeTargetContext(pages: Page[], targetId: (page: Page) => string): BrowserContext {
  return {
    pages: () => pages,
    newCDPSession: async (page: Page) => ({
      send: async (method: string) => {
        expect(method).toBe("Target.getTargetInfo");
        return { targetInfo: { targetId: targetId(page) } };
      },
      detach: async () => {},
    }),
  } as unknown as BrowserContext;
}

test("launcher page selection uses native ownership without evaluating unrelated renderers", async () => {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorFile());
  const hiddenPage = {
    url: () => "https://chatgpt.com/?temporary-chat=true",
    evaluate: () => { throw new Error("Do not evaluate an unrelated renderer"); },
  } as unknown as Page;
  const ownedPage = {
    url: () => LAUNCHER_BROWSER_IDLE_URL,
    evaluate: () => { throw new Error("Ownership comes from the native target"); },
  } as unknown as Page;
  const context = nativeTargetContext([hiddenPage, ownedPage],
    page => page === ownedPage ? "native-owned-target" : "native-other-target");
  const browser = {
    contexts: () => [context],
  } as unknown as Browser;

  expect(await selectLauncherPage(browser, descriptor, 20)).toEqual({
    context,
    page: ownedPage,
  });
});

test("launcher page selection does not wait for unrelated stalled target probes or detach", async () => {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorFile());
  const stalledPage = {} as unknown as Page;
  const ownedPage = {} as unknown as Page;
  const context = {
    pages: () => [stalledPage, ownedPage],
    newCDPSession: async (page: Page) => {
      if (page === stalledPage) return await new Promise<never>(() => {});
      return {
        send: async (method: string) => {
          expect(method).toBe("Target.getTargetInfo");
          return { targetInfo: { targetId: "native-owned-target" } };
        },
        detach: async () => await new Promise<never>(() => {}),
      };
    },
  } as unknown as BrowserContext;
  const browser = {
    contexts: () => [context],
  } as unknown as Browser;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const selected = await Promise.race([
      selectLauncherPage(browser, descriptor, 1_000),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("owned launcher page selection was blocked by an unrelated target")), 400);
      }),
    ]);
    expect(selected).toEqual({ context, page: ownedPage });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

test("launcher page selection rejects duplicated native target ownership", async () => {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorFile());
  const page = () => ({
    evaluate: async () => descriptor.surfaceId,
  }) as unknown as Page;
  const context = nativeTargetContext([page(), page()], () => "native-owned-target");
  const browser = {
    contexts: () => [context],
  } as unknown as Browser;

  expect(selectLauncherPage(browser, descriptor, 20)).rejects.toThrow(
    "2 surfaces with the same ownership id",
  );
});

test("launcher descriptor rejects ambiguous native targets and selection rejects retired surfaces", async () => {
  const path = descriptorFile();
  const descriptor = readLauncherBrowserHostDescriptor(path);
  const duplicate = { ...descriptor, surfaceTargets: {
    ...descriptor.surfaceTargets, ["x".repeat(32)]: "native-owned-target",
  } };
  writeFileSync(path, JSON.stringify(duplicate), { mode: 0o600 });
  expect(() => readLauncherBrowserHostDescriptor(path)).toThrow("duplicated surface targets");
  const browser = { contexts: () => [] } as unknown as Browser;
  await expect(selectLauncherPage(browser, descriptor, 20, "retired".repeat(5))).rejects.toThrow("no longer registered");
  writeFileSync(path, JSON.stringify({ ...descriptor, version: 2 }), { mode: 0o600 });
  expect(() => readLauncherBrowserHostDescriptor(path)).toThrow("restart the updated launcher");
});

test("launcher page selection stops immediately when acquisition is aborted", async () => {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorFile());
  const browser = {
    contexts: () => [],
  } as unknown as Browser;
  const controller = new AbortController();
  controller.abort();

  expect(selectLauncherPage(
    browser,
    descriptor,
    60_000,
    descriptor.surfaceId,
    controller.signal,
  )).rejects.toMatchObject({ name: "AbortError" });
});

test("manual launcher control separates idempotent start from reconnectable Sent observation", async () => {
  const requests: Array<{ url: string | undefined; body: unknown }> = [];
  let sentPolls = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: request.url, body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/manual/start") {
      response.end(JSON.stringify({
        ok: true,
        tabId: "manual-tab",
        reused: false,
        deadlineAt: "2026-08-30T00:01:00.000Z",
        state: "awaiting-user",
      }));
      return;
    }
    if (request.url === "/v1/manual/wait-sent" && sentPolls++ === 0) {
      response.statusCode = 202;
      response.end('{"ok":true,"status":"pending"}');
      return;
    }
    if (request.url === "/v1/manual/wait-sent") {
      response.end('{"ok":true,"status":"sent","sentAt":"2026-08-30T00:00:30.000Z"}');
      return;
    }
    if (request.url === "/v1/manual/started") {
      response.end('{"ok":true}');
      return;
    }
    if (request.url === "/v1/manual/wait-terminal") {
      response.end('{"ok":true,"status":"cancelled"}');
      return;
    }
    response.end('{"ok":true,"cancelledByUser":false}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    const owner = { traceId: "manual123456", helperPid: process.pid };
    await expect(startLauncherManualTurn(path, {
      ...owner,
      prompt: "private prompt",
      compaction: true,
    })).resolves.toMatchObject({
      tabId: "manual-tab",
      reused: false,
      state: "awaiting-user",
    });
    await expect(waitForLauncherManualSent(path, owner)).resolves.toEqual({
      sentAt: "2026-08-30T00:00:30.000Z",
    });
    await expect(markLauncherManualTurnStarted(path, owner)).resolves.toBeUndefined();
    await expect(waitForLauncherManualTerminal(path, owner)).resolves.toEqual({ status: "cancelled" });
    await expect(endLauncherManualTurn(path, { ...owner, status: "completed", retain: true }))
      .resolves.toEqual({ cancelledByUser: false });
    expect(requests.map(request => request.url)).toEqual([
      "/v1/manual/start",
      "/v1/manual/wait-sent",
      "/v1/manual/wait-sent",
      "/v1/manual/started",
      "/v1/manual/wait-terminal",
      "/v1/manual/end",
    ]);
    expect(requests[0]?.body).toEqual({ ...owner, prompt: "private prompt", compaction: true });
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

test("manual launcher mutations reconcile one lost local response with the same turn owner", async () => {
  const attempts = new Map<string, number>();
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    const url = request.url ?? "";
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    if (attempt === 1) {
      response.destroy();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (url === "/v1/manual/start") {
      response.end(JSON.stringify({
        ok: true,
        tabId: "manual-tab",
        reused: true,
        deadlineAt: "2026-08-30T00:01:00.000Z",
        state: "awaiting-user",
      }));
      return;
    }
    if (url === "/v1/manual/started") {
      response.end('{"ok":true}');
      return;
    }
    response.end('{"ok":true,"cancelledByUser":false}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const path = descriptorFile(`http://127.0.0.1:${address.port}`);
    const owner = { traceId: "manual_reconcile", helperPid: process.pid };
    await expect(startLauncherManualTurn(path, { ...owner, prompt: "private prompt" }, 500))
      .resolves.toMatchObject({ tabId: "manual-tab", reused: true });
    await expect(markLauncherManualTurnStarted(path, owner, 500)).resolves.toBeUndefined();
    await expect(endLauncherManualTurn(path, { ...owner, status: "completed" }, 500))
      .resolves.toEqual({ cancelledByUser: false });
    expect(Object.fromEntries(attempts)).toEqual({
      "/v1/manual/start": 2,
      "/v1/manual/started": 2,
      "/v1/manual/end": 2,
    });
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

test("manual Sent wait preserves typed timeout and cancellation signals", async () => {
  for (const reply of [
    { status: 408, body: { error: "too slow", code: "manual_turn_timed_out" } },
    { status: 409, body: { error: "closed", code: "turn_cancelled" } },
  ]) {
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* drain */ }
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server has no port");
      const path = descriptorFile(`http://127.0.0.1:${address.port}`);
      const error = await waitForLauncherManualSent(path, {
        traceId: "manual123456",
        helperPid: process.pid,
      }).catch(caught => caught);
      expect(error).toBeInstanceOf(reply.status === 408
        ? LauncherManualTurnTimedOutError
        : LauncherBrowserTurnCancelledError);
    } finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    }
  }
});

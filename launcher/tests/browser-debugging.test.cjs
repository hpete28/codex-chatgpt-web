const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  allocateLoopbackPort,
  configureBrowserDebugging,
  configurePrimaryInstance,
  waitForBrowserDebugging,
} = require("../electron/browser-debugging.cjs");

function fixture() {
  const switches = [];
  const app = { isReady: () => false, commandLine: { appendSwitch: (...args) => switches.push(args) } };
  return { switches, app };
}

test("allocate a non-zero loopback port synchronously through a child runtime", () => {
  let call = null;
  const port = allocateLoopbackPort({
    executable: "electron-test",
    environment: { TEST_ENV: "1" },
    run: (executable, args, options) => {
      call = { executable, args, options };
      return { status: 0, stdout: "54321\n", stderr: "" };
    },
  });
  assert.equal(port, 54321);
  assert.equal(call.executable, "electron-test");
  assert.deepEqual(call.args.slice(0, 1), ["-e"]);
  assert.match(call.args[1], /127\.0\.0\.1/);
  assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(call.options.env.TEST_ENV, "1");
  assert.equal(call.options.windowsHide, true);
});

test("reject invalid or failed port-helper results", () => {
  assert.throws(
    () => allocateLoopbackPort({ run: () => ({ status: 1, stdout: "", stderr: "bind failed" }) }),
    /bind failed/,
  );
  assert.throws(
    () => allocateLoopbackPort({ run: () => ({ status: 0, stdout: "0", stderr: "" }) }),
    /invalid port/,
  );
  assert.throws(
    () => allocateLoopbackPort({ run: () => ({ status: 0, stdout: "not-a-port", stderr: "" }) }),
    /invalid port/,
  );
});

test("configure Chromium synchronously with an explicit non-zero debugging port", () => {
  const f = fixture();
  const binding = configureBrowserDebugging(f.app, "unused", {
    run: () => ({ status: 0, stdout: "45678\n", stderr: "" }),
  });
  assert.deepEqual(binding, { port: 45678 });
  assert.deepEqual(f.switches, [
    ["remote-debugging-address", "127.0.0.1"],
    ["remote-debugging-port", "45678"],
  ]);
  assert.throws(
    () => configureBrowserDebugging({ isReady: () => true }, "unused", { port: 45678 }),
    /before Electron/,
  );
});

test("a duplicate launcher does not start the browser port helper", () => {
  const f = fixture();
  f.app.requestSingleInstanceLock = () => false;
  const result = configurePrimaryInstance(f.app, "unused", {
    run: () => { throw new Error("secondary instance must not spawn a helper"); },
  });
  assert.deepEqual(result, { isPrimaryInstance: false, browserDebugging: null });
  assert.deepEqual(f.switches, []);
});

test("the primary launcher locks the instance before allocating a debugging port", () => {
  const f = fixture();
  const calls = [];
  f.app.requestSingleInstanceLock = () => { calls.push("instance-lock"); return true; };
  const result = configurePrimaryInstance(f.app, "unused", {
    run: () => { calls.push("port-helper"); return { status: 0, stdout: "45678", stderr: "" }; },
  });
  assert.deepEqual(calls, ["instance-lock", "port-helper"]);
  assert.deepEqual(result, { isPrimaryInstance: true, browserDebugging: { port: 45678 } });
  assert.deepEqual(f.switches, [
    ["remote-debugging-address", "127.0.0.1"],
    ["remote-debugging-port", "45678"],
  ]);
});

test("verify only the expected explicit debugging endpoint before publishing", async () => {
  const binding = { port: 3456 };
  assert.equal(await waitForBrowserDebugging(binding, {
    fetchEndpoint: async (url) => {
      assert.equal(url, "http://127.0.0.1:3456/json/version");
      return {
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: "ws://127.0.0.1:3456/devtools/browser/current-id",
        }),
      };
    },
  }), 3456);

  await assert.rejects(waitForBrowserDebugging(binding, {
    timeoutMs: 10,
    fetchEndpoint: async () => ({
      ok: true,
      json: async () => ({
        webSocketDebuggerUrl: "ws://127.0.0.1:9999/devtools/browser/wrong-port",
      }),
    }),
  }), /did not become ready/);
});

test("malformed or unavailable endpoints fail without accepting an arbitrary listener", async () => {
  await assert.rejects(
    waitForBrowserDebugging({ port: 0 }, { timeoutMs: 10 }),
    /invalid port/,
  );
  await assert.rejects(waitForBrowserDebugging({ port: 3456 }, {
    timeoutMs: 10,
    fetchEndpoint: async () => { throw new Error("refused"); },
  }), /did not become ready/);
  await assert.rejects(waitForBrowserDebugging({ port: 3456 }, {
    timeoutMs: 10,
    fetchEndpoint: async () => ({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:3456/devtools/browser/not/valid" }),
    }),
  }), /did not become ready/);
});

test("main configures Chromium before asynchronous startup and waits before creating browser hosts", () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const configured = source.indexOf("const { isPrimaryInstance, browserDebugging } = configurePrimaryInstance(");
  const verified = source.indexOf("cdpPort = await waitForBrowserDebugging(");
  assert.ok(configured >= 0 && configured < source.indexOf("async function start()"));
  assert.ok(verified >= 0 && verified < source.indexOf("browserHost = new BrowserHost("));
  assert.doesNotMatch(source, /remote-debugging-port", "0"/);
  assert.doesNotMatch(source, /findFreePort/);
});

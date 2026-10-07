const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configureBrowserDebugging, waitForBrowserDebugging } = require("../electron/browser-debugging.cjs");

function fixture(t, previous = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webgpt-cdp-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "DevToolsActivePort");
  if (previous) fs.writeFileSync(filePath, previous);
  const switches = [];
  const app = { isReady: () => false, commandLine: { appendSwitch: (...args) => switches.push(args) } };
  return { dir, filePath, switches, app };
}

test("configure Chromium synchronously and retain the previous launch's identity", t => {
  const f = fixture(t, "1234\n/devtools/browser/old\n");
  const binding = configureBrowserDebugging(f.app, f.dir);
  assert.equal(binding.previous, "1234\n/devtools/browser/old\n");
  assert.deepEqual(f.switches, [["remote-debugging-address", "127.0.0.1"], ["remote-debugging-port", "0"]]);
  assert.throws(() => configureBrowserDebugging({ isReady: () => true }, f.dir), /before Electron/);
});

test("ignore stale ports and verify the current browser identity before publishing", async t => {
  const f = fixture(t, "1234\n/devtools/browser/old\n");
  const binding = configureBrowserDebugging(f.app, f.dir);
  let fetched = false;
  await assert.rejects(waitForBrowserDebugging(binding, { timeoutMs: 10, fetchEndpoint: async () => { fetched = true; } }), /did not become ready/);
  assert.equal(fetched, false);
  fs.writeFileSync(f.filePath, "3456\n/devtools/browser/current\n");
  await assert.rejects(waitForBrowserDebugging(binding, { timeoutMs: 10, fetchEndpoint: async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:3456/devtools/browser/another" }) }) }), /did not become ready/);
  assert.equal(await waitForBrowserDebugging(binding, { fetchEndpoint: async (url) => {
    assert.equal(url, "http://127.0.0.1:3456/json/version");
    return { ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:3456/devtools/browser/current" }) };
  } }), 3456);
});

test("malformed or unavailable endpoints fail without accepting an arbitrary listener", async t => {
  const f = fixture(t);
  const binding = configureBrowserDebugging(f.app, f.dir);
  fs.writeFileSync(f.filePath, "99999\n/devtools/browser/current\n");
  await assert.rejects(waitForBrowserDebugging(binding, { timeoutMs: 10, fetchEndpoint: async () => assert.fail("invalid port fetched") }), /did not become ready/);
  fs.writeFileSync(f.filePath, "3456\n/devtools/browser/current\n");
  await assert.rejects(waitForBrowserDebugging(binding, { timeoutMs: 10, fetchEndpoint: async () => { throw new Error("refused"); } }), /did not become ready/);
});

test("main configures Chromium before asynchronous startup and waits before creating browser hosts", () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const configured = source.indexOf("const browserDebugging = configureBrowserDebugging(");
  const verified = source.indexOf("cdpPort = await waitForBrowserDebugging(");
  assert.ok(configured >= 0 && configured < source.indexOf("async function start()"));
  assert.ok(verified >= 0 && verified < source.indexOf("browserHost = new BrowserHost("));
  assert.doesNotMatch(source, /findFreePort/);
});

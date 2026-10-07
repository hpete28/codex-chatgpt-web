const { spawnSync } = require("node:child_process");

const LOOPBACK_HOST = "127.0.0.1";
const PORT_HELPER_TIMEOUT_MS = 5_000;

function allocateLoopbackPort({
  executable = process.execPath,
  run = spawnSync,
  environment = process.env,
} = {}) {
  const script = [
    'const net=require("node:net");',
    'const server=net.createServer();',
    'server.unref();',
    'server.once("error",error=>{process.stderr.write(error.message);process.exit(1);});',
    `server.listen({host:"${LOOPBACK_HOST}",port:0,exclusive:true},()=>{`,
    'const address=server.address();',
    'if(!address||typeof address==="string"){process.exit(2);return;}',
    'process.stdout.write(String(address.port));',
    'server.close(error=>process.exit(error?3:0));',
    '});',
  ].join("");

  const result = run(executable, ["-e", script], {
    encoding: "utf8",
    env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
    timeout: PORT_HELPER_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Could not reserve a browser debugging port: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim() || `exit status ${result.status ?? "unknown"}`;
    throw new Error(`Could not reserve a browser debugging port: ${detail}`);
  }
  const port = Number(String(result.stdout || "").trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Browser debugging port helper returned an invalid port");
  }
  return port;
}

// Chromium consumes these switches before Electron's ready event. Resolve the
// ephemeral loopback port in a synchronous helper process so Electron still gets
// an explicit non-zero port before readiness. Using --remote-debugging-port=0
// changes Chromium's automation exposure and can trigger persistent web challenges.
function configureBrowserDebugging(app, _userData, options = {}) {
  if (app.isReady()) throw new Error("Browser debugging must be configured before Electron is ready");
  const port = options.port ?? allocateLoopbackPort(options);
  app.commandLine.appendSwitch("remote-debugging-address", LOOPBACK_HOST);
  app.commandLine.appendSwitch("remote-debugging-port", String(port));
  return { port };
}

async function waitForBrowserDebugging(binding, { timeoutMs = 15_000, fetchEndpoint = fetch } = {}) {
  const port = binding?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Launcher browser debugging binding has an invalid port");
  }
  const deadline = Date.now() + timeoutMs;
  const expectedPrefix = `ws://${LOOPBACK_HOST}:${port}/devtools/browser/`;
  do {
    try {
      const response = await fetchEndpoint(`http://${LOOPBACK_HOST}:${port}/json/version`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))),
      });
      const version = response.ok ? await response.json() : null;
      const endpoint = version?.webSocketDebuggerUrl;
      if (typeof endpoint === "string"
        && endpoint.startsWith(expectedPrefix)
        && /^[A-Za-z0-9-]+$/.test(endpoint.slice(expectedPrefix.length))) {
        return port;
      }
    } catch { /* Chromium may still be bringing the listener online. */ }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error("Launcher browser debugging endpoint did not become ready");
}

module.exports = { allocateLoopbackPort, configureBrowserDebugging, waitForBrowserDebugging };

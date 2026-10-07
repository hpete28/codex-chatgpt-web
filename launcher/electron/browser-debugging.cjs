const fs = require("node:fs");
const path = require("node:path");

function readActivePort(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

// Chromium consumes these switches before Electron's ready event. Configure them
// synchronously, before runtime verification or the route watchdog can yield.
function configureBrowserDebugging(app, userData) {
  if (app.isReady()) throw new Error("Browser debugging must be configured before Electron is ready");
  const filePath = path.join(userData, "DevToolsActivePort");
  const previous = readActivePort(filePath);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  return { filePath, previous };
}

async function waitForBrowserDebugging(binding, { timeoutMs = 15_000, fetchEndpoint = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const contents = readActivePort(binding.filePath);
    // A previous launch's file is not evidence that this process owns the port.
    if (contents && contents !== binding.previous) {
      const [portLine, browserPath] = contents.trim().split(/\r?\n/);
      const port = /^\d+$/.test(portLine) ? Number(portLine) : 0;
      if (port > 0 && port <= 65535 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(browserPath)) {
        try {
          const response = await fetchEndpoint(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))),
          });
          const version = response.ok ? await response.json() : null;
          if (version?.webSocketDebuggerUrl === `ws://127.0.0.1:${port}${browserPath}`) return port;
        } catch { /* Chromium may still be bringing the listener online. */ }
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error("Launcher browser debugging endpoint did not become ready");
}

module.exports = { configureBrowserDebugging, waitForBrowserDebugging };

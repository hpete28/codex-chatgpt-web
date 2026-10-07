const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { configureBrowserDebugging, waitForBrowserDebugging } = require("../../electron/browser-debugging.cjs");
const userData = process.env.CODEX_CDP_SMOKE_DATA;
if (!userData || !path.isAbsolute(userData)) throw new Error("Isolated smoke user data required");
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
const legacy = process.argv.includes("--legacy");
const binding = legacy ? { filePath: path.join(userData, "DevToolsActivePort"), previous: "" }
  : configureBrowserDebugging(app, userData);

void (async () => {
  // Reproduce an async watchdog/runtime check that allows Electron to become ready.
  await new Promise(resolve => setTimeout(resolve, 500));
  await app.whenReady();
  if (legacy) {
    app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
    app.commandLine.appendSwitch("remote-debugging-port", "0");
  }
  const port = await waitForBrowserDebugging(binding, { timeoutMs: 3000 });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html,<title>CDP recovery smoke</title>");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  if (!pages.some(page => page.title === "CDP recovery smoke")) throw new Error("Browser target not reachable");
  console.log(JSON.stringify({ status: "ok", delayedStartup: true, port, browserTargetReachable: true }));
  app.quit();
})().catch(error => { console.error(error.message); app.exit(1); });

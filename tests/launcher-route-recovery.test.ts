import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { defaultConfig } from "../src/config";
import { installCodexIntegration } from "../src/codex-integration";

const bundle = resolve(import.meta.dir, "../launcher/build/route-recovery.cjs");
const build = Bun.spawnSync([process.execPath, "run", "scripts/build-launcher-recovery.ts"], { cwd: resolve(import.meta.dir, "..") });
if (build.exitCode) throw new Error(build.stderr.toString());

function fixture(port = 0) {
  const root = mkdtempSync(join(tmpdir(), "launcher-route-recovery-"));
  const previous = { CODEX_HOME: process.env.CODEX_HOME, CODEX_CHATGPT_WEB_HOME: process.env.CODEX_CHATGPT_WEB_HOME };
  const codex = join(root, "codex");
  mkdirSync(codex);
  process.env.CODEX_HOME = codex;
  process.env.CODEX_CHATGPT_WEB_HOME = join(root, "core");
  const original = 'model = "gpt-6.1-sol"\n# user comment\n\n[agents]\ndefault_subagent_model = "gpt-6.1-sol"\n\n[features]\nmulti_agent = true\n';
  const configPath = join(codex, "config.toml");
  writeFileSync(configPath, original);
  const config = defaultConfig("browser-only");
  config.subagentProtocol = "compatibility-v1";
  config.port = port;
  const journal = installCodexIntegration(config);
  const journalPath = join(root, "core", "codex", "integration-journal.json");
  const env = { ...process.env };
  const invoke = (expression: string) => spawnSync("node", ["-e", `Promise.resolve(require(${JSON.stringify(bundle)}).${expression}).catch(e=>{console.error(e.message);process.exitCode=1})`], { env, encoding: "utf8", timeout: 10_000, windowsHide: true });
  return { root, original, configPath, journal, journalPath, env, invoke, close() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  } };
}

test("Node-only launcher recovery restores exact native config and both journals repeatedly without Bun", () => {
  const f = fixture();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = f.invoke("restoreNativeRoute()");
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
      expect(JSON.parse(readFileSync(f.journalPath, "utf8"))).toEqual({ ...f.journal, active: false });
      expect(readFileSync(f.journalPath.replace(".json", ".recovery.json"), "utf8")).toBe(readFileSync(f.journalPath, "utf8"));
    }
  } finally { f.close(); }
}, 30_000);

test("missing listener restores the journal route and corrupt primary journal recovers from its mirror", () => {
  const f = fixture();
  try {
    writeFileSync(f.journalPath, "interrupted write");
    const result = f.invoke("recoverUnhealthyRoute()");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
  } finally { f.close(); }
});

test("independent watchdog restores the native route after its owner is killed", async () => {
  const f = fixture();
  const owner = spawn("node", ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  try {
    await new Promise<void>((done, fail) => { owner!.once("spawn", done); owner!.once("error", fail); });
    const watcher = spawn("node", [bundle, "--watch-route", String(owner.pid)], { env: f.env, stdio: "ignore", windowsHide: true });
    await new Promise<void>((done, fail) => { watcher.once("spawn", done); watcher.once("error", fail); });
    owner.kill();
    await new Promise<void>((done, fail) => { watcher.once("exit", code => code === 0 ? done() : fail(new Error(`watchdog exited ${code}`))); watcher.once("error", fail); });
    expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
  } finally { owner.kill(); f.close(); }
}, 15_000);

test("recovery refuses a changed route without damaging the config or journal baseline", () => {
  const f = fixture();
  try {
    const changed = readFileSync(f.configPath, "utf8").replace(f.journal.installed.openai_base_url, "https://example.invalid/v1");
    writeFileSync(f.configPath, changed);
    const before = readFileSync(f.journalPath, "utf8");
    expect(f.invoke("restoreNativeRoute()").status).not.toBe(0);
    expect(readFileSync(f.configPath, "utf8")).toBe(changed);
    expect(readFileSync(f.journalPath, "utf8")).toBe(before);
  } finally { f.close(); }
});

test("healthy bridge retains Web routing, then bridge death restores native routing while launcher lives", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({
    service: "codex-chatgpt-web", status: "ok", pid: process.pid,
  }) });
  const f = fixture(server.port!);
  let owner: ReturnType<typeof spawn> | undefined;
  let watcher: ReturnType<typeof spawn> | undefined;
  try {
    const probe = Bun.spawn(["node", "-e", `require(${JSON.stringify(bundle)}).recoverUnhealthyRoute().catch(e=>{console.error(e);process.exitCode=1})`], { env: f.env });
    expect(await probe.exited).toBe(0);
    expect(JSON.parse(readFileSync(f.journalPath, "utf8")).active).toBe(true);
    owner = spawn("node", ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
    await new Promise<void>((done, fail) => { owner!.once("spawn", done); owner!.once("error", fail); });
    watcher = spawn("node", [bundle, "--watch-route", String(owner.pid)], { env: f.env, stdio: "ignore", windowsHide: true });
    await new Promise<void>((done, fail) => { watcher!.once("spawn", done); watcher!.once("error", fail); });
    server.stop(true);
    const deadline = Date.now() + 12_000;
    while (JSON.parse(readFileSync(f.journalPath, "utf8")).active && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
    expect(owner.exitCode).toBe(null);
  } finally {
    watcher?.kill(); owner?.kill(); server.stop(true); f.close();
  }
}, 15_000);

test("early browser bootstrap fatal restores a real journal before presenting Retry", () => {
  const f = fixture();
  try {
    const sourcePath = resolve(import.meta.dir, "../launcher/electron/main.cjs");
    const script = `
      const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
      const source=fs.readFileSync(${JSON.stringify(sourcePath)},'utf8');
      vm.runInNewContext(source.slice(source.indexOf('void start().catch(async (error) => {')), {
        start: async()=>{throw new Error('Browser idle document did not commit within 10000ms')},
        startupFailed:false, finishRuntimeStartup(){}, IS_DEV_PROFILE:false,
        routeRecovery:require(${JSON.stringify(bundle)}), browserHost:null, browserControl:null,
        fs:{appendFileSync(){}}, path, process:{argv:[],env:{}}, quitting:false,
        app:{getPath:()=>${JSON.stringify(f.root)},whenReady:async()=>{},exit(code){process.exitCode=code===1?0:2}},
        showMainWindow(){}, mainWindow:null, createStateStore:()=>({read:()=>({language:'en'})}),
        nativeCopyFor:()=>({startupTitle:'test',startupDetail:'test',startupCleanupFailed:'test',retry:'Retry',quit:'Quit'}),
        dialog:{showMessageBox:async()=>{
          if(fs.readFileSync(${JSON.stringify(f.configPath)},'utf8')!==${JSON.stringify(f.original)})throw Error('dead route remained');
          return {response:1};
        }}
      });`;
    const result = spawnSync("node", ["-e", script], { env: f.env, encoding: "utf8", timeout: 10_000, windowsHide: true });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
  } finally { f.close(); }
});

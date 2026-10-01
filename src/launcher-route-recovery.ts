// Bundled into the launcher itself: recovery must work before Bun/runtime materialization.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { deactivateCodexIntegration, inspectCodexIntegration } from "./codex-integration";
import { getConfigDir } from "./config";

export function restoreNativeRoute() {
  return deactivateCodexIntegration();
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function bridgeHealthy(): Promise<boolean> {
  const status = inspectCodexIntegration();
  if (!status.installed || !status.active) return true;
  if (status.errors.length) throw new Error(status.errors.join("; "));
  const url = new URL(status.routeUrl!);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Recovery requires a journal-owned loopback route");
  }
  try {
    const response = await fetch(`${url.origin}/healthz`, { signal: AbortSignal.timeout(2_000) });
    const body = await response.json() as { service?: string; status?: string; pid?: number };
    return response.ok && body.service === "codex-chatgpt-web" && body.status === "ok"
      && Number.isInteger(body.pid) && processAlive(body.pid!);
  } catch { return false; }
}

export async function recoverUnhealthyRoute() {
  if (await bridgeHealthy()) return { changed: false };
  return restoreNativeRoute();
}

export async function watchRoute(ownerPid: number, intervalMs = 2_000) {
  const startedAt = Date.now();
  let failures = 0;
  for (;;) {
    const alive = processAlive(ownerPid);
    // A replacement launcher owns recovery once it has acquired the supervisor state.
    if (!alive) {
      let successor: number | undefined;
      try {
        const state = JSON.parse(readFileSync(join(getConfigDir(), "runtime", "launcher-supervisor.json"), "utf8"));
        if (Date.parse(state.updatedAt) >= startedAt) successor = state.ownerPid;
      } catch {}
      if (successor && successor !== ownerPid && processAlive(successor)) return;
      restoreNativeRoute();
      return;
    }
    if (await bridgeHealthy()) failures = 0;
    else if (++failures >= 3) {
      restoreNativeRoute();
      failures = 0;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

if (process.argv.includes("--watch-route")) {
  const ownerPid = Number(process.argv[process.argv.indexOf("--watch-route") + 1]);
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("Invalid route watchdog owner");
  process.send?.({ ready: true });
  void watchRoute(ownerPid).catch(error => {
    const log = join(getConfigDir(), "runtime", "route-recovery.log");
    mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
    // Avoid config contents, paths and hook commands in the diagnostic.
    appendFileSync(log, `${new Date().toISOString()} Route recovery failed (${error.name || "Error"}); inspect integration journal\n`, { mode: 0o600 });
    process.exitCode = 1;
  });
}

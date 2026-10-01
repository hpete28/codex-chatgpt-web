// Keep Interrupt startup within Codex's fixed three-second budget: no browser/CLI imports.
import { stdin } from "node:process";
import { basename, isAbsolute } from "node:path";
import { loadConfig } from "./config";
import { interruptActiveTurn } from "./service";

export async function interruptHookCommand(args: string[]): Promise<void> {
  if (args.length) throw new Error("Interrupt hook does not accept arguments");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 32 * 1024) throw new Error("Codex Interrupt hook payload is too large");
    chunks.push(buffer);
  }
  let payload: { hook_event_name?: unknown; session_id?: unknown; turn_id?: unknown };
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Codex Interrupt hook payload is not valid JSON"); }
  const threadId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  const turnId = typeof payload.turn_id === "string" ? payload.turn_id.trim() : "";
  if (payload.hook_event_name !== "Interrupt"
    || !/^[A-Za-z0-9_-]{6,128}$/.test(threadId) || !/^[A-Za-z0-9_-]{6,128}$/.test(turnId)) {
    throw new Error("Codex Interrupt hook payload has no valid session_id or turn_id");
  }
  await interruptActiveTurn(loadConfig(), { threadId, turnId });
}

// Bun inlines modules into cli.js; import.meta.main alone then describes the
// combined entrypoint. Only the dedicated helper may parse helper arguments.
if (import.meta.main && /^interrupt-hook\.(ts|js)$/.test(basename(process.argv[1] ?? ""))) {
  const args = process.argv.slice(2);
  const flag = args.shift();
  const home = args.shift();
  if (flag !== "--home" || !home || !isAbsolute(home) || args.shift() !== "hook" || args.shift() !== "interrupt") {
    throw new Error("Interrupt helper requires --home <absolute home> hook interrupt");
  }
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  await interruptHookCommand(args);
}

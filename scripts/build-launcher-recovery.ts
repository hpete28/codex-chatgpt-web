import { resolve } from "node:path";
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "../src/launcher-route-recovery.ts")],
  outdir: resolve(import.meta.dir, "../launcher/build"),
  naming: "route-recovery.cjs",
  target: "node",
  format: "cjs",
});
if (!result.success) throw new Error(result.logs.map(log => log.message).join("\n"));

import { expect, test } from "bun:test";
import { readJsonRequestBody } from "../src/http-body";

test("decodes Codex zstd-compressed JSON request bodies", async () => {
  const body = { model: "chatgpt-web/pro", reasoning: { effort: "ultra" }, input: [{ role: "user", content: "hello" }] };
  // Generated with Node's zstd encoder, independent of the runtime decoder.
  const compressed = Buffer.from("KLUv/SBmzQIA4oUTGYC3LQYz9OVuixxn9r/RR8yE9A6blMYIGwFrsM47M9AWE11WQ+xSVwLzJgmPy/roXrJ5NQnCVuYCD0zkmF5OTQGCHQCbij0G2nxWSMMqAgBORSYdTDM=", "base64");
  const encoded = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(encoded).set(compressed);
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "zstd" },
    body: encoded,
  });

  expect(await readJsonRequestBody(request)).toEqual(body);
});

test("rejects unsupported request content encodings", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "br" },
    body: "{}",
  });

  await expect(readJsonRequestBody(request)).rejects.toThrow("Unsupported Content-Encoding: br");
});

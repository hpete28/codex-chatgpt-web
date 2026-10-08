import { expect, test } from "bun:test";
import { estimateChatGptWebInputTokens, estimateChatGptWebUsage, resolveBiggerContextMultipartParts } from "../src/adapters/chatgpt-web/usage";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { compiledChatGptWebMessages, estimateChatGptWebImageTokens, estimateCompiledChatGptWebInputTokens } from "../src/adapters/chatgpt-web/input-tokens";
import { assertChatGptWebMultipartInputWithinLimits, resolveChatGptWebMultipartStagingMode } from "../src/adapters/chatgpt-web/browser-worker";
import { estimateTokens } from "../src/lib/token-estimate";
import type { CodexParsedRequest } from "../src/types";
import { resolveChatGptWebMessageTokenBudget, resolveChatGptWebStagingTokenBudget } from "../src/chatgpt-web-models";

const capabilities = { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };

function request(text: string): CodexParsedRequest {
  return {
    modelId: "gpt-5.6-sol",
    stream: false,
    context: { messages: [{ role: "user", content: text, timestamp: 1 }] },
    options: { reasoning: "high" },
  };
}

test.each([
  ["highly compressible", "a".repeat(480_000)],
  ["ordinary repeated words", `${"word ".repeat(79_999)}word`],
])("%s context uses tokenizer-derived usage without character-pressure inflation", (_label, text) => {
  expect(estimateChatGptWebInputTokens(request(text), capabilities)).toBeLessThan(100_000);
}, 15_000);

test("multipart selection accounts for whole-record and composer fit before submission", () => {
  const plus = { ...capabilities, extraHighAvailable: false, proAvailable: false };
  for (const [contents, expected] of [
    [["small task"], undefined],
    [[50_000, 40_000, 50_000, 5_000].map(n => "word ".repeat(n)), 3],
    [Array.from({ length: 2 }, () => ("x" + " ".repeat(99)).repeat(4_900)), 2],
    [Array.from({ length: 3 }, () => ("x" + " ".repeat(99)).repeat(4_500)), 3],
  ] as const) {
    const parsed = request("");
    parsed.context.messages = contents.map((content, index) => ({ role: "user", content, timestamp: index + 1 }));
    const parts = resolveBiggerContextMultipartParts(parsed, plus);
    expect(parts).toBe(expected);
    const compiled = compileChatGptWebPrompt(parsed, plus, undefined, { experimentalMultipartParts: parts });
    if (parts) {
      expect(compiled.multipart!.parts.flatMap(part => JSON.parse(part).records).map(record => record.message.content))
        .toEqual([...contents]);
    }
  }
  // Low-token text can still exceed the reasoning model's server character ceiling.
  // Stage the complete record instead of sending it inline or dropping its contents.
  const sparsePro = request(("x" + " ".repeat(99)).repeat(6_000));
  expect(resolveBiggerContextMultipartParts(sparsePro, capabilities)).toBe(2);
  const stagedPro = compileChatGptWebPrompt(sparsePro, capabilities, undefined, { experimentalMultipartParts: 2 });
  expect(stagedPro.multipart!.parts.flatMap(part => JSON.parse(part).records).map(record => record.message.content))
    .toEqual([sparsePro.context.messages[0]!.content]);
  const proMessages = compiledChatGptWebMessages(stagedPro);
  const proStages = proMessages.slice(0, -1);
  expect(proMessages.at(-1)!.length).toBeLessThanOrEqual(500_000);
  expect(resolveChatGptWebMultipartStagingMode(
    "gpt-5.6-sol",
    capabilities,
    Math.max(...proStages.map(message => estimateTokens(message))),
    Math.max(...proStages.map(message => message.length)),
  ).effort).toBe("max");
}, 120_000);

test("large Bigger Context uses smaller transport stages with a staging mode that can retain the full accumulated context", () => {
  const plus = { ...capabilities, proAvailable: false };
  const parsed = request("");
  parsed.context.messages = Array.from({ length: 48 }, (_unused, index) => ({
    role: "user" as const,
    content: `large-history-${index}-${"word ".repeat(5_000)}`,
    timestamp: index + 1,
  }));

  const parts = resolveBiggerContextMultipartParts(parsed, plus);
  expect(parts).toBeDefined();
  expect(parts!).toBeGreaterThan(3);

  const compiled = compileChatGptWebPrompt(parsed, plus, undefined, { experimentalMultipartParts: parts });
  const messages = compiledChatGptWebMessages(compiled);
  expect(messages).toHaveLength(parts! + 1);
  expect(compiled.multipart!.parts.flatMap(part => JSON.parse(part).records)).toHaveLength(48);
  const finalMessage = messages.at(-1)!;
  expect(finalMessage.length).toBeLessThan(50_000);
  expect(finalMessage).not.toContain("large-history-47-");
  const stageTokens = messages.slice(0, -1).map(text => estimateTokens(text, parsed.modelId));
  const stageChars = messages.slice(0, -1).map(text => text.length);
  const estimatedInputTokens = estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId);
  const stagingMode = resolveChatGptWebMultipartStagingMode(
    parsed.modelId,
    plus,
    Math.max(...stageTokens),
    Math.max(...stageChars),
    estimatedInputTokens,
  );

  expect(stagingMode.effort).toBe("medium");
  expect(estimatedInputTokens).toBeLessThan(90_000 * 3);

  expect(() => assertChatGptWebMultipartInputWithinLimits(
    270_000,
    1_000,
    parsed.modelId,
    "high",
    plus,
    1_000,
    8,
    {
      stagingEffort: "low",
      maxStageMessageTokens: 1_000,
      maxStageChars: 1_000,
      finalMessageTokens: 1_000,
      finalMessageChars: 1_000,
    },
  )).toThrow("three-part ceiling");
}, 30_000);

test("Bigger Context compaction selects three parts before the legacy inline byte budget", () => {
  const parsed = request("x".repeat(160_000));
  parsed._compactionRequest = true;
  const parts = resolveBiggerContextMultipartParts(parsed, capabilities);
  expect(parts).toBe(3);
  const compiled = compileChatGptWebPrompt(parsed, capabilities, undefined, { experimentalMultipartParts: parts });
  expect(compiled.trimmedCompactionMessages).toBeUndefined();
  expect(compiled.multipart!.parts.flatMap(part => JSON.parse(part).records).map(record => record.message.content))
    .toEqual([parsed.context.messages[0]!.content]);
}, 15_000);

test("GPT-6 Sol on Plus keeps standard context while Pro can stage the same complete input", () => {
  const plus = { ...capabilities, proAvailable: false };
  const parsed = request("");
  parsed._chatgptModelFamily = "6";
  parsed.context.messages = Array.from({ length: 4 }, (_, index) => ({
    role: "user", content: `record-${index}: ${"word ".repeat(24_000)}`, timestamp: index + 1,
  }));
  const original = structuredClone(parsed);
  expect(resolveBiggerContextMultipartParts(parsed, plus)).toBeUndefined();
  const compiled = compileChatGptWebPrompt(parsed, plus);
  expect(compiled.multipart).toBeUndefined();
  for (const message of parsed.context.messages) expect(compiled.text).toContain(message.content as string);
  expect(estimateChatGptWebUsage(parsed, { answer: "done" }, plus, true))
    .toEqual(estimateChatGptWebUsage(parsed, { answer: "done" }, plus, false));
  expect(() => compileChatGptWebPrompt(parsed, plus, undefined, { experimentalMultipartParts: 2 }))
    .toThrow("GPT-6 Sol uses standard context");
  expect(parsed).toEqual(original);
  expect(resolveBiggerContextMultipartParts({ ...parsed, _chatgptModelFamily: "5.6" }, capabilities)).toBe(2);
  const parts = resolveBiggerContextMultipartParts(parsed, capabilities);
  expect(parts).toBe(2);
  const staged = compileChatGptWebPrompt(parsed, capabilities, undefined, { experimentalMultipartParts: parts });
  expect(staged.multipart!.parts.flatMap(part => JSON.parse(part).records).map(record => record.message.content))
    .toEqual(parsed.context.messages.map(message => message.content));
  expect(estimateChatGptWebUsage(parsed, { answer: "done" }, capabilities, true).inputTokens)
    .toBe(estimateCompiledChatGptWebInputTokens(staged, parsed.modelId));
}, 30_000);

test("GPT-6 compaction respects the selected account and effort", () => {
  const parsed = { ...request("Summarize this task."), _chatgptModelFamily: "6" as const, _compactionRequest: true };
  for (const proAvailable of [false, true]) {
    const caps = { ...capabilities, proAvailable };
    for (const effort of ["low", "medium", "high", "xhigh"] as const) {
      parsed.options.reasoning = effort;
      const supported = proAvailable && effort !== "low";
      const parts = resolveBiggerContextMultipartParts(parsed, caps);
      if (supported) {
        expect(parts).toBe(3);
        expect(compileChatGptWebPrompt(parsed, caps, undefined, { experimentalMultipartParts: parts }).multipart!.parts).toHaveLength(3);
      } else {
        expect(parts).toBeUndefined();
        expect(estimateChatGptWebUsage(parsed, { answer: "summary" }, caps, true))
          .toEqual(estimateChatGptWebUsage(parsed, { answer: "summary" }, caps, false));
        expect(() => compileChatGptWebPrompt(parsed, caps, undefined, { experimentalMultipartParts: 6 }))
          .toThrow("GPT-6 Sol uses standard context");
      }
    }
  }
  parsed.options.reasoning = "max";
  const parts = resolveBiggerContextMultipartParts(parsed, capabilities);
  expect(parts).toBe(3);
  expect(compileChatGptWebPrompt(parsed, capabilities, undefined, { experimentalMultipartParts: parts }).multipart!.parts).toHaveLength(3);
});

test("Plus history is completely staged within Instant upload headroom before a small execution commit", () => {
  const plus = { ...capabilities, proAvailable: false, extraHighAvailable: false };
  const parsed = request("");
  parsed.context.messages = Array.from({ length: 60 }, (_, index) => ({
    role: "user", content: `record-${index}: ${"word ".repeat(3000)}`, timestamp: index + 1,
  }));
  for (const compaction of [false, true]) {
    parsed._compactionRequest = compaction;
    const parts = resolveBiggerContextMultipartParts(parsed, plus);
    expect(parts).toBe(8);
    const compiled = compileChatGptWebPrompt(parsed, plus, undefined, { experimentalMultipartParts: parts });
    const records = compiled.multipart!.parts.flatMap(part => JSON.parse(part).records);
    expect(records.map(record => record.message.content)).toEqual(parsed.context.messages.map(message => message.content));
    expect(compiled.trimmedCompactionMessages).toBeUndefined();
    const messages = compiledChatGptWebMessages(compiled);
    const stagingTokens = messages.slice(0, -1).map(text => estimateTokens(text));
    const stagingMode = resolveChatGptWebMultipartStagingMode("gpt-5.6-sol", plus,
      Math.max(...stagingTokens), Math.max(...messages.slice(0, -1).map(text => text.length)),
      estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId));
    expect(stagingMode.effort).toBe("medium");
    expect(Math.max(...stagingTokens)).toBeLessThanOrEqual(
      resolveChatGptWebStagingTokenBudget("gpt-5.6-sol", stagingMode.effort, plus));
    expect(Math.max(...stagingTokens)).toBeLessThan(35_000);
    const finalTokens = estimateTokens(messages.at(-1)!);
    expect(finalTokens).toBeLessThan(Math.min(...stagingTokens));
    expect(finalTokens).toBeLessThanOrEqual(resolveChatGptWebMessageTokenBudget("gpt-5.6-sol", "high", plus));
  }
}, 30_000);

test("multipart planning leaves room for final attachments and execution instructions without losing history", () => {
  for (const scenario of [
    { extraHighAvailable: false, proAvailable: false, images: 3, schema: false },
    { extraHighAvailable: true, proAvailable: true, images: 10, schema: false },
    { extraHighAvailable: false, proAvailable: false, images: 0, schema: true },
  ]) {
    const caps = { ...capabilities, proAvailable: scenario.proAvailable };
    const parsed = request("");
    const texts = Array.from({ length: 36 }, (_, index) => `record ${index}: ${"word ".repeat(5_000)}`);
    parsed.context.messages = texts.map((content, index) => ({ role: "user", content, timestamp: index + 1 }));
    const images = Array.from({ length: scenario.images }, (_, index) => ({
      type: "image" as const, imageUrl: `data:image/png;base64,partition-image-${index}`, detail: "original" as const,
    }));
    if (images.length) parsed.context.messages.push({ role: "user", content: images, timestamp: 37 });
    if (scenario.schema) parsed.options.outputFormat = {
      type: "json_schema", name: "result", strict: true, schema: { type: "string", description: "schema ".repeat(24_000) },
    };
    const compiled = compileChatGptWebPrompt(parsed, caps, undefined, { experimentalMultipartParts: 6 });
    const records = compiled.multipart!.parts.flatMap(part => JSON.parse(part).records);
    expect(records.map(record => record.message_index)).toEqual(parsed.context.messages.map((_, index) => index));
    expect(records.slice(0, texts.length).map(record => record.message.content)).toEqual(texts);
    expect(compiled.images.map(image => ({ imageUrl: image.imageUrl, detail: image.detail })))
      .toEqual(images.map(image => ({ imageUrl: image.imageUrl, detail: image.detail })));
    if (scenario.schema) expect(compiled.multipart!.commit).toContain(JSON.stringify(parsed.options.outputFormat!.schema));
    const messages = compiledChatGptWebMessages(compiled);
    const tokens = messages.map(text => estimateTokens(text));
    const chars = messages.map(text => text.length);
    const maxStageMessageTokens = Math.max(...tokens.slice(0, -1));
    const maxStageChars = Math.max(...chars.slice(0, -1));
    const stage = resolveChatGptWebMultipartStagingMode(parsed.modelId, caps, maxStageMessageTokens, maxStageChars);
    expect(() => assertChatGptWebMultipartInputWithinLimits(
      estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId), Math.max(...tokens),
      parsed.modelId, "high", caps, Math.max(...chars), 6,
      { stagingEffort: stage.effort, maxStageMessageTokens, maxStageChars, finalMessageTokens: tokens.at(-1)!, finalMessageChars: chars.at(-1)!, finalImageTokens: estimateChatGptWebImageTokens(compiled) },
    )).not.toThrow();
  }
}, 30_000);

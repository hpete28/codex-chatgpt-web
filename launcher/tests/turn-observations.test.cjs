const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_COMPLETED_SUMMARIES,
  createTurnObservationStore,
  validateTurnObservation,
} = require("../electron/turn-observations.cjs");

function observation(traceId, sequence, phase = "responding", extra = {}) {
  return {
    traceId,
    sequence,
    at: `2026-09-18T15:30:${String(sequence % 60).padStart(2, "0")}.000-04:00`,
    phase,
    ...extra,
  };
}

test("validates the exact bounded TurnObservation contract", () => {
  const valid = observation("trace-a", 1, "staging", {
    acknowledgedParts: 2,
    totalParts: 8,
    continuationCount: 0,
    workState: "continue",
  });
  assert.deepEqual(validateTurnObservation(valid), valid);

  for (const phase of [
    "preparing", "staging", "responding", "tools", "recovering", "continuing", "compacting",
    "finished", "cancelled", "failed",
  ]) {
    assert.equal(validateTurnObservation(observation("trace-a", 1, phase)).phase, phase);
  }
  assert.throws(() => validateTurnObservation({ ...valid, progress: "50%" }), /unsupported field progress/);
  assert.throws(() => validateTurnObservation({ ...valid, remaining: "one step" }), /unsupported field remaining/);
  assert.throws(() => validateTurnObservation({ ...valid, conversationId: "secret" }), /unsupported field conversationId/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 0)), /positive integer/);
  assert.throws(() => validateTurnObservation({ ...valid, at: "2026-09-18" }), /ISO timestamp/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 1, "unknown")), /phase is invalid/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 1, "staging", {
    acknowledgedParts: 1,
  })), /provided together/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 1, "staging", {
    acknowledgedParts: 3,
    totalParts: 2,
  })), /part counts are invalid/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 1, "staging", {
    acknowledgedParts: 0,
    totalParts: 9,
  })), /part counts are invalid/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 1, "continuing", {
    continuationCount: -1,
  })), /nonnegative integer/);
  assert.throws(() => validateTurnObservation(observation("trace-a", 1, "responding", {
    workState: "working",
  })), /workState is invalid/);
});

test("keeps only the latest accepted summary for each trace", () => {
  const store = createTurnObservationStore();
  assert.equal(store.record(observation("trace-a", 1, "preparing")), true);
  assert.equal(store.record(observation("trace-a", 2, "responding", { continuationCount: 1 })), true);

  assert.deepEqual(store.get("trace-a"), observation("trace-a", 2, "responding", { continuationCount: 1 }));
  assert.equal(store.list().length, 1);
});

test("ignores duplicate and out-of-order sequences without changing the summary", () => {
  const store = createTurnObservationStore();
  store.record(observation("trace-a", 3, "tools"));

  assert.equal(store.record({ ...observation("trace-a", 3, "recovering"), progress: "unused" }), false);
  assert.equal(store.record({ ...observation("trace-a", 2, "recovering"), taskId: "unused" }), false);
  assert.deepEqual(store.get("trace-a"), observation("trace-a", 3, "tools"));
});

test("ignores every observation after a terminal phase", () => {
  for (const terminal of ["finished", "cancelled", "failed"]) {
    const store = createTurnObservationStore();
    store.record(observation(`trace-${terminal}`, 1, terminal, { workState: "complete" }));

    assert.equal(store.record({
      ...observation(`trace-${terminal}`, 2, "responding"),
      capability: "unused",
    }), false);
    assert.equal(store.get(`trace-${terminal}`).phase, terminal);
  }
});

test("isolates traces and evicts only the oldest completed summaries over the cap", () => {
  const store = createTurnObservationStore();
  store.record(observation("active-old", 1, "responding"));

  for (let index = 0; index < MAX_COMPLETED_SUMMARIES + 2; index += 1) {
    store.record(observation(`completed-${index}`, 1, "finished"));
  }
  store.record(observation("active-new", 1, "tools"));

  assert.deepEqual(store.get("active-old"), observation("active-old", 1, "responding"));
  assert.deepEqual(store.get("active-new"), observation("active-new", 1, "tools"));
  assert.equal(store.get("completed-0"), null);
  assert.equal(store.get("completed-1"), null);
  assert.equal(store.get("completed-2").phase, "finished");
  assert.equal(store.list().filter(value => value.phase === "finished").length, MAX_COMPLETED_SUMMARIES);
  assert.equal(store.list().length, MAX_COMPLETED_SUMMARIES + 2);
});

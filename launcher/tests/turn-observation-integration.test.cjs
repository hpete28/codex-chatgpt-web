"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost } = require("../electron/browser-host.cjs");
const { createTurnObservationStore } = require("../electron/turn-observations.cjs");

test("owned helper observations reach Activity and reject stale or foreign owners", () => {
  const published = [];
  const host = {
    turnTabs: new Map([["tab-one", { traceId: "trace_observe", helperPid: 1234 }]]),
    closedTurnOwners: new Map(),
    turnObservationStore: createTurnObservationStore(),
    publishTurnObservations: values => published.push(values),
  };
  const observation = {
    traceId: "trace_observe", sequence: 1, at: "2026-09-27T13:00:00.000Z", phase: "preparing",
  };
  assert.throws(() => BrowserHost.prototype.observeTurn.call(host, "trace_observe", 5678, observation), /ownership mismatch/);
  assert.throws(() => BrowserHost.prototype.observeTurn.call(host, "other_trace", 1234, observation), /identity mismatch/);
  assert.equal(BrowserHost.prototype.observeTurn.call(host, "trace_observe", 1234, observation), true);
  assert.deepEqual(published.at(-1), [observation]);
  assert.equal(BrowserHost.prototype.observeTurn.call(host, "trace_observe", 1234, observation), false);
  host.turnTabs.clear();
  host.closedTurnOwners.set("trace_observe", 1234);
  const completed = { ...observation, sequence: 2, phase: "finished" };
  assert.equal(BrowserHost.prototype.observeTurn.call(host, "trace_observe", 1234, completed), true);
  assert.deepEqual(host.turnObservationStore.get("trace_observe"), completed);
});

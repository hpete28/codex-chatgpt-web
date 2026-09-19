"use strict";

const MAX_COMPLETED_SUMMARIES = 20;
const MAX_PARTS = 8;
const PHASES = new Set([
  "preparing",
  "staging",
  "responding",
  "tools",
  "recovering",
  "continuing",
  "compacting",
  "finished",
  "cancelled",
  "failed",
]);
const TERMINAL_PHASES = new Set(["finished", "cancelled", "failed"]);
const WORK_STATES = new Set(["continue", "complete", "blocked"]);
const OBSERVATION_KEYS = new Set([
  "traceId",
  "sequence",
  "at",
  "phase",
  "acknowledgedParts",
  "totalParts",
  "continuationCount",
  "workState",
]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function validateTurnObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Turn observation must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!OBSERVATION_KEYS.has(key)) throw new Error(`Turn observation has unsupported field ${key}`);
  }
  if (typeof value.traceId !== "string") throw new Error("Turn observation traceId must be a string");
  if (!Number.isInteger(value.sequence) || value.sequence <= 0) {
    throw new Error("Turn observation sequence must be a positive integer");
  }
  if (typeof value.at !== "string" || !ISO_TIMESTAMP.test(value.at) || !Number.isFinite(Date.parse(value.at))) {
    throw new Error("Turn observation at must be an ISO timestamp string");
  }
  if (!PHASES.has(value.phase)) throw new Error("Turn observation phase is invalid");

  const hasAcknowledgedParts = value.acknowledgedParts !== undefined;
  const hasTotalParts = value.totalParts !== undefined;
  if (hasAcknowledgedParts !== hasTotalParts) {
    throw new Error("Turn observation part counts must be provided together");
  }
  if (hasAcknowledgedParts) {
    if (!Number.isInteger(value.acknowledgedParts)
      || !Number.isInteger(value.totalParts)
      || value.acknowledgedParts < 0
      || value.acknowledgedParts > value.totalParts
      || value.totalParts > MAX_PARTS) {
      throw new Error("Turn observation part counts are invalid");
    }
  }
  if (value.continuationCount !== undefined
    && (!Number.isInteger(value.continuationCount) || value.continuationCount < 0)) {
    throw new Error("Turn observation continuationCount must be a nonnegative integer");
  }
  if (value.workState !== undefined && !WORK_STATES.has(value.workState)) {
    throw new Error("Turn observation workState is invalid");
  }

  return {
    traceId: value.traceId,
    sequence: value.sequence,
    at: value.at,
    phase: value.phase,
    ...(hasAcknowledgedParts ? {
      acknowledgedParts: value.acknowledgedParts,
      totalParts: value.totalParts,
    } : {}),
    ...(value.continuationCount !== undefined ? { continuationCount: value.continuationCount } : {}),
    ...(value.workState !== undefined ? { workState: value.workState } : {}),
  };
}

function cloneSummary(summary) {
  return summary ? { ...summary } : null;
}

function createTurnObservationStore() {
  const summaries = new Map();
  const completedTraceIds = [];

  return {
    record(value) {
      const previous = value && typeof value === "object" && typeof value.traceId === "string"
        ? summaries.get(value.traceId)
        : null;
      if (previous) {
        if (TERMINAL_PHASES.has(previous.phase)) return false;
        if (Number.isInteger(value.sequence) && value.sequence <= previous.sequence) return false;
      }

      const observation = validateTurnObservation(value);
      summaries.set(observation.traceId, observation);
      if (TERMINAL_PHASES.has(observation.phase)) {
        completedTraceIds.push(observation.traceId);
        while (completedTraceIds.length > MAX_COMPLETED_SUMMARIES) {
          summaries.delete(completedTraceIds.shift());
        }
      }
      return true;
    },

    get(traceId) {
      return cloneSummary(summaries.get(traceId));
    },

    list() {
      return [...summaries.values()].map(cloneSummary);
    },
  };
}

module.exports = {
  MAX_COMPLETED_SUMMARIES,
  createTurnObservationStore,
  validateTurnObservation,
};

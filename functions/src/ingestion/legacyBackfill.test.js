const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCandidate,
  executeLegacyBackfill,
  oldUtcMidnightCandidate
} = require("./legacyBackfill");

function legacyRecord(overrides = {}) {
  const data = {
    calendarId: "calendar-1",
    connectionId: "connection-1",
    sourceApp: "GYM-K2",
    sourceDocumentPath: "workouts/workout-1",
    sourceProjectId: "gym-project",
    category: "workout",
    title: "Workout",
    dateId: "2026-08-11",
    visibility: "ownerOnly",
    ...overrides.data
  };
  return {
    id: overrides.id || "external-1",
    path: overrides.path || "lifeCalendars/calendar-1/dailyEntries/2026-08-11/externalItems/external-1",
    checkpoint: overrides.checkpoint || "2026-08-11/external-1",
    calendarId: overrides.calendarId || "calendar-1",
    connectionId: overrides.connectionId === undefined ? data.connectionId : overrides.connectionId,
    dateId: overrides.dateId === undefined ? data.dateId : overrides.dateId,
    data
  };
}

function harness(options = {}) {
  const canonical = new Map(options.canonical || []);
  const writes = [];
  const connections = new Map(options.connections || [["connection-1", {
    status: "active",
    sourceApp: "GYM-K2",
    sourceProjectIds: ["gym-project"]
  }]]);
  const dependencies = {
    calendar: options.calendar || { ownerUid: "owner-1" },
    getConnection: async (id) => connections.get(id) || null,
    getCanonical: async (id) => canonical.get(id) || null,
    now: () => new Date("2026-08-12T12:00:00.000Z"),
    applyOperations: async (operations) => {
      for (const operation of operations) {
        const existing = canonical.get(operation.id);
        if (operation.action === "create") {
          assert.equal(existing, undefined);
          canonical.set(operation.id, structuredClone(operation.data));
        } else {
          assert.equal(existing.contentHash, operation.expectedContentHash);
          canonical.set(operation.id, { ...existing, ...structuredClone(operation.data) });
        }
        writes.push(operation);
      }
    }
  };
  return { canonical, connections, dependencies, writes };
}

test("backfill defaults to dry-run and performs no writes", async () => {
  const state = harness();
  const summary = await executeLegacyBackfill([legacyRecord()], state.dependencies);
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.scanned, 1);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.created, 1);
  assert.equal(state.writes.length, 0);
  assert.equal(state.canonical.size, 0);
});

test("backfill is restartable and repeated execution becomes unchanged", async () => {
  const state = harness();
  const first = await executeLegacyBackfill([legacyRecord()], state.dependencies, { apply: true });
  const second = await executeLegacyBackfill([legacyRecord()], state.dependencies, { apply: true });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(state.canonical.size, 1);
  assert.equal(state.writes.length, 1);
});

test("missing connections and missing dates are skipped safely", async () => {
  const state = harness({ connections: [] });
  const records = [
    legacyRecord(),
    legacyRecord({ id: "missing-date", path: "missing-date", dateId: "", data: { dateId: "" } })
  ];
  const summary = await executeLegacyBackfill(records, state.dependencies, { apply: true });
  assert.equal(summary.skipped, 2);
  assert.equal(summary.skippedReasons.missing_connection, 1);
  assert.equal(summary.skippedReasons.missing_date, 1);
  assert.equal(state.writes.length, 0);
});

test("duplicate legacy identities create only one canonical event", async () => {
  const state = harness();
  const duplicate = legacyRecord({ id: "external-2", path: "duplicate-path", checkpoint: "2026-08-11/external-2" });
  const summary = await executeLegacyBackfill([legacyRecord(), duplicate], state.dependencies, { apply: true });
  assert.equal(summary.created, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.conflicts, 0);
  assert.equal(state.canonical.size, 1);
});

test("repairs only the legacy UTC-midnight timezone defect", async () => {
  const record = legacyRecord();
  const connection = { status: "active", sourceApp: "GYM-K2", sourceProjectIds: ["gym-project"] };
  const calendar = { ownerUid: "owner-1" };
  const candidate = buildCandidate(record, calendar, connection);
  const oldCandidate = oldUtcMidnightCandidate(candidate, record.dateId);
  const createdAt = new Date("2026-08-11T08:00:00.000Z");
  const existing = {
    id: candidate.idempotencyKey,
    ...oldCandidate,
    ingestionStatus: "received",
    createdAt,
    updatedAt: createdAt
  };
  const state = harness({ calendar, canonical: [[candidate.idempotencyKey, existing]] });
  const summary = await executeLegacyBackfill([record], state.dependencies, { apply: true });
  const repaired = state.canonical.get(candidate.idempotencyKey);
  assert.equal(summary.repaired, 1);
  assert.equal(repaired.occurredAt.toISOString(), "2026-08-11T04:00:00.000Z");
  assert.equal(repaired.startAt.toISOString(), "2026-08-11T04:00:00.000Z");
  assert.equal(repaired.contentHash, candidate.contentHash);
  assert.equal(repaired.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(repaired.migrationMetadata.action, "timezone-repaired");
});

test("protects non-legacy canonical events from replacement", async () => {
  const record = legacyRecord();
  const connection = { status: "active", sourceApp: "GYM-K2", sourceProjectIds: ["gym-project"] };
  const calendar = { ownerUid: "owner-1" };
  const candidate = buildCandidate(record, calendar, connection);
  const existing = {
    ...candidate,
    legacySourceType: "",
    metadata: {},
    contentHash: "different-content"
  };
  const state = harness({ calendar, canonical: [[candidate.idempotencyKey, existing]] });
  const summary = await executeLegacyBackfill([record], state.dependencies, { apply: true });
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.repaired, 0);
  assert.equal(state.writes.length, 0);
  assert.equal(state.canonical.get(candidate.idempotencyKey).contentHash, "different-content");
});

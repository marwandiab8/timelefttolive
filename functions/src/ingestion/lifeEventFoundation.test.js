const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeLifeEventRecord,
  ingestLifeEventSingle,
  ingestLifeEventBatch,
  ingestLegacySingle,
  ingestLegacyBatch,
  mapLegacyToLifeEvent,
  upsertLifeEventRecord,
  cleanupLifeEventArtifacts
} = require("./lifeEventFoundation");
const { tokenHash } = require("./tokens");

class FakeSnapshot {
  constructor(pathName, data) {
    this._path = pathName;
    this._data = data;
    this.exists = data !== undefined;
    this.id = pathName.split("/").pop();
  }
  data() {
    return this._data === undefined ? undefined : structuredClone(this._data);
  }
}

class FakeDocRef {
  constructor(store, pathName) {
    this._store = store;
    this._path = pathName;
    this.id = pathName.split("/").pop();
  }
  get path() {
    return this._path;
  }
  async get() {
    return new FakeSnapshot(this._path, this._store.get(this._path));
  }
  async set(data, options = {}) {
    if (options.merge) {
      const existing = this._store.get(this._path);
      this._store.set(this._path, existing ? { ...existing, ...data } : data);
      return;
    }
    this._store.set(this._path, data);
  }
  async delete() {
    if (this._store._deleteFailures?.has(this._path)) {
      throw new Error("injection: forced document delete failure");
    }
    this._store.delete(this._path);
  }
  collection(name) {
    return new FakeCollectionRef(this._store, `${this._path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(store, pathName) {
    this._store = store;
    this._path = pathName;
  }
  doc(id) {
    return new FakeDocRef(this._store, `${this._path}/${id}`);
  }
  async get() {
    const docs = [];
    for (const [docPath, data] of this._store.entries()) {
      if (docPath.startsWith(`${this._path}/`)) {
        docs.push({
          data: () => structuredClone(data),
          exists: true,
          id: docPath.split("/").pop()
        });
      }
    }
    return { docs };
  }
  collection(name) {
    return new FakeCollectionRef(this._store, `${this._path}/${name}`);
  }
}

class FakeQuery {
  constructor(store, pathName, docs = [], constraints = [], limitCount = null) {
    this._store = store;
    this._path = pathName;
    this._docs = docs;
    this._constraints = constraints;
    this._limitCount = limitCount;
  }
  where(field, op, value) {
    return new FakeQuery(
      this._store,
      this._path,
      this._docs,
      [...this._constraints, { field, op, value }],
      this._limitCount
    );
  }

  limit(count) {
    return new FakeQuery(this._store, this._path, this._docs, this._constraints, count);
  }
  async get() {
    let results = this._docs
      .filter((item) => {
        const data = item[1];
        return this._constraints.every((constraint) => {
          const actual = data[constraint.field];
          if (constraint.op === "<=") {
            if (actual === undefined) return false;
            return new Date(actual) <= new Date(constraint.value);
          }
          if (constraint.op === "==") {
            return actual === constraint.value;
          }
          return true;
        });
      })
      .map(([documentPath, data]) => ({
        ref: new FakeDocRef(this._store, documentPath),
        exists: true,
        data: () => structuredClone(data)
      }));

    if (this._limitCount !== null) {
      results = results.slice(0, this._limitCount);
    }

    return { docs: results };
  }
}

class FakeFirestore {
  constructor() {
    this._store = new Map();
    this._deleteFailures = new Set();
    this._store._deleteFailures = this._deleteFailures;
  }
  collection(pathName) {
    return new FakeCollectionRef(this._store, pathName);
  }
  collectionGroup(name) {
    const docs = Array.from(this._store.entries()).filter(([entryPath]) => entryPath.includes(`/${name}/`));
    return new FakeQuery(this._store, name, docs);
  }
  async runTransaction(callback) {
    const writes = [];
    const tx = {
      get: async (ref) => ref.get(),
      set: (ref, data, options = {}) => {
        writes.push({ type: "set", ref, data, options });
      },
      delete: (ref) => {
        writes.push({ type: "delete", ref });
      }
    };
    const result = await callback(tx);
    for (const write of writes) {
      if (write.type === "set") {
        await write.ref.set(write.data, write.options);
      }
      if (write.type === "delete") {
        await write.ref.delete();
      }
    }
    return result;
  }

  batch() {
    const writes = [];
    return {
      delete(ref) {
        writes.push(ref);
      },
      async commit() {
        for (const ref of writes) {
          await ref.delete();
        }
      }
    };
  }
}

class FailingBatchOnceFirestore extends FakeFirestore {
  constructor() {
    super();
    this._batchFailure = true;
  }

  batch() {
    const baseBatch = super.batch();
    if (!this._batchFailure) {
      return baseBatch;
    }
    this._batchFailure = false;
    return {
      delete(ref) {
        baseBatch.delete(ref);
      },
      async commit() {
        throw new Error("injection: forced batch commit failure");
      }
    };
  }
}

class ThrowingEventWritesFirestore extends FakeFirestore {
  async runTransaction(callback) {
    const writes = [];
    const tx = {
      get: async (ref) => ref.get(),
      set: (ref, data, options = {}) => {
        writes.push({ type: "set", ref, data, options });
      },
      delete: (ref) => {
        writes.push({ type: "delete", ref });
      }
    };
    const result = await callback(tx);
    for (const write of writes) {
      if (write.type === "set" && write.ref._path.includes("/lifeEvents/")) {
        throw new Error("injection: forced lifeEvent write failure");
      }
      if (write.type === "set") {
        await write.ref.set(write.data, write.options);
      }
      if (write.type === "delete") await write.ref.delete();
    }
    return result;
  }
}

function makeReq(body, token = "") {
  return {
    method: "POST",
    body,
    get(header) {
      if (header.toLowerCase() === "authorization") {
        return token ? `Bearer ${token}` : "";
      }
      return "";
    }
  };
}

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function makeLegacyReq(body, token = "") {
  return {
    method: "POST",
    body,
    get(header) {
      if (header.toLowerCase() === "authorization") {
        return token ? `Bearer ${token}` : "";
      }
      return "";
    }
  };
}

function bigString(length) {
  return "x".repeat(length);
}

async function setupAuthorized(db, token, options = {}) {
  const {
    calendarId = "calendar-1",
    connectionId = "conn-1",
    integrationId = `integration-${connectionId}`,
    sourceApp = "aigridline",
    ownerUid = "owner-1",
    connection = {},
    status = "active"
  } = options;

  const tokenDigest = tokenHash(token);
  await db.collection("lifeCalendars").doc(calendarId).set({ ownerUid });
  await db.collection("lifeCalendars").doc(calendarId).collection("sourceConnections").doc(connectionId).set({
    status,
    sourceApp,
    sourceFirebaseProjectId: "aigridline",
    sourceProjectIds: ["project-a"],
    integrationId,
    permissions: {
      eventClasses: ["activity_boundary", "completed_activity", "project", "location", "system", "achievement"]
    },
    ...connection
  }, { merge: true });
  await db.collection("lifeCalendars").doc(calendarId).collection("sourceConnectionSecrets").doc(connectionId).set({
    tokenHash: tokenDigest,
    tokenStatus: "active",
    status
  });
}

function rulesText() {
  const rulesPath = path.resolve(__dirname, "../../../firestore.rules");
  return fs.readFileSync(rulesPath, "utf8");
}

function rulesBlock(text, collectionName) {
  const needle = `      match /${collectionName}/`;
  const start = text.indexOf(needle);
  if (start < 0) return "";
  const end = text.indexOf("\n      }", start);
  return text.slice(start, end < 0 ? undefined : end + 8);
}

test("normalizeLifeEventRecord is deterministic for idempotency", async () => {
  const payload = {
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "seed",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  };
  const first = normalizeLifeEventRecord(payload, {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "int-1",
    timeLeftUserId: "owner-1",
    connection: { sourceApp: "aigridline", sourceProjectIds: ["project-a"], permissions: { eventClasses: ["activity_boundary"] } }
  });
  const second = normalizeLifeEventRecord(payload, {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "int-1",
    timeLeftUserId: "owner-1",
    connection: { sourceApp: "aigridline", sourceProjectIds: ["project-a"], permissions: { eventClasses: ["activity_boundary"] } }
  });
  assert.equal(first.idempotencyKey, second.idempotencyKey);
});

test("canonical date-only values use Toronto midnight and replay exactly", async () => {
  const db = new FakeFirestore();
  const token = "t-date-only-toronto";
  await setupAuthorized(db, token);
  const body = {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "date-only-toronto",
    eventType: "arrive_work",
    occurredAt: "2026-08-11",
    timezone: "America/Toronto"
  };
  const first = makeRes();
  const replay = makeRes();
  await ingestLifeEventSingle(db, makeReq(body, token), first);
  await ingestLifeEventSingle(db, makeReq(body, token), replay);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(first.payload.lifeEventId).get();
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.payload.duplicate, true);
  assert.equal(event.data().occurredAt.toISOString(), "2026-08-11T04:00:00.000Z");
  assert.equal(first.payload.idempotencyKey, replay.payload.idempotencyKey);
});

test("legacy date-only records stay on the intended Toronto day", () => {
  const event = mapLegacyToLifeEvent({
    sourceApp: "GYM-K2",
    sourceFirebaseProjectId: "gym-k2",
    sourceProjectId: "project-a",
    sourceDocumentPath: "workouts/toronto-day",
    category: "workout",
    dateId: "2026-08-11",
    timezone: "America/Toronto"
  }, {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    timeLeftUserId: "owner-1",
    connection: {
      sourceApp: "GYM-K2",
      sourceFirebaseProjectId: "gym-k2",
      sourceProjectIds: ["project-a"],
      permissions: { eventClasses: ["completed_activity"] }
    }
  });
  assert.equal(event.occurredAt.toISOString(), "2026-08-11T04:00:00.000Z");
  assert.equal(event.startAt.toISOString(), "2026-08-11T04:00:00.000Z");
});

test("canonical normalization rejects an invalid supplied timezone", () => {
  assert.throws(() => normalizeLifeEventRecord({
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "bad-timezone",
    eventType: "arrive_work",
    occurredAt: "2026-08-11",
    timezone: "America/Not-Toronto"
  }, {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    timeLeftUserId: "owner-1",
    connection: { sourceApp: "aigridline", sourceProjectIds: ["project-a"], permissions: { eventClasses: ["activity_boundary"] } }
  }), /valid IANA timezone/);
});

test("valid single canonical event", async () => {
  const db = new FakeFirestore();
  const token = "t-single";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-1",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "success");
});

test("valid completed activity eventClass", async () => {
  const db = new FakeFirestore();
  const token = "t-complete";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-complete",
    eventType: "completed_workout",
    occurredAt: "2026-07-20T10:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().eventClass, "completed_activity");
});

test("valid activity boundary eventClass", async () => {
  const db = new FakeFirestore();
  const token = "t-boundary";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-boundary",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().eventClass, "activity_boundary");
});

test("missing required field returns validation failure", async () => {
  const db = new FakeFirestore();
  const token = "t-missing";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-1",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "validation_error");
});

test("missing required source identifier is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-missing-id";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("missing valid timestamp is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-missing-ts";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "ts-missing",
    eventType: "arrive_work"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("invalid event class is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-class";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-class",
    eventType: "arrive_work",
    eventClass: "invalid_class",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "validation_error");
});

test("invalid timestamp is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-ts";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-ts",
    eventType: "arrive_work",
    occurredAt: "not-a-timestamp"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("endAt before startAt is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-order";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-order",
    eventType: "completed_workout",
    startAt: "2026-07-20T10:00:00Z",
    endAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("negative duration is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-negative";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-negative",
    eventType: "completed_workout",
    occurredAt: "2026-07-20T09:00:00Z",
    durationSeconds: -1
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("conflicting duration is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-conflict-duration";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "conflict-duration",
    eventType: "completed_workout",
    startAt: "2026-07-20T10:00:00Z",
    endAt: "2026-07-20T10:10:00Z",
    durationSeconds: 120
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("oversized metadata is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-over-size";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "oversize-meta",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    metadata: { huge: bigString(70000) }
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.payload.code, "validation_error");
});

test("oversized metrics is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-over-size-metrics";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "oversize-metrics",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    metrics: { huge: bigString(70000) }
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.payload.code, "validation_error");
});

test("server calculated duration is used when absent from payload", async () => {
  const db = new FakeFirestore();
  const token = "t-duration";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-duration",
    eventType: "completed_workout",
    startAt: "2026-07-20T10:00:00Z",
    endAt: "2026-07-20T10:05:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().durationSeconds, 300);
});

test("optional location is normalized", async () => {
  const db = new FakeFirestore();
  const token = "t-location";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-location",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    location: {
      label: "Home",
      latitude: 43.65,
      longitude: -79.38,
      accuracyMeters: 4
    }
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().location.latitude, 43.65);
  assert.equal(event.data().location.longitude, -79.38);
});

test("invalid latitude rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-lat";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-lat",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    location: {
      latitude: 100,
      longitude: -79.38
    }
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("invalid longitude rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-lng";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-lng",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    location: {
      latitude: 40,
      longitude: 181
    }
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("privacy defaults to ownerOnly", async () => {
  const db = new FakeFirestore();
  const token = "t-privacy";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-privacy",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().privacyLevel, "ownerOnly");
});

test("registry resolves canonical timeLeftUserId", async () => {
  const db = new FakeFirestore();
  const token = "t-owner";
  await setupAuthorized(db, token, { connection: { timeLeftUserId: "owner-99" } });
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-owner",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().timeLeftUserId, "owner-99");
});

test("client-supplied owner ID is ignored", async () => {
  const db = new FakeFirestore();
  const token = "t-owner-override";
  await setupAuthorized(db, token, { connection: { timeLeftUserId: "owner-1" } });
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "owner-override",
    timeLeftUserId: "owner-spoofed",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const event = await db.collection("lifeCalendars").doc("calendar-1").collection("lifeEvents").doc(res.payload.lifeEventId).get();
  assert.equal(event.data().timeLeftUserId, "owner-1");
});

test("disabled connection is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-disabled";
  await setupAuthorized(db, token, { status: "paused" });
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-disabled",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 403);
});

test("wrong integrationId is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-int";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "wrong-int",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-int",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, "auth_error");
});

test("invalid bearer token is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-valid";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "bad-token",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, "t-wrong");
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 401);
});

test("revoked token is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-revoked";
  await setupAuthorized(db, token, { connection: { tokenStatus: "revoked" } });
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "revoked-token",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 401);
});

test("wrong calendarId is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-bad-calendar";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-not-found",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "bad-calendar",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 404);
});

test("wrong connectionId is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-bad-connection";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-not-found",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "bad-connection",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 404);
});

test("wrong sourceProjectId is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-wrong-project";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-xxx",
    sourceRecordId: "bad-project",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "validation_error");
});

test("disallowed source app is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-app";
  await setupAuthorized(db, token, { sourceApp: "gridlineai" });
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-app",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
});

test("disallowed event class scope is rejected", async () => {
  const db = new FakeFirestore();
  const token = "t-scope";
  await setupAuthorized(db, token, {
    connection: { permissions: { eventClasses: ["completed_activity"] } }
  });
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "scope",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "validation_error");
});

test("missing bearer token is rejected", async () => {
  const db = new FakeFirestore();
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-bearer",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  });
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 401);
});

test("exact duplicate returns duplicate success", async () => {
  const db = new FakeFirestore();
  const token = "t-dup";
  await setupAuthorized(db, token);
  const body = {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-dup",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  };
  const first = makeRes();
  const second = makeRes();
  await ingestLifeEventSingle(db, makeReq(body, token), first);
  await ingestLifeEventSingle(db, makeReq(body, token), second);
  assert.equal(first.payload.duplicate, false);
  assert.equal(second.payload.duplicate, true);
  assert.equal(first.payload.lifeEventId, second.payload.lifeEventId);
  assert.equal(first.payload.status, "success");
  assert.equal(second.payload.status, "success");
});

test("duplicate race does not create more than one LifeEvent", async () => {
  const db = new FakeFirestore();
  const token = "t-race";
  await setupAuthorized(db, token);
  const body = {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-race",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  };
  const responses = await Promise.all(Array.from({ length: 20 }, () => ingestLifeEventSingle(db, makeReq(body, token), makeRes())));
  const eventDocs = [...db._store.keys()].filter((entry) => entry.includes("/lifeEvents/"));
  assert.equal(eventDocs.length, 1);
  assert.equal(responses.every((resp) => resp.payload.status === "success"), true);
});

test("same idempotency key with different payload returns conflict", async () => {
  const db = new FakeFirestore();
  const token = "t-conflict";
  await setupAuthorized(db, token);
  const base = {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "rec-conflict",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    title: "first"
  };
  const first = makeRes();
  const second = makeRes();
  await ingestLifeEventSingle(db, makeReq(base, token), first);
  await ingestLifeEventSingle(db, makeReq({ ...base, title: "second" }, token), second);
  assert.equal(second.statusCode, 409);
  assert.equal(second.payload.code, "idempotency_conflict");
});

test("batch endpoint succeeds when all items are valid", async () => {
  const db = new FakeFirestore();
  const token = "t-batch-ok";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: [
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "batch-ok-1",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "batch-ok-2",
        eventType: "completed_workout",
        occurredAt: "2026-07-20T10:00:00Z"
      }
    ]
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "success");
  assert.equal(res.payload.results.length, 2);
  assert.equal(res.payload.failed, 0);
});

test("batch endpoint supports partial success", async () => {
  const db = new FakeFirestore();
  const token = "t-batch-partial";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: [
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "batch-ok",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "batch-bad",
        eventType: "arrive_work"
      }
    ]
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "partial_success");
  assert.equal(res.payload.failed, 1);
  assert.equal(res.payload.results.length, 2);
});

test("batch item clientReference and index are stable", async () => {
  const db = new FakeFirestore();
  const token = "t-batch-reference";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: [
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "clientref-1",
        clientReference: "cr-1",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "clientref-2",
        clientReference: "cr-2",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T10:00:00Z"
      }
    ]
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.results[0].index, 0);
  assert.equal(res.payload.results[1].index, 1);
  assert.equal(res.payload.results[0].clientReference, "cr-1");
  assert.equal(res.payload.results[1].clientReference, "cr-2");
});

test("one invalid batch item does not roll back valid items", async () => {
  const db = new FakeFirestore();
  const token = "t-batch-rollback";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: [
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "rollback-ok",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "rollback-bad",
        eventType: "arrive_work"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "rollback-ok-2",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T11:00:00Z"
      }
    ]
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.failed, 1);
  const lifeEvents = [...db._store.keys()].filter((entry) => entry.includes("/lifeEvents/"));
  assert.equal(lifeEvents.length, 2);
});

test("batch endpoint rejects oversized payload", async () => {
  const db = new FakeFirestore();
  const token = "t-batch-large";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: Array.from({ length: 101 }, (_, index) => ({
      schemaVersion: 1,
      sourceApp: "aigridline",
      sourceProjectId: "project-a",
      sourceRecordId: `large-${index}`,
      eventType: "arrive_work",
      occurredAt: "2026-07-20T09:00:00Z"
    }))
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "validation_error");
});

test("batch duplicates are processed independently", async () => {
  const db = new FakeFirestore();
  const token = "t-batch-dup-indep";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: [
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "dup-indep",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "dup-indep",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      },
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "dup-indep-2",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T10:00:00Z"
      }
    ]
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.payload.status, "success");
  assert.equal(res.payload.results[0].status, "success");
  assert.equal(res.payload.results[1].status, "success");
  assert.equal(res.payload.results[0].duplicate, false);
  assert.equal(res.payload.results[1].duplicate, true);
  assert.equal(res.payload.results[2].duplicate, false);
});

test("internal batch failure uses generic error response", async () => {
  const db = new ThrowingEventWritesFirestore();
  const token = "t-batch-internal";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    items: [
      {
        schemaVersion: 1,
        sourceApp: "aigridline",
        sourceProjectId: "project-a",
        sourceRecordId: "batch-internal",
        eventType: "arrive_work",
        occurredAt: "2026-07-20T09:00:00Z"
      }
    ]
  }, token);
  const res = makeRes();
  await ingestLifeEventBatch(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.results[0].status, "error");
  assert.equal(res.payload.results[0].code, "server_error");
  assert.equal(res.payload.results[0].message, "Internal ingestion failure.");
});

test("validation failures do not create dead-letter records", async () => {
  const db = new FakeFirestore();
  const token = "t-no-dead";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "validation",
    eventType: "arrive_work"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const dead = [...db._store.keys()].some((entry) => entry.includes("ingestionDeadLetters"));
  assert.equal(res.statusCode, 400);
  assert.equal(dead, false);
});

test("unexpected internal failure writes dead-letter", async () => {
  const db = new ThrowingEventWritesFirestore();
  const token = "t-dl";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "dl",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  assert.equal(res.statusCode, 500);
  const deadLetterCount = [...db._store.keys()].filter((entry) => entry.includes("ingestionDeadLetters")).length;
  assert.equal(deadLetterCount > 0, true);
});

test("dead-letter records do not persist token-like values", async () => {
  const db = new ThrowingEventWritesFirestore();
  const token = "t-dl-redact";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "dl-redact",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    authorization: "nope"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const dead = [...db._store.values()].find((value) => value && value.errorCode);
  assert.equal(dead.errorCode, "internal_error");
  assert.equal(Object.prototype.hasOwnProperty.call(dead, "payload"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dead, "payloadHash"), true);
  assert.equal(res.payload.status, "error");
});

test("raw audit snapshot is sanitized and non-sensitive", async () => {
  const db = new FakeFirestore();
  const token = "t-audit";
  await setupAuthorized(db, token);
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "audit",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z",
    metrics: {
      authorization: "should-not-store",
      steps: 500,
      nested: {
        token: "also-no",
        quality: "ok"
      }
    },
    metadata: {
      apiKey: "should-not-store",
      notes: "allowed"
    }
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const raw = [...db._store.values()].find((value) => value && value.payload && value.payload.eventType === "arrive_work");
  assert.equal(raw.payload.eventType, "arrive_work");
  assert.equal(Object.prototype.hasOwnProperty.call(raw.payloadSummary, "authorization"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(raw.payload, "authorization"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(raw.payload, "apiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(raw.payload, "token"), false);
});

test("raw audit snapshot stores expiry near 90 days", async () => {
  const db = new FakeFirestore();
  const token = "t-audit-retention";
  await setupAuthorized(db, token);
  const now = new Date();
  const req = makeReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "audit-retention",
    eventType: "arrive_work",
    occurredAt: "2026-07-20T09:00:00Z"
  }, token);
  const res = makeRes();
  await ingestLifeEventSingle(db, req, res);
  const raw = [...db._store.values()].find((value) => value && value.expiresAt && value.payload && value.payload.eventType === "arrive_work");
  const days = (new Date(raw.expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(days >= 89.5 && days <= 90.5);
});

test("cleanup removes expired artifacts and keeps valid ones", async () => {
  const db = new FakeFirestore();
  const now = Date.now();
  const oldTimestamp = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const newTimestamp = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const oldRawRef = db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("old");
  const newRawRef = db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("new");
  const oldDeadRef = db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("old");
  const newDeadRef = db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("new");
  await oldRawRef.set({ expiresAt: oldTimestamp, payload: {} });
  await newRawRef.set({ expiresAt: newTimestamp, payload: {} });
  await oldDeadRef.set({ expiresAt: oldTimestamp, sourceIdentifier: "legacy" });
  await newDeadRef.set({ expiresAt: newTimestamp, sourceIdentifier: "legacy" });

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 1);
  assert.equal(result.deadLetterDeleted, 1);
  assert.equal(result.totalDeleted, 2);

  const after = [...db._store.keys()];
  const afterRaw = after.filter((entry) => entry.includes("/rawIngestionPayloads/")).length;
  const afterDead = after.filter((entry) => entry.includes("/ingestionDeadLetters/")).length;
  assert.equal(afterRaw, 1);
  assert.equal(afterDead, 1);
});

test("cleanup handles empty artifact set", async () => {
  const db = new FakeFirestore();
  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 0);
  assert.equal(result.deadLetterDeleted, 0);
  assert.equal(result.totalDeleted, 0);
});

test("cleanup keeps only unexpired artifacts", async () => {
  const db = new FakeFirestore();
  const now = Date.now();
  const futureTimestamp = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  await db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("fresh").set({
    expiresAt: futureTimestamp,
    payload: {}
  });
  await db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("fresh").set({
    expiresAt: futureTimestamp,
    sourceIdentifier: "legacy"
  });

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 0);
  assert.equal(result.deadLetterDeleted, 0);
  assert.equal(result.totalDeleted, 0);
  assert.equal(db._store.size, 2);
});

test("cleanup removes expired raw records", async () => {
  const db = new FakeFirestore();
  const now = Date.now();
  const expired = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  await db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("expired").set({
    expiresAt: expired,
    payload: {}
  });
  await db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("fresh").set({
    expiresAt: fresh,
    payload: {}
  });

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 1);
  assert.equal(result.deadLetterDeleted, 0);
  assert.equal(db._store.size, 1);
});

test("cleanup removes expired dead-letter records", async () => {
  const db = new FakeFirestore();
  const now = Date.now();
  const expired = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  await db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("expired").set({
    expiresAt: expired,
    sourceIdentifier: "legacy"
  });
  await db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("fresh").set({
    expiresAt: fresh,
    sourceIdentifier: "legacy"
  });

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.deadLetterDeleted, 1);
  assert.equal(result.rawDeleted, 0);
  assert.equal(db._store.size, 1);
});

test("cleanup supports mixed collections", async () => {
  const db = new FakeFirestore();
  const now = Date.now();
  const expired = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  await db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("expired").set({
    expiresAt: expired,
    payload: {}
  });
  await db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("fresh").set({
    expiresAt: fresh,
    payload: {}
  });
  await db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("expired").set({
    expiresAt: expired,
    sourceIdentifier: "legacy"
  });
  await db.collection("lifeCalendars").doc("calendar-1").collection("ingestionDeadLetters").doc("fresh").set({
    expiresAt: fresh,
    sourceIdentifier: "legacy"
  });

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 1);
  assert.equal(result.deadLetterDeleted, 1);
  assert.equal(result.totalDeleted, 2);

  const afterRaw = [...db._store.keys()].filter((entry) => entry.includes("/rawIngestionPayloads/")).length;
  const afterDead = [...db._store.keys()].filter((entry) => entry.includes("/ingestionDeadLetters/")).length;
  assert.equal(afterRaw, 1);
  assert.equal(afterDead, 1);
});

test("cleanup paginates larger than one query limit", async () => {
  const db = new FakeFirestore();
  const now = Date.now();
  const expired = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  for (let index = 0; index < 150; index += 1) {
    await db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc(`expired-${index}`).set({
      expiresAt: expired,
      payload: { idx: index }
    });
  }

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 150);
  assert.equal(result.deadLetterDeleted, 0);
  assert.equal(result.totalDeleted, 150);
  assert.equal(db._store.size, 0);
});

test("cleanup handles batch delete failure and continues safely", async () => {
  const db = new FailingBatchOnceFirestore();
  const now = Date.now();
  const expired = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const goodDoc = db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("good");
  const failDoc = db.collection("lifeCalendars").doc("calendar-1").collection("rawIngestionPayloads").doc("failure");
  await goodDoc.set({ expiresAt: expired, payload: { keep: false } });
  await failDoc.set({ expiresAt: expired, payload: { keep: false } });
  db._deleteFailures.add("lifeCalendars/calendar-1/rawIngestionPayloads/failure");

  const result = await cleanupLifeEventArtifacts(db);
  assert.equal(result.rawDeleted, 1);
  assert.equal(result.deadLetterDeleted, 0);
  assert.equal(result.totalDeleted, 1);
  assert.equal(db._store.size, 1);
});

test("cleanupLifeEventArtifacts is exported", () => {
  assert.equal(typeof cleanupLifeEventArtifacts, "function");
});

test("legacy single adapter creates canonical LifeEvent", async () => {
  const db = new FakeFirestore();
  const token = "t-legacy-single";
  await setupAuthorized(db, token, {
    connection: {
      permissions: {
        eventClasses: ["completed_activity", "project", "system", "achievement", "activity_boundary"]
      }
    }
  });
  const req = {
    method: "POST",
    body: {
      calendarId: "calendar-1",
      connectionId: "conn-1",
      item: {
        sourceApp: "aigridline",
        sourceFirebaseProjectId: "aigridline",
        category: "workout",
        sourceProjectId: "project-a",
        sourceRecordId: "legacy-1",
        sourceDocumentPath: "workouts/w1",
        dateId: "2026-07-20"
      }
    },
    get(header) {
      if (header.toLowerCase() === "authorization") return `Bearer ${token}`;
      return "";
    }
  };
  const res = makeRes();
  await ingestLegacySingle(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.payload.lifeEventId, "string");
  assert.equal(res.payload.status, "created");
});

test("legacy single writes remain on canonical conflict", async () => {
  const db = new FakeFirestore();
  const token = "t-legacy-conflict";
  await setupAuthorized(db, token, {
    connection: {
      permissions: {
        eventClasses: ["completed_activity", "project", "system", "achievement", "activity_boundary"]
      }
    }
  });
  const req = {
    method: "POST",
    body: {
      calendarId: "calendar-1",
      connectionId: "conn-1",
      item: {
        sourceApp: "aigridline",
        sourceFirebaseProjectId: "aigridline",
        category: "workout",
        sourceProjectId: "project-a",
        sourceRecordId: "legacy-conflict",
        sourceDocumentPath: "workouts/wc",
        dateId: "2026-07-20",
        title: "first"
      }
    },
    get(header) {
      if (header.toLowerCase() === "authorization") return `Bearer ${token}`;
      return "";
    }
  };
  const first = makeRes();
  await ingestLegacySingle(db, req, first);
  const second = makeRes();
  await ingestLegacySingle(
    db,
    {
      ...req,
      body: {
        ...req.body,
        item: {
          ...req.body.item,
          title: "changed"
        }
      }
    },
    second
  );
  assert.equal(first.payload.ok, true);
  assert.equal(second.payload.ok, true);
  assert.equal(second.payload.canonicalIngestion, "failed");
  assert.ok(typeof first.payload.lifeEventId === "string" && first.payload.lifeEventId.length > 0);
  assert.ok(second.payload.canonicalError);
  const legacyItemCount = [...db._store.keys()].filter((entry) => entry.includes("/externalItems/")).length;
  assert.equal(legacyItemCount > 0, true);
  const lifeEvents = [...db._store.keys()].filter((entry) => entry.includes("/lifeEvents/"));
  assert.equal(lifeEvents.length > 0, true);
});

test("legacy stable identifier emits stable canonical idempotency", async () => {
  const db = new FakeFirestore();
  const token = "t-legacy-idemp";
  await setupAuthorized(db, token, {
    connection: {
      permissions: {
        eventClasses: ["completed_activity", "project", "system", "achievement", "activity_boundary"]
      }
    }
  });
  const req = makeLegacyReq({
    calendarId: "calendar-1",
    connectionId: "conn-1",
    item: {
      sourceApp: "aigridline",
      sourceFirebaseProjectId: "aigridline",
      category: "workout",
      sourceProjectId: "project-a",
      sourceRecordId: "legacy-stable",
      sourceDocumentPath: "workouts/ws",
      dateId: "2026-07-20"
    }
  }, token);
  const first = makeRes();
  const second = makeRes();
  await ingestLegacySingle(db, req, first);
  await ingestLegacySingle(db, req, second);
  assert.equal(first.payload.lifeEventId, second.payload.lifeEventId);
});

test("legacy unsupported data is skipped instead of invented LifeEvent", async () => {
  const db = new FakeFirestore();
  const token = "t-legacy-unsupported";
  await setupAuthorized(db, token, {
    connection: {
      permissions: {
        eventClasses: ["completed_activity", "project", "system", "achievement", "activity_boundary"]
      }
    }
  });
  const req = {
    method: "POST",
    body: {
      calendarId: "calendar-1",
      connectionId: "conn-1",
      item: {
        sourceApp: "aigridline",
        sourceFirebaseProjectId: "aigridline",
        category: "workout",
        sourceProjectId: "project-a",
        sourceRecordId: "legacy-unsupported"
      }
    },
    get(header) {
      if (header.toLowerCase() === "authorization") return `Bearer ${token}`;
      return "";
    }
  };
  const res = makeRes();
  await ingestLegacySingle(db, req, res);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.canonicalIngestion, "skipped");
});

test("legacy batch adapter maps supported records", async () => {
  const db = new FakeFirestore();
  const token = "t-legacy-batch";
  await setupAuthorized(db, token, {
    connection: {
      permissions: {
        eventClasses: ["completed_activity", "project", "system", "achievement", "activity_boundary"]
      }
    }
  });
  const req = {
    method: "POST",
    body: {
      calendarId: "calendar-1",
      connectionId: "conn-1",
      items: [
        {
          sourceApp: "aigridline",
          sourceFirebaseProjectId: "aigridline",
          category: "workout",
          sourceProjectId: "project-a",
          sourceRecordId: "legacy-2",
          sourceDocumentPath: "workouts/w2",
          dateId: "2026-07-20"
        },
        {
          sourceApp: "aigridline",
          sourceFirebaseProjectId: "aigridline",
          category: "journal",
          sourceProjectId: "project-a",
          sourceRecordId: "legacy-3",
          sourceDocumentPath: "journal/j1",
          dateId: "2026-07-20"
        }
      ]
    },
    get(header) {
      if (header.toLowerCase() === "authorization") return `Bearer ${token}`;
      return "";
    }
  };
  const res = makeRes();
  await ingestLegacyBatch(db, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.results.length, 2);
});

test("owner can read own lifeEvents from rules", () => {
  const text = rulesText();
  const block = rulesBlock(text, "lifeEvents");
  assert.match(block, /allow read:\s*if\s+isOwner\(calendarId\);/);
});

test("other users cannot read lifeEvents", () => {
  const text = rulesText();
  const block = rulesBlock(text, "lifeEvents");
  assert.doesNotMatch(block, /isAcceptedViewer|viewerVisible|isAcceptedViewer\(calendarId\)/);
});

test("source-app admins cannot read personal lifeEvents", () => {
  const text = rulesText();
  const block = rulesBlock(text, "lifeEvents");
  assert.doesNotMatch(block, /isAcceptedViewer/);
});

test("phase-1 function exports include v1 lifecycle endpoints", () => {
  const indexText = fs.readFileSync(path.resolve(__dirname, "../../../functions/index.js"), "utf8");
  assert.match(indexText, /exports\.apiV1LifeEvents\s*=\s*onRequest\(/);
  assert.match(indexText, /exports\.apiV1LifeEventsBatch\s*=\s*onRequest\(/);
  assert.match(indexText, /exports\.ingestExternalDailyItem\s*=\s*onRequest\(/);
  assert.match(indexText, /exports\.ingestExternalDailyItemsBatch\s*=\s*onRequest\(/);
});

test("public routes are rewired to expected v1 paths", () => {
  const hosting = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../firebase.json"), "utf8"));
  const rewrites = hosting.hosting?.rewrites || [];
  const singleRoute = rewrites.find((rewrite) => rewrite.source === "/api/v1/life-events");
  const batchRoute = rewrites.find((rewrite) => rewrite.source === "/api/v1/life-events:batch");
  assert.equal(singleRoute?.function, "apiV1LifeEvents");
  assert.equal(batchRoute?.function, "apiV1LifeEventsBatch");
});

test("dead-letter and raw audit collections are server-only", () => {
  const text = rulesText();
  const dead = rulesBlock(text, "ingestionDeadLetters");
  const raw = rulesBlock(text, "rawIngestionPayloads");
  assert.match(dead, /allow read,\s*write:\s*if\s+false;/);
  assert.match(raw, /allow read,\s*write:\s*if\s+false;/);
});

test("lifeEvents are server-written only", () => {
  const text = rulesText();
  const block = rulesBlock(text, "lifeEvents");
  assert.match(block, /allow read:\s*if\s+isOwner\(calendarId\);/);
  assert.match(block, /allow write:\s*if\s+false;/);
});

test("mapLegacyToLifeEvent includes expected defaults", () => {
  const mapped = mapLegacyToLifeEvent({
    sourceApp: "aigridline",
    category: "workout",
    sourceProjectId: "project-a",
    dateId: "2026-07-20",
    sourceRecordId: "legacy-workout",
    metadata: {
      workoutType: "run"
    }
  }, {
    calendarId: "calendar-1",
    connectionId: "conn-1",
    integrationId: "integration-conn-1",
    timeLeftUserId: "owner-1",
    connection: {
      sourceApp: "aigridline",
      sourceProjectIds: ["project-a"],
      permissions: { eventClasses: ["completed_activity", "project", "system", "achievement", "activity_boundary"] }
    }
  });
  assert.equal(mapped.eventClass, "completed_activity");
  assert.equal(mapped.eventType, "workout");
  assert.equal(mapped.schemaVersion, 1);
});

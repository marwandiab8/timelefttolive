const assert = require("node:assert/strict");
const test = require("node:test");
const {
  authorizeLifeEvent,
  createActivityMediaHandler,
  createJournalDetailsHandler,
  journalDetail,
  journalTitle,
} = require("./activityJournal");

class Snapshot {
  constructor(path, data) {
    this.id = path.split("/").pop();
    this.exists = data !== undefined;
    this._data = data;
  }
  data() { return this._data; }
}

class DocRef {
  constructor(db, path) { this.db = db; this.path = path; }
  async get() { return new Snapshot(this.path, this.db.docs.get(this.path)); }
  collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); }
}

class Query {
  constructor(db, path, filters = [], max = Infinity) {
    this.db = db; this.path = path; this.filters = filters; this.max = max;
  }
  where(field, operator, value) { return new Query(this.db, this.path, [...this.filters, { field, operator, value }], this.max); }
  limit(max) { return new Query(this.db, this.path, this.filters, max); }
  async get() {
    this.db.queryCount += 1;
    const docs = [...this.db.docs.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && path.split("/").length === this.path.split("/").length + 1)
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => operator === "==" && data[field] === value))
      .slice(0, this.max)
      .map(([path, data]) => new Snapshot(path, data));
    return { docs };
  }
}

class CollectionRef extends Query {
  doc(id) { return new DocRef(this.db, `${this.path}/${id}`); }
}

class FakeDb {
  constructor(docs = {}) {
    this.docs = new Map(Object.entries(docs));
    this.queryCount = 0;
  }
  collection(name) { return new CollectionRef(this, name); }
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
    type(value) { this.headers["Content-Type"] = value; return this; },
    send(body) { this.body = body; return this; },
  };
}

function request({ method = "POST", body = {}, query = {}, token = "valid" } = {}) {
  return {
    method, body, query,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    get(name) { return String(name).toLowerCase() === "authorization" ? this.headers.authorization || "" : ""; },
  };
}

const calendarId = "calendar-1";
const lifeEventId = "life-event-1";
const mediaLifeEventId = "life-event-media-1";
const connectionId = "connection-1";
const ownerUid = "owner-1";

function timeDocs(overrides = {}) {
  return {
    [`lifeCalendars/${calendarId}`]: { ownerUid, ...overrides.calendar },
    [`lifeCalendars/${calendarId}/sourceConnections/${connectionId}`]: {
      sourceApp: "gridlineai",
      sourceFirebaseProjectId: "gridlineai",
      timeLeftUserId: ownerUid,
      sourceProjectIds: ["home"],
      ...overrides.connection,
    },
    [`lifeCalendars/${calendarId}/lifeEvents/${lifeEventId}`]: {
      id: lifeEventId,
      calendarId,
      connectionId,
      timeLeftUserId: ownerUid,
      sourceApp: "gridlineai",
      sourceFirebaseProjectId: "gridlineai",
      sourceProjectId: "home",
      sourceRecordId: "logEntries/log-1",
      ...overrides.event,
    },
  };
}

test("journal extraction preserves multiline note and real source timestamps", () => {
  const detail = journalDetail("life-1", {
    rawText: "Morning notes\nSteel work continued.",
    createdAt: new Date("2026-08-18T12:42:00Z"),
    sourceSentAt: new Date("2026-08-18T12:42:02Z"),
    reportDateKey: "2026-08-18",
    projectId: "home",
  });
  assert.equal(detail.note, "Morning notes\nSteel work continued.");
  assert.equal(detail.title, "Morning notes");
  assert.equal(detail.occurredAt, "2026-08-18T12:42:00.000Z");
  assert.equal(detail.sourceSentAt, "2026-08-18T12:42:02.000Z");
  assert.equal(journalTitle({}, "First line\nSecond line"), "First line");
});

test("historical Shortcut journal shadows are identified only by explicit source identity", () => {
  assert.equal(journalDetail("life-1", { rawText: "Boundary log", source: "ios_shortcuts", shortcutEventId: "shortcut-1" }).shortcutShadow, true);
  assert.equal(journalDetail("life-2", { rawText: "A real note", source: "ios_shortcuts" }).shortcutShadow, false);
});

test("owner and authorized project are both required", async () => {
  const db = new FakeDb(timeDocs());
  await assert.rejects(
    authorizeLifeEvent({ timeDb: db, calendarId, lifeEventId, uid: "someone-else" }),
    (error) => error.code === "owner_required"
  );
  const wrongScope = new FakeDb(timeDocs({ event: { sourceProjectId: "docksteader" } }));
  await assert.rejects(
    authorizeLifeEvent({ timeDb: wrongScope, calendarId, lifeEventId, uid: ownerUid }),
    (error) => error.code === "project_scope_denied"
  );
  const appIdScope = new FakeDb(timeDocs({
    connection: { sourceProjectIds: ["1:118761010772:web:example"] },
    event: { sourceProjectId: "1:118761010772:web:example" },
  }));
  await assert.rejects(
    authorizeLifeEvent({ timeDb: appIdScope, calendarId, lifeEventId, uid: ownerUid }),
    (error) => error.code === "project_scope_denied"
  );
});

test("details endpoint returns sanitized Home note and linked image without raw payload", async () => {
  const docs = timeDocs();
  docs[`lifeCalendars/${calendarId}/lifeEvents/${mediaLifeEventId}`] = {
    id: mediaLifeEventId,
    calendarId,
    connectionId,
    timeLeftUserId: ownerUid,
    sourceApp: "gridlineai",
    sourceFirebaseProjectId: "gridlineai",
    sourceProjectId: "home",
    sourceRecordId: "media/media-1",
  };
  const timeDb = new FakeDb(docs);
  const sourceDb = new FakeDb({
    "logEntries/log-1": {
      projectId: "home",
      rawText: "Real private journal note",
      createdAt: new Date("2026-08-18T12:42:00Z"),
      linkedMediaIds: ["projects/home/media/2026-08-18/message/photo.jpg"],
    },
    "media/media-1": {
      projectId: "home",
      linkedLogEntryId: "log-1",
      storagePath: "projects/home/media/2026-08-18/message/photo.jpg",
      contentType: "image/jpeg",
      captionText: "Kitchen progress",
      createdAt: new Date("2026-08-18T12:43:00Z"),
      unrelatedPrivateField: "must not leave the resolver",
    },
  });
  const handler = createJournalDetailsHandler({
    timeDb,
    sourceDb,
    auth: { verifyIdToken: async () => ({ uid: ownerUid }) },
  });
  const res = response();
  await handler(request({ body: { calendarId, lifeEventIds: [lifeEventId, mediaLifeEventId] } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.details[0].note, "Real private journal note");
  assert.deepEqual(res.body.details[0].mediaIds, ["media-1"]);
  assert.equal(res.body.media[0].caption, "Kitchen progress");
  assert.equal(res.body.media[0].journalLifeEventId, lifeEventId);
  assert.equal(JSON.stringify(res.body).includes("unrelatedPrivateField"), false);
  assert.equal(sourceDb.queryCount, 0, "cross-project access must use exact document reads only");
});

test("Home media cannot be resolved through a Docksteader Life event", async () => {
  const timeDb = new FakeDb(timeDocs({
    connection: { sourceProjectIds: ["home", "docksteader"] },
    event: { sourceProjectId: "docksteader", sourceRecordId: "media/media-1" },
  }));
  const sourceDb = new FakeDb({
    "media/media-1": {
      projectId: "home",
      storagePath: "projects/home/media/2026-08-18/message/photo.jpg",
      contentType: "image/jpeg",
    },
  });
  let bucketRead = false;
  const handler = createActivityMediaHandler({
    timeDb,
    sourceDb,
    sourceBucket: { file() { bucketRead = true; throw new Error("must not read"); } },
    auth: { verifyIdToken: async () => ({ uid: ownerUid }) },
  });
  const res = response();
  await handler(request({ method: "GET", query: { calendarId, lifeEventId, mediaId: "media-1" } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(bucketRead, false);
});

test("media endpoint fails closed for missing authentication and deleted files", async () => {
  const handler = createActivityMediaHandler({
    timeDb: new FakeDb(timeDocs({ event: { sourceRecordId: "media/media-1" } })),
    sourceDb: new FakeDb({
      "media/media-1": {
        projectId: "home",
        storagePath: "projects/home/media/2026-08-18/message/photo.jpg",
        contentType: "image/jpeg",
      },
    }),
    sourceBucket: { file() { return { exists: async () => [false] }; } },
    auth: { verifyIdToken: async () => ({ uid: ownerUid }) },
  });
  const unauthorized = response();
  await handler(request({ method: "GET", token: "", query: { calendarId, lifeEventId, mediaId: "media-1" } }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const missing = response();
  await handler(request({ method: "GET", query: { calendarId, lifeEventId, mediaId: "media-1" } }), missing);
  assert.equal(missing.statusCode, 404);
  assert.match(String(missing.body), /unavailable/i);
});

test("authorized image bytes are streamed privately without creating a public URL", async () => {
  const bytes = Buffer.from("private-image");
  const handler = createActivityMediaHandler({
    timeDb: new FakeDb(timeDocs({ event: { sourceRecordId: "media/media-1" } })),
    sourceDb: new FakeDb({
      "media/media-1": {
        projectId: "home",
        storagePath: "projects/home/media/2026-08-18/message/photo.jpg",
        contentType: "image/jpeg",
      },
    }),
    sourceBucket: {
      file() {
        return {
          exists: async () => [true],
          getMetadata: async () => [{ contentType: "image/jpeg", size: bytes.length }],
          download: async () => [bytes],
        };
      },
    },
    auth: { verifyIdToken: async () => ({ uid: ownerUid }) },
  });
  const res = response();
  await handler(request({ method: "GET", query: { calendarId, lifeEventId, mediaId: "media-1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.deepEqual(res.body, bytes);
});

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { tokenHash } = require("../functions/src/ingestion/tokens");

const [hostingHost = "127.0.0.1", hostingPort = "5000"] = (process.env.FIREBASE_HOSTING_EMULATOR_HOST
  || process.env.HOSTING_EMULATOR_HOST
  || "127.0.0.1:5000").split(":");
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const basePath = `http://${hostingHost}:${hostingPort}`;
const lifeEventPath = "/api/v1/life-events";
const lifeEventBatchPath = "/api/v1/life-events:batch";
const journalDetailsPath = "/api/activity/journal-details";
const activityMediaPath = "/api/activity/media";
const projectFromFirebaseConfig = process.env.FIREBASE_CONFIG && (() => {
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG).projectId;
  } catch (_error) {
    return undefined;
  }
})();
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaseConfig || "timelefttolive";
const APP_NAME = "hosting-verification";
const connectionId = "connection-hosting";
const ownerUid = "owner-hosting";
const lifeEventCollection = "lifeEvents";

if (!firestoreEmulatorHost) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required for hosting verification; production fallback is disabled.");
}

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = firestoreEmulatorHost.split(":");
let db;
let calendarCounter = 0;

function newCalendarId(prefix = "calendar") {
  calendarCounter += 1;
  return `${prefix}-${Date.now()}-${calendarCounter}`;
}

function nowIso() {
  return new Date().toISOString();
}

function buildCanonicalPayload(calendarId, sourceRecordId, overrides = {}) {
  return {
    calendarId,
    connectionId,
    integrationId: "integration-hosting",
    schemaVersion: 1,
    sourceApp: "aigridline",
    sourceFirebaseProjectId: "project-id",
    sourceProjectId: "project-a",
    sourceRecordId,
    eventType: "arrive_work",
    occurredAt: nowIso(),
    ...overrides
  };
}

function containsTokenInObject(value, token) {
  if (value === token) return true;
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsTokenInObject(item, token));
  }
  if (typeof value === "object") {
    return Object.values(value).some((child) => containsTokenInObject(child, token));
  }
  return false;
}

async function ensureFirebaseDb() {
  if (!db) {
    const existing = (getApps() || []).find((app) => app.name === APP_NAME);
    const app = existing || initializeApp({ projectId: PROJECT_ID }, APP_NAME);
    db = getFirestore(app);
  }
}

async function seedSourceArtifacts(calendarId) {
  const token = `tltl-hosting-${crypto.randomBytes(12).toString("hex")}`;
  const tokenDigest = tokenHash(token);

  await ensureFirebaseDb();
  await db.collection("lifeCalendars").doc(calendarId).set({ ownerUid });
  await db.collection("lifeCalendars").doc(calendarId).collection("sourceConnections").doc(connectionId).set({
    status: "active",
    sourceApp: "aigridline",
    sourceFirebaseProjectId: "project-id",
    sourceProjectIds: ["project-a"],
    permissions: {
      eventClasses: ["activity_boundary", "completed_activity", "project", "location", "system", "achievement"]
    },
    integrationId: "integration-hosting",
    timeLeftUserId: ownerUid
  });
  await db.collection("lifeCalendars").doc(calendarId).collection("sourceConnectionSecrets").doc(connectionId).set({
    tokenHash: tokenDigest,
    tokenVersion: 1,
    tokenStatus: "active"
  });

  return token;
}

async function clearStaleCalendars() {
  await ensureFirebaseDb();
  const snapshots = await db.collection("lifeCalendars").get();
  await Promise.all(snapshots.docs.map((docSnap) => docSnap.ref.delete()));
}

async function countLifeEvents(calendarId) {
  const snapshot = await db
    .collection("lifeCalendars")
    .doc(calendarId)
    .collection(lifeEventCollection)
    .get();
  return snapshot.size;
}

async function getLifeEvent(calendarId, lifeEventId) {
  return db.collection("lifeCalendars").doc(calendarId).collection(lifeEventCollection).doc(lifeEventId).get();
}

async function callHostingApi(route, options = {}) {
  const method = options.method || "POST";
  const response = await fetch(`${basePath}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...(options.body && !["GET", "HEAD"].includes(method.toUpperCase())
      ? { body: JSON.stringify(options.body) }
      : {})
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    payload = {};
  }
  return { status: response.status, payload };
}

async function assertErrorResponse(response, expectedStatus, expectedCode = undefined) {
  assert.equal(response.status, expectedStatus);
  assert.equal(typeof response.payload, "object");
  assert.equal(response.payload.status, "error");
  if (expectedCode) {
    assert.equal(response.payload.code, expectedCode);
  }
}

test.beforeEach(async () => {
  await clearStaleCalendars();
});

test("POST /api/v1/life-events maps through hosting", async () => {
  const calendarId = newCalendarId("maps");
  await seedSourceArtifacts(calendarId);
  const response = await callHostingApi(lifeEventPath, {
    body: buildCanonicalPayload(calendarId, "routing-test")
  });
  await assertErrorResponse(response, 401);
});

test("POST /api/v1/life-events:batch maps through hosting", async () => {
  const calendarId = newCalendarId("batch-maps");
  await seedSourceArtifacts(calendarId);
  const response = await callHostingApi(lifeEventBatchPath, {
    body: {
      calendarId,
      connectionId,
      integrationId: "integration-hosting",
      items: [
        {
          schemaVersion: 1,
          sourceApp: "aigridline",
          sourceFirebaseProjectId: "project-id",
          sourceProjectId: "project-a",
          sourceRecordId: "batch-routing",
          eventType: "arrive_work",
          occurredAt: nowIso()
        }
      ]
    }
  });
  await assertErrorResponse(response, 401);
});

test("non-POST routes return 405", async () => {
  const calendarId = newCalendarId("methods");
  await seedSourceArtifacts(calendarId);
  const single = await callHostingApi(lifeEventPath, {
    method: "GET",
    body: buildCanonicalPayload(calendarId, "method-check")
  });
  const batch = await callHostingApi(lifeEventBatchPath, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer t-lt-token`
    },
    body: {
      calendarId,
      connectionId,
      integrationId: "integration-hosting",
      items: []
    }
  });
  assert.equal(single.status, 405);
  assert.equal(batch.status, 405);
});

test("private activity journal routes map through hosting and fail closed", async () => {
  const detailsWithoutAuth = await callHostingApi(journalDetailsPath, {
    body: { calendarId: "calendar-private", lifeEventIds: ["event-private"] }
  });
  assert.equal(detailsWithoutAuth.status, 401);
  assert.equal(detailsWithoutAuth.payload.code, "unauthenticated");

  const mediaWithoutAuth = await callHostingApi(`${activityMediaPath}?calendarId=calendar-private&lifeEventId=event-private&mediaId=media-private`, {
    method: "GET"
  });
  assert.equal(mediaWithoutAuth.status, 401);

  const wrongDetailsMethod = await callHostingApi(journalDetailsPath, { method: "GET" });
  const wrongMediaMethod = await callHostingApi(activityMediaPath, { method: "POST" });
  assert.equal(wrongDetailsMethod.status, 405);
  assert.equal(wrongMediaMethod.status, 405);
});

test("valid token is required and invalid token fails", async () => {
  const calendarId = newCalendarId("invalid-token");
  await seedSourceArtifacts(calendarId);
  const responseWithoutToken = await callHostingApi(lifeEventPath, {
    body: buildCanonicalPayload(calendarId, "missing-token")
  });
  await assertErrorResponse(responseWithoutToken, 401);

  const responseInvalidToken = await callHostingApi(lifeEventPath, {
    headers: {
      Authorization: "Bearer invalid-token"
    },
    body: buildCanonicalPayload(calendarId, "invalid-token")
  });
  assert.ok([401, 403].includes(responseInvalidToken.status));
});

test("canonical single endpoint authenticates, creates idempotent event", async () => {
  const calendarId = newCalendarId("valid-single");
  const token = await seedSourceArtifacts(calendarId);
  const payload = buildCanonicalPayload(calendarId, "single-record");

  const response = await callHostingApi(lifeEventPath, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: payload
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.status, "success");
  const lifeEventId = response.payload.lifeEventId;
  assert.equal(typeof lifeEventId, "string");
  assert.equal(await countLifeEvents(calendarId), 1);

  const created = await getLifeEvent(calendarId, lifeEventId);
  assert.equal(created.exists, true);
  const event = created.data();
  assert.equal(event.timeLeftUserId, ownerUid);
  assert.equal(containsTokenInObject(event, token), false);

  const replay = await callHostingApi(lifeEventPath, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: payload
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.duplicate, true);
  assert.equal(replay.payload.lifeEventId, lifeEventId);
  assert.equal(await countLifeEvents(calendarId), 1);

  const conflict = await callHostingApi(lifeEventPath, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: {
      ...payload,
      title: "Changed title"
    }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.code, "idempotency_conflict");
  assert.equal(await countLifeEvents(calendarId), 1);
});

test("valid batch stores every valid item", async () => {
  const calendarId = newCalendarId("batch-valid");
  const token = await seedSourceArtifacts(calendarId);

  const response = await callHostingApi(lifeEventBatchPath, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: {
      calendarId,
      connectionId,
      integrationId: "integration-hosting",
      items: [
        buildCanonicalPayload(calendarId, "batch-valid-1", {
          eventType: "arrive_work"
        }),
        {
          schemaVersion: 1,
          sourceApp: "aigridline",
          sourceFirebaseProjectId: "project-id",
          sourceProjectId: "project-a",
          sourceRecordId: "batch-valid-2",
          eventType: "arrive_work",
          occurredAt: nowIso()
        }
      ]
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.status, "success");
  assert.equal(response.payload.failed, 0);
  assert.equal(response.payload.success, 2);
  assert.equal(await countLifeEvents(calendarId), 2);
});

test("partial batch preserves valid entries and rejects invalid entries", async () => {
  const calendarId = newCalendarId("batch-partial");
  const token = await seedSourceArtifacts(calendarId);

  const response = await callHostingApi(lifeEventBatchPath, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: {
      calendarId,
      connectionId,
      integrationId: "integration-hosting",
      items: [
        buildCanonicalPayload(calendarId, "batch-partial-valid", {
          eventType: "arrive_work"
        }),
        {
          schemaVersion: 1,
          sourceApp: "aigridline",
          sourceFirebaseProjectId: "project-id",
          sourceProjectId: "project-a",
          eventType: "arrive_work",
          occurredAt: nowIso()
        }
      ]
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.status, "partial_success");
  assert.equal(response.payload.results.length, 2);
  assert.equal(response.payload.results[0].status, "success");
  assert.equal(response.payload.results[1].status, "error");
  assert.equal(await countLifeEvents(calendarId), 1);
});

console.info(`hosting verification using emulator host ${basePath} and firestore emulator ${firestoreHost}:${firestorePort}`);

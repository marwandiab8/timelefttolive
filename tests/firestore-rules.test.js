const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require("@firebase/rules-unit-testing");
const { deleteDoc, doc, getDoc, setDoc } = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const projectId = "timelefttolive-phase1-verification";
const calendarId = "calendar-phase1";
const connectionId = "connection-phase1";
const ownerUid = "owner-uid";
const otherUid = "other-uid";
const sourceAdminUid = "source-admin-uid";
const lifeEventId = "event-1";

let testEnv;

async function seedFixtures(db) {
  await setDoc(doc(db, "lifeCalendars", calendarId), { ownerUid });
  await setDoc(doc(db, "lifeCalendars", calendarId, "sourceConnections", connectionId), {
    status: "active",
    sourceApp: "aigridline",
    sourceFirebaseProjectId: "project-id",
    sourceProjectIds: ["project-a"],
    integrationId: "integration-connection-phase1"
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "sourceConnectionSecrets", connectionId), {
    tokenHash: "seeded-token-hash"
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "lifeEvents", lifeEventId), {
    ownerUid,
    calendarId,
    timeLeftUserId: ownerUid,
    eventType: "arrive_work",
    sourceApp: "aigridline",
    sourceProjectId: "project-a",
    sourceRecordId: "seeded-record"
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "rawIngestionPayloads", "raw-1"), {
    sourceIdentifier: "existing",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "ingestionDeadLetters", "dead-1"), {
    sourceIdentifier: "existing",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: Number(firestorePort),
      rules: rulesText
    }
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await seedFixtures(context.firestore());
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("owner can read their own LifeEvent", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, "lifeCalendars", calendarId, "lifeEvents", lifeEventId)));
});

test("owner cannot directly create a LifeEvent", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  await assertFails(setDoc(doc(ownerDb, "lifeCalendars", calendarId, "lifeEvents", "new-event"), {
    ownerUid,
    calendarId,
    sourceApp: "aigridline"
  }));
});

test("owner cannot directly update a LifeEvent", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const eventRef = doc(ownerDb, "lifeCalendars", calendarId, "lifeEvents", lifeEventId);
  await assertFails(setDoc(eventRef, { eventType: "updated" }, { merge: true }));
});

test("owner cannot directly delete a LifeEvent unless approved by rules", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const eventRef = doc(ownerDb, "lifeCalendars", calendarId, "lifeEvents", lifeEventId);
  await assertFails(deleteDoc(eventRef));
});

test("different user cannot read LifeEvent", async () => {
  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertFails(getDoc(doc(otherDb, "lifeCalendars", calendarId, "lifeEvents", lifeEventId)));
});

test("source-project administrator cannot access personal timeline by role alone", async () => {
  const sourceAdminDb = testEnv
    .authenticatedContext(sourceAdminUid, {
      sourceApp: "aigridline",
      sourceProjectId: "project-a",
      role: "source-admin"
    })
    .firestore();
  await assertFails(getDoc(doc(sourceAdminDb, "lifeCalendars", calendarId, "lifeEvents", lifeEventId)));
});

test("unauthenticated clients cannot read LifeEvents", async () => {
  const publicDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(publicDb, "lifeCalendars", calendarId, "lifeEvents", lifeEventId)));
});

test("clients cannot read rawIngestionPayloads", async () => {
  const publicDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(publicDb, "lifeCalendars", calendarId, "rawIngestionPayloads", "raw-1")));
});

test("clients cannot write rawIngestionPayloads", async () => {
  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertFails(setDoc(doc(otherDb, "lifeCalendars", calendarId, "rawIngestionPayloads", "raw-2"), {
    ownerUid,
    expiresAt: new Date()
  }));
});

test("clients cannot read sourceConnectionSecrets", async () => {
  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertFails(getDoc(doc(otherDb, "lifeCalendars", calendarId, "sourceConnectionSecrets", connectionId)));
});

test("clients cannot write sourceConnectionSecrets", async () => {
  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertFails(setDoc(doc(otherDb, "lifeCalendars", calendarId, "sourceConnectionSecrets", "conn-2"), {
    tokenHash: "nope"
  }));
});

test("ingestion dead letters are client-inaccessible", async () => {
  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertFails(getDoc(doc(otherDb, "lifeCalendars", calendarId, "ingestionDeadLetters", "dead-1")));
  await assertFails(setDoc(doc(otherDb, "lifeCalendars", calendarId, "ingestionDeadLetters", "dead-2"), {
    reason: "bad"
  }));
});

test("existing owner behavior still works outside new collections", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const sourceConnectionRef = doc(ownerDb, "lifeCalendars", calendarId, "sourceConnections", connectionId);
  const connectionSnap = await assertSucceeds(getDoc(sourceConnectionRef));
  assert.equal(connectionSnap.exists(), true);
  assert.equal(connectionSnap.data().sourceProjectIds.includes("project-a"), true);
});

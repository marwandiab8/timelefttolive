const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require("@firebase/rules-unit-testing");
const {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where
} = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const projectId = "timelefttolive-viewer-rules-verification";
const calendarId = "calendar-sharing";
const ownerUid = "owner-uid";
const viewerUid = "viewer-uid";
const strangerUid = "stranger-uid";
const viewerEmail = "viewer@example.com";
const pendingEmail = "pending@example.com";

let testEnv;

function viewerContext(uid = viewerUid, email = viewerEmail, verified = true) {
  return testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}

async function seedFixtures(db) {
  await setDoc(doc(db, "lifeCalendars", calendarId), { ownerUid, firstName: "Owner" });
  await setDoc(doc(db, "lifeCalendars", calendarId, "viewers", viewerEmail), {
    uid: viewerUid,
    email: viewerEmail,
    role: "viewer",
    status: "accepted"
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "viewers", pendingEmail), {
    uid: "",
    email: pendingEmail,
    role: "viewer",
    status: "pending",
    acceptedAt: null
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "events", "shared-event"), { title: "Shared", visibility: "viewers" });
  await setDoc(doc(db, "lifeCalendars", calendarId, "events", "private-event"), { title: "Private", visibility: "ownerOnly" });
  await setDoc(doc(db, "lifeCalendars", calendarId, "dailyEntries", "2026-01-01"), { dateId: "2026-01-01", visibility: "viewers" });
  await setDoc(doc(db, "lifeCalendars", calendarId, "dailyEntries", "2026-01-02"), { dateId: "2026-01-02", visibility: "ownerOnly" });
  await setDoc(doc(db, "lifeCalendars", calendarId, "lifeEvents", "event-1"), { ownerUid, calendarId });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: firestoreHost, port: Number(firestorePort), rules: rulesText }
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

// --- Owner ---------------------------------------------------------------

test("owner can create, read, and delete viewer invites", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const inviteRef = doc(ownerDb, "lifeCalendars", calendarId, "viewers", "new@example.com");
  await assertSucceeds(setDoc(inviteRef, { uid: "", email: "new@example.com", role: "viewer", status: "pending" }));
  await assertSucceeds(getDoc(inviteRef));
  await assertSucceeds(deleteDoc(inviteRef));
});

test("owner can read owner-only events and daily entries", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, "lifeCalendars", calendarId, "events", "private-event")));
  await assertSucceeds(getDoc(doc(ownerDb, "lifeCalendars", calendarId, "dailyEntries", "2026-01-02")));
});

// --- Accepted viewer -----------------------------------------------------

test("accepted viewer with a verified email can read the calendar and viewer-visible data", async () => {
  const db = viewerContext();
  await assertSucceeds(getDoc(doc(db, "lifeCalendars", calendarId)));
  await assertSucceeds(getDoc(doc(db, "lifeCalendars", calendarId, "events", "shared-event")));
  await assertSucceeds(getDoc(doc(db, "lifeCalendars", calendarId, "dailyEntries", "2026-01-01")));
});

test("accepted viewer can run the filtered queries the app uses", async () => {
  const db = viewerContext();
  await assertSucceeds(getDocs(query(
    collection(db, "lifeCalendars", calendarId, "events"),
    where("visibility", "==", "viewers")
  )));
  await assertSucceeds(getDocs(query(
    collection(db, "lifeCalendars", calendarId, "dailyEntries"),
    where("visibility", "==", "viewers")
  )));
});

test("accepted viewer cannot read owner-only events or daily entries", async () => {
  const db = viewerContext();
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "events", "private-event")));
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "dailyEntries", "2026-01-02")));
  await assertFails(getDocs(collection(db, "lifeCalendars", calendarId, "events")));
});

test("accepted viewer cannot write events, entries, or the calendar", async () => {
  const db = viewerContext();
  await assertFails(setDoc(doc(db, "lifeCalendars", calendarId, "events", "shared-event"), { title: "Edited", visibility: "viewers" }));
  await assertFails(setDoc(doc(db, "lifeCalendars", calendarId, "dailyEntries", "2026-01-01"), { visibility: "viewers" }));
  await assertFails(updateDoc(doc(db, "lifeCalendars", calendarId), { firstName: "Hijacked" }));
});

test("accepted viewer cannot read activity data, connections, or the viewer list", async () => {
  const db = viewerContext();
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "lifeEvents", "event-1")));
  await assertFails(getDocs(collection(db, "lifeCalendars", calendarId, "sourceConnections")));
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "viewers", pendingEmail)));
});

test("accepted viewer cannot promote or re-point their own invite", async () => {
  const db = viewerContext();
  await assertFails(updateDoc(doc(db, "lifeCalendars", calendarId, "viewers", viewerEmail), { role: "owner" }));
  await assertFails(deleteDoc(doc(db, "lifeCalendars", calendarId, "viewers", viewerEmail)));
});

test("accepted viewer whose email is not verified gets no access", async () => {
  const db = viewerContext(strangerUid, viewerEmail, false);
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId)));
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "events", "shared-event")));
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "dailyEntries", "2026-01-01")));
});

test("user with no invite cannot read anything in the calendar", async () => {
  const db = viewerContext(strangerUid, "stranger@example.com", true);
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId)));
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "events", "shared-event")));
});

test("pending invite grants no calendar access until accepted", async () => {
  const db = viewerContext("pending-uid", pendingEmail, true);
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId)));
  await assertFails(getDoc(doc(db, "lifeCalendars", calendarId, "events", "shared-event")));
});

// --- Invite acceptance ---------------------------------------------------

test("invitee with a verified email can accept a pending invite", async () => {
  const db = viewerContext("pending-uid", pendingEmail, true);
  await assertSucceeds(updateDoc(doc(db, "lifeCalendars", calendarId, "viewers", pendingEmail), {
    uid: "pending-uid",
    status: "accepted",
    acceptedAt: new Date()
  }));
});

test("invitee with an unverified email cannot accept a pending invite", async () => {
  const db = viewerContext("attacker-uid", pendingEmail, false);
  await assertFails(updateDoc(doc(db, "lifeCalendars", calendarId, "viewers", pendingEmail), {
    uid: "attacker-uid",
    status: "accepted",
    acceptedAt: new Date()
  }));
});

test("invitee cannot accept an invite addressed to a different email", async () => {
  const db = viewerContext("stranger-uid", "stranger@example.com", true);
  await assertFails(updateDoc(doc(db, "lifeCalendars", calendarId, "viewers", pendingEmail), {
    uid: "stranger-uid",
    status: "accepted",
    acceptedAt: new Date()
  }));
});

test("invitee cannot change the role or email while accepting", async () => {
  const db = viewerContext("pending-uid", pendingEmail, true);
  const ref = doc(db, "lifeCalendars", calendarId, "viewers", pendingEmail);
  await assertFails(updateDoc(ref, { uid: "pending-uid", status: "accepted", acceptedAt: new Date(), role: "owner" }));
  await assertFails(updateDoc(ref, { uid: "someone-else", status: "accepted", acceptedAt: new Date() }));
});

// --- Invite discovery (collectionGroup query used by useViewerInvites) ---

test("invitee can find their own invites with the collection-group query", async () => {
  const db = viewerContext("pending-uid", pendingEmail, true);
  await assertSucceeds(getDocs(query(
    collectionGroup(db, "viewers"),
    where("email", "==", pendingEmail),
    // matches useViewerInvites in src/hooks/useCalendar.js
  )));
});

test("collection-group query cannot list other people's invites", async () => {
  const db = viewerContext("pending-uid", pendingEmail, true);
  await assertFails(getDocs(collectionGroup(db, "viewers")));
  await assertFails(getDocs(query(collectionGroup(db, "viewers"), where("email", "==", viewerEmail))));
});

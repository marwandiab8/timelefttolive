const assert = require("node:assert/strict");
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
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where
} = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const calendarId = "calendar-linked";
const otherCalendarId = "calendar-other";
const ownerUid = "owner-uid";
const otherOwnerUid = "other-owner-uid";
const viewerEmail = "viewer@example.com";

let testEnv;

function itemsPath(calendar, dateId) {
  return ["lifeCalendars", calendar, "dailyEntries", dateId, "externalItems"];
}

async function seedFixtures(db) {
  await setDoc(doc(db, "lifeCalendars", calendarId), { ownerUid });
  await setDoc(doc(db, "lifeCalendars", otherCalendarId), { ownerUid: otherOwnerUid });
  await setDoc(doc(db, "lifeCalendars", calendarId, "viewers", viewerEmail), {
    uid: "viewer-uid", email: viewerEmail, role: "viewer", status: "accepted"
  });
  await setDoc(doc(db, "lifeCalendars", calendarId, "viewers", "pending@example.com"), {
    uid: "", email: "pending@example.com", role: "viewer", status: "pending"
  });
  await setDoc(doc(db, ...itemsPath(calendarId, "2026-09-20"), "private-1"), {
    ownerUid, calendarId, dateId: "2026-09-20", visibility: "ownerOnly", title: "Private"
  });
  await setDoc(doc(db, ...itemsPath(calendarId, "2026-09-19"), "shared-1"), {
    ownerUid, calendarId, dateId: "2026-09-19", visibility: "viewers", title: "Shared"
  });
  await setDoc(doc(db, ...itemsPath(otherCalendarId, "2026-09-20"), "theirs-1"), {
    ownerUid: otherOwnerUid, calendarId: otherCalendarId, dateId: "2026-09-20", visibility: "ownerOnly", title: "Theirs"
  });
}

// The same constraints as useRangeExternalItems in src/services/externalSources/externalDailyItems.js.
function rangeQuery(db, { role, ownerUidFilter, calendar = calendarId }) {
  const constraints = [
    where("calendarId", "==", calendar),
    where("dateId", ">=", "2026-09-15"),
    where("dateId", "<=", "2026-09-21"),
    orderBy("dateId", "asc")
  ];
  if (role === "owner" && ownerUidFilter) constraints.unshift(where("ownerUid", "==", ownerUidFilter));
  if (role !== "owner") constraints.push(where("visibility", "==", "viewers"));
  return query(collectionGroup(db, "externalItems"), ...constraints);
}

const asUser = (uid, email, verified = true) => testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore();

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "timelefttolive-external-items-verification",
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

// --- The week, month and year views' range query ---------------------------

test("the owner can run the range query the week view makes, and gets every linked item", async () => {
  const db = asUser(ownerUid, "owner@example.com");
  const snapshot = await assertSucceeds(getDocs(rangeQuery(db, { role: "owner", ownerUidFilter: ownerUid })));
  assert.deepEqual(snapshot.docs.map((item) => item.id).sort(), ["private-1", "shared-1"]);
});

test("the owner's range query does not return another calendar's items", async () => {
  const db = asUser(ownerUid, "owner@example.com");
  const snapshot = await assertSucceeds(getDocs(rangeQuery(db, { role: "owner", ownerUidFilter: ownerUid, calendar: otherCalendarId })));
  assert.equal(snapshot.size, 0);
});

test("someone else cannot read the owner's items by naming the owner in the query", async () => {
  const db = asUser(otherOwnerUid, "other@example.com");
  await assertFails(getDocs(rangeQuery(db, { role: "owner", ownerUidFilter: ownerUid })));
});

test("a range query that does not pin the owner is refused, even for the owner", async () => {
  const db = asUser(ownerUid, "owner@example.com");
  await assertFails(getDocs(rangeQuery(db, { role: "owner", ownerUidFilter: "" })));
});

test("a signed-out client cannot run the range query", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDocs(rangeQuery(db, { role: "owner", ownerUidFilter: ownerUid })));
});

test("an accepted viewer with a verified email gets only the items shared with viewers", async () => {
  const db = asUser("viewer-uid", viewerEmail, true);
  const snapshot = await assertSucceeds(getDocs(rangeQuery(db, { role: "viewer" })));
  assert.deepEqual(snapshot.docs.map((item) => item.id), ["shared-1"]);
});

test("a viewer cannot leave out the visibility filter and see owner-only items", async () => {
  const db = asUser("viewer-uid", viewerEmail, true);
  const noVisibility = query(
    collectionGroup(db, "externalItems"),
    where("calendarId", "==", calendarId),
    where("dateId", ">=", "2026-09-15"),
    where("dateId", "<=", "2026-09-21"),
    orderBy("dateId", "asc")
  );
  await assertFails(getDocs(noVisibility));
});

test("a viewer whose email is not verified gets nothing", async () => {
  const db = asUser("viewer-uid", viewerEmail, false);
  await assertFails(getDocs(rangeQuery(db, { role: "viewer" })));
});

test("an invite that has not been accepted gives no access to linked items", async () => {
  const db = asUser("pending-uid", "pending@example.com", true);
  await assertFails(getDocs(rangeQuery(db, { role: "viewer" })));
});

test("a stranger cannot run the viewer query for someone else's calendar", async () => {
  const db = asUser("stranger-uid", "stranger@example.com", true);
  await assertFails(getDocs(rangeQuery(db, { role: "viewer" })));
});

// --- Single reads keep working exactly as before ---------------------------

test("the day view's direct reads are unchanged", async () => {
  const ownerDb = asUser(ownerUid, "owner@example.com");
  await assertSucceeds(getDocs(collection(ownerDb, ...itemsPath(calendarId, "2026-09-20"))));
  const viewerDb = asUser("viewer-uid", viewerEmail, true);
  await assertSucceeds(getDoc(doc(viewerDb, ...itemsPath(calendarId, "2026-09-19"), "shared-1")));
  await assertFails(getDoc(doc(viewerDb, ...itemsPath(calendarId, "2026-09-20"), "private-1")));
});

test("nobody can write a linked item through a collection-group rule", async () => {
  const db = asUser(ownerUid, "owner@example.com");
  // The owner writes through the calendar's own path (allowed by the nested rule); a stranger cannot.
  await assertSucceeds(setDoc(doc(db, ...itemsPath(calendarId, "2026-09-21"), "new-1"), {
    ownerUid, calendarId, dateId: "2026-09-21", visibility: "ownerOnly", title: "New"
  }));
  const stranger = asUser("stranger-uid", "stranger@example.com", true);
  await assertFails(setDoc(doc(stranger, ...itemsPath(calendarId, "2026-09-21"), "evil-1"), {
    ownerUid: "stranger-uid", calendarId, dateId: "2026-09-21", visibility: "viewers", title: "Evil"
  }));
});

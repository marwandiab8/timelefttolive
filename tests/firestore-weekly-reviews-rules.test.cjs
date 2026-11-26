const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const projectId = "timelefttolive-weekly-reviews-rules";
const calendarId = "calendar-reviews";
const ownerUid = "owner-uid";
const viewerUid = "viewer-uid";
const viewerEmail = "viewer@example.com";

let testEnv;

const review = (weekStart, fields = {}) => ({
  weekStart,
  weekEnd: weekStart,
  rating: 4,
  mattered: "Wings with the boys",
  moment: "",
  intention: "Gym three times",
  intentionKept: null,
  numbers: { trackedSeconds: 3600 },
  visibility: "ownerOnly",
  ...fields
});

const ownerDb = () => testEnv.authenticatedContext(ownerUid).firestore();
const viewerDb = (verified = true) => testEnv.authenticatedContext(viewerUid, { email: viewerEmail, email_verified: verified }).firestore();
const reviewRef = (db, weekStart) => doc(db, "lifeCalendars", calendarId, "weeklyReviews", weekStart);

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: firestoreHost, port: Number(firestorePort), rules: rulesText }
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "lifeCalendars", calendarId), { ownerUid, firstName: "Owner" });
    await setDoc(doc(db, "lifeCalendars", calendarId, "viewers", viewerEmail), { uid: viewerUid, email: viewerEmail, role: "viewer", status: "accepted" });
    await setDoc(reviewRef(db, "2026-11-12"), review("2026-11-12"));
    await setDoc(reviewRef(db, "2026-11-19"), review("2026-11-19", { visibility: "viewers" }));
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("owner can write, read, list and delete reviews", async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26")));
  await assertSucceeds(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26", { rating: null, visibility: "viewers" })));
  await assertSucceeds(getDoc(reviewRef(db, "2026-11-12")));
  await assertSucceeds(getDocs(collection(db, "lifeCalendars", calendarId, "weeklyReviews")));
  await assertSucceeds(deleteDoc(reviewRef(db, "2026-11-26")));
});

test("a review must be filed under its own week, with a known visibility and a 1 to 5 rating", async () => {
  const db = ownerDb();
  await assertFails(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-19")));
  await assertFails(setDoc(reviewRef(db, "not-a-date"), review("not-a-date")));
  await assertFails(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26", { visibility: "public" })));
  await assertFails(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26", { rating: 6 })));
  await assertFails(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26", { rating: 0 })));
  await assertFails(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26", { rating: "4" })));
});

test("an accepted viewer reads only reviews shared with viewers", async () => {
  const db = viewerDb();
  await assertSucceeds(getDoc(reviewRef(db, "2026-11-19")));
  await assertFails(getDoc(reviewRef(db, "2026-11-12")));
  await assertSucceeds(getDocs(query(collection(db, "lifeCalendars", calendarId, "weeklyReviews"), where("visibility", "==", "viewers"))));
  await assertFails(getDocs(collection(db, "lifeCalendars", calendarId, "weeklyReviews")));
});

test("an accepted viewer cannot write or delete reviews", async () => {
  const db = viewerDb();
  await assertFails(setDoc(reviewRef(db, "2026-11-26"), review("2026-11-26", { visibility: "viewers" })));
  await assertFails(setDoc(reviewRef(db, "2026-11-19"), review("2026-11-19", { visibility: "viewers", rating: 1 })));
  await assertFails(deleteDoc(reviewRef(db, "2026-11-19")));
});

test("a viewer with an unverified email, or a stranger, reads nothing", async () => {
  await assertFails(getDoc(reviewRef(viewerDb(false), "2026-11-19")));
  const stranger = testEnv.authenticatedContext("stranger-uid", { email: "x@example.com", email_verified: true }).firestore();
  await assertFails(getDoc(reviewRef(stranger, "2026-11-19")));
  await assertFails(getDoc(reviewRef(testEnv.unauthenticatedContext().firestore(), "2026-11-19")));
});

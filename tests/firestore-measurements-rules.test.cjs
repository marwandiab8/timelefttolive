const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const projectId = "timelefttolive-measurements-rules";
const calendarId = "calendar-measurements";
const ownerUid = "owner-uid";
const viewerUid = "viewer-uid";
const viewerEmail = "viewer@example.com";

let testEnv;
const measurement = (fields = {}) => ({
  childId: "child-a",
  kind: "height",
  measuredOn: "2026-11-23",
  valueMm: 1803,
  asWritten: "5' 11\"",
  needsCheck: false,
  note: "",
  visibility: "ownerOnly",
  source: "manual",
  ...fields
});

const ownerDb = () => testEnv.authenticatedContext(ownerUid).firestore();
const viewerDb = (verified = true) => testEnv.authenticatedContext(viewerUid, { email: viewerEmail, email_verified: verified }).firestore();
const measurementRef = (db, id) => doc(db, "lifeCalendars", calendarId, "childMeasurements", id);
const measurementsRef = (db) => collection(db, "lifeCalendars", calendarId, "childMeasurements");

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
    await setDoc(measurementRef(db, "private"), measurement());
    await setDoc(measurementRef(db, "shared"), measurement({ visibility: "viewers" }));
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("owner can add, correct, list and delete measurements, including one kept as written", async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(measurementRef(db, "new"), measurement()));
  await assertSucceeds(setDoc(measurementRef(db, "new"), measurement({ valueMm: null, asWritten: "5' 10 9/8\"", needsCheck: true })));
  await assertSucceeds(getDocs(measurementsRef(db)));
  await assertSucceeds(deleteDoc(measurementRef(db, "new")));
});

test("a measurement needs a child, a known kind, a date, a known visibility and a sensible value", async () => {
  const db = ownerDb();
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ childId: null })));
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ kind: "mood" })));
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ measuredOn: "Nov 23" })));
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ visibility: "public" })));
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ valueMm: 0 })));
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ valueMm: 4000 })));
  await assertFails(setDoc(measurementRef(db, "bad"), measurement({ valueMm: "1803" })));
});

test("an accepted viewer reads only shared measurements and writes nothing", async () => {
  const db = viewerDb();
  await assertSucceeds(getDoc(measurementRef(db, "shared")));
  await assertFails(getDoc(measurementRef(db, "private")));
  await assertSucceeds(getDocs(query(measurementsRef(db), where("visibility", "==", "viewers"))));
  await assertFails(getDocs(measurementsRef(db)));
  await assertFails(setDoc(measurementRef(db, "shared"), measurement({ visibility: "viewers", valueMm: 1000 })));
  await assertFails(deleteDoc(measurementRef(db, "shared")));
});

test("an unverified viewer, a stranger and a signed-out visitor read nothing", async () => {
  await assertFails(getDoc(measurementRef(viewerDb(false), "shared")));
  const stranger = testEnv.authenticatedContext("stranger-uid", { email: "x@example.com", email_verified: true }).firestore();
  await assertFails(getDoc(measurementRef(stranger, "shared")));
  await assertFails(getDoc(measurementRef(testEnv.unauthenticatedContext().firestore(), "shared")));
});

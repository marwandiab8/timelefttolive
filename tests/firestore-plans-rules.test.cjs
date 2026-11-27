const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const projectId = "timelefttolive-plans-rules";
const calendarId = "calendar-plans";
const ownerUid = "owner-uid";
const viewerUid = "viewer-uid";
const viewerEmail = "viewer@example.com";

let testEnv;
const plan = (fields = {}) => ({
  title: "Cottage weekend",
  notes: "",
  who: ["child-a"],
  deadline: { kind: "season", season: "summer", year: 2027 },
  plannedWeekStart: "",
  doneOn: "",
  visibility: "ownerOnly",
  ...fields
});

const ownerDb = () => testEnv.authenticatedContext(ownerUid).firestore();
const viewerDb = (verified = true) => testEnv.authenticatedContext(viewerUid, { email: viewerEmail, email_verified: verified }).firestore();
const planRef = (db, id) => doc(db, "lifeCalendars", calendarId, "plans", id);
const plansRef = (db) => collection(db, "lifeCalendars", calendarId, "plans");

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
    await setDoc(planRef(db, "private"), plan());
    await setDoc(planRef(db, "shared"), plan({ visibility: "viewers" }));
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("owner can add, mark done, list and delete plans", async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(planRef(db, "new"), plan()));
  await assertSucceeds(setDoc(planRef(db, "new"), plan({ doneOn: "2026-11-26" })));
  await assertSucceeds(getDocs(plansRef(db)));
  await assertSucceeds(deleteDoc(planRef(db, "new")));
});

test("a plan needs a title of up to 200 characters, a list of people and a known visibility", async () => {
  const db = ownerDb();
  await assertFails(setDoc(planRef(db, "bad"), plan({ title: "" })));
  await assertFails(setDoc(planRef(db, "bad"), plan({ title: "x".repeat(201) })));
  await assertFails(setDoc(planRef(db, "bad"), plan({ who: "child-a" })));
  await assertFails(setDoc(planRef(db, "bad"), plan({ visibility: "public" })));
});

test("an accepted viewer reads only shared plans and writes nothing", async () => {
  const db = viewerDb();
  await assertSucceeds(getDoc(planRef(db, "shared")));
  await assertFails(getDoc(planRef(db, "private")));
  await assertSucceeds(getDocs(query(plansRef(db), where("visibility", "==", "viewers"))));
  await assertFails(getDocs(plansRef(db)));
  await assertFails(setDoc(planRef(db, "shared"), plan({ visibility: "viewers", doneOn: "2026-11-26" })));
  await assertFails(deleteDoc(planRef(db, "shared")));
});

test("an unverified viewer, a stranger and a signed-out visitor read nothing", async () => {
  await assertFails(getDoc(planRef(viewerDb(false), "shared")));
  const stranger = testEnv.authenticatedContext("stranger-uid", { email: "x@example.com", email_verified: true }).firestore();
  await assertFails(getDoc(planRef(stranger, "shared")));
  await assertFails(getDoc(planRef(testEnv.unauthenticatedContext().firestore(), "shared")));
});

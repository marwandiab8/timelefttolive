const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } = require("firebase/firestore");

const [firestoreHost = "127.0.0.1", firestorePort = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const rulesText = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const projectId = "timelefttolive-digest-rules";
const calendarId = "calendar-digest";
const ownerUid = "owner-uid";
const viewerUid = "viewer-uid";
const viewerEmail = "viewer@example.com";

let testEnv;
const ownerDb = () => testEnv.authenticatedContext(ownerUid).firestore();
const viewerDb = () => testEnv.authenticatedContext(viewerUid, { email: viewerEmail, email_verified: true }).firestore();
const settingsRef = (db, id = "owner") => doc(db, "lifeCalendars", calendarId, "digestSettings", id);
const tokenRef = (db, id = "device-1") => doc(db, "lifeCalendars", calendarId, "pushTokens", id);
const switches = (fields = {}) => ({ enabled: true, push: true, email: false, updatedAt: serverTimestamp(), ...fields });
const token = (fields = {}) => ({ token: "fcm-token", uid: ownerUid, platform: "iPhone", createdAt: serverTimestamp(), ...fields });

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
    await setDoc(settingsRef(db), { enabled: true, push: true, email: true, lastSentWeekEnd: "2026-11-29", lastResult: { email: { sent: true } } });
    await setDoc(tokenRef(db), { token: "fcm-token", uid: ownerUid, platform: "iPhone" });
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("the owner turns the digest on and off, and can't write the send results", async () => {
  const db = ownerDb();
  await assertSucceeds(getDoc(settingsRef(db)));
  await assertSucceeds(setDoc(settingsRef(db), switches({ email: false }), { merge: true }));
  await assertFails(setDoc(settingsRef(db), { ...switches(), lastSentWeekEnd: "2026-12-06" }, { merge: true }));
  await assertFails(setDoc(settingsRef(db), switches({ push: "yes" }), { merge: true }));
  await assertFails(setDoc(settingsRef(db, "other"), switches()));
  await assertFails(deleteDoc(settingsRef(db)));
});

test("the owner adds and removes a device; a token must be theirs and well formed", async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(tokenRef(db, "device-2"), token()));
  await assertSucceeds(getDocs(collection(db, "lifeCalendars", calendarId, "pushTokens")));
  await assertSucceeds(deleteDoc(tokenRef(db, "device-2")));
  await assertFails(setDoc(tokenRef(db, "device-3"), token({ uid: "someone-else" })));
  await assertFails(setDoc(tokenRef(db, "device-3"), token({ token: "" })));
  await assertFails(setDoc(tokenRef(db, "device-3"), token({ extra: true })));
});

test("an accepted viewer can't read or write the digest settings or devices", async () => {
  const db = viewerDb();
  await assertFails(getDoc(settingsRef(db)));
  await assertFails(setDoc(settingsRef(db), switches(), { merge: true }));
  await assertFails(getDoc(tokenRef(db)));
  await assertFails(getDocs(collection(db, "lifeCalendars", calendarId, "pushTokens")));
  await assertFails(setDoc(tokenRef(db, "viewer-device"), token({ uid: viewerUid })));
  await assertFails(deleteDoc(tokenRef(db)));
});

test("a stranger and a signed-out visitor read nothing", async () => {
  const stranger = testEnv.authenticatedContext("stranger-uid", { email: "x@example.com", email_verified: true }).firestore();
  await assertFails(getDoc(settingsRef(stranger)));
  await assertFails(getDoc(tokenRef(stranger)));
  await assertFails(getDoc(settingsRef(testEnv.unauthenticatedContext().firestore())));
});

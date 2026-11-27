const assert = require("node:assert/strict");
const test = require("node:test");
const { Timestamp } = require("firebase-admin/firestore");
const { runWeeklyDigests, handleDigestCall, shiftDateId } = require("./weeklyDigest");

// A small Firestore stand-in: documents by path, collections with where (==, <, <=, >=), orderBy, get, set and delete.
function fakeDb(seed) {
  const store = new Map(Object.entries(seed));
  const compare = (left, right) => {
    const value = (item) => (item && typeof item.toMillis === "function" ? item.toMillis() : item);
    const a = value(left);
    const b = value(right);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    collection: (name) => collectionRef(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (value, options) => store.set(path, options?.merge ? { ...(store.get(path) || {}), ...value } : value),
    delete: async () => store.delete(path)
  });
  const snapshot = (path) => ({ id: path.split("/").pop(), ref: docRef(path), exists: store.has(path), data: () => store.get(path) });
  const collectionRef = (path, filters = []) => ({
    doc: (id) => docRef(`${path}/${id}`),
    where: (field, op, value) => collectionRef(path, [...filters, { field, op, value }]),
    orderBy: () => collectionRef(path, filters),
    get: async () => {
      const prefix = `${path}/`;
      const paths = [...store.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/")).sort();
      const matches = paths.filter((key) => filters.every(({ field, op, value }) => {
        const order = compare(store.get(key)[field], value);
        return op === "==" ? order === 0 : op === "<" ? order < 0 : op === "<=" ? order <= 0 : op === ">=" ? order >= 0 : false;
      }));
      return { docs: matches.map(snapshot) };
    }
  });
  return { store, collection: (name) => collectionRef(name) };
}

const ts = (iso) => Timestamp.fromDate(new Date(iso));
// Sunday Nov 29, 2026 at 7 pm in Toronto.
const sundayEvening = new Date("2026-11-30T00:00:00Z");

function seed(settings = { enabled: true, push: true, email: true }) {
  return {
    "lifeCalendars/cal-1": {
      ownerUid: "owner-1",
      birthDate: "1975-02-24",
      children: [{ id: "d", name: "David", birthDate: "2012-01-10" }],
      custodySchedule: { enabled: true, nextStartDate: "2026-11-22", cycleWeeks: 2, withParentWeeks: 1, childIds: ["d"] }
    },
    "lifeCalendars/cal-1/digestSettings/owner": settings,
    "lifeCalendars/cal-1/pushTokens/phone": { token: "token-phone", uid: "owner-1" },
    "lifeCalendars/cal-1/pushTokens/old": { token: "token-old", uid: "owner-1" },
    "lifeCalendars/cal-1/dailyEntries/2026-11-28": { dateId: "2026-11-28", notes: "7:24 PM: Pancakes and a long walk", visibility: "ownerOnly" },
    "lifeCalendars/cal-1/dailyEntries/2026-12-01": { dateId: "2026-12-01", notes: "Not this week", visibility: "ownerOnly" },
    "lifeCalendars/cal-1/lifeEvents/sleep-1": {
      sourceRecordId: "sleep-1", sourceApp: "gridlineai", eventType: "sleep_session", eventClass: "activity_boundary", activityFamily: "sleep",
      categoryId: "sleep", title: "Slept", occurredAt: ts("2026-11-24T03:00:00Z"), startAt: ts("2026-11-24T03:00:00Z"), endAt: ts("2026-11-24T11:00:00Z"),
      metrics: { totalSleepHours: 7.5 }
    },
    "lifeCalendars/cal-1/plans/p1": { title: "Skating", who: ["d"], plannedWeekStart: "2026-12-06", visibility: "ownerOnly" },
    "lifeCalendars/cal-2": { ownerUid: "someone-else", birthDate: "1980-01-01" }
  };
}

function services(db, { mailOk = true, verified = true } = {}) {
  const sentPush = [];
  const sentMail = [];
  return {
    db,
    sentPush,
    sentMail,
    auth: { getUser: async () => ({ email: "owner@example.test", emailVerified: verified }) },
    messaging: {
      sendEach: async (messages) => {
        sentPush.push(...messages);
        return {
          successCount: messages.filter((message) => message.token !== "token-old").length,
          failureCount: messages.filter((message) => message.token === "token-old").length,
          responses: messages.map((message) => (message.token === "token-old"
            ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
            : { success: true }))
        };
      }
    },
    sendMail: mailOk ? async (message) => { sentMail.push(message); } : null,
    appUrl: "https://example.test"
  };
}

test("shiftDateId moves across months", () => {
  assert.equal(shiftDateId("2026-12-01", -6), "2026-11-25");
});

test("Sunday evening sends the week once, by notification and email, and drops a dead device", async () => {
  const db = fakeDb(seed());
  const deps = services(db);
  const totals = await runWeeklyDigests({ ...deps, now: sundayEvening });
  assert.deepEqual(totals, { calendars: 2, sent: 1, skipped: 1, failed: 0 });

  assert.equal(deps.sentPush.length, 2);
  const push = deps.sentPush[0].webpush.data;
  assert.equal(push.title, "Your week, Nov 23 to Nov 29");
  assert.match(push.body, /^6 days with the boys · 8h tracked\. Next week: with you Sun\.$/);
  assert.doesNotMatch(push.body, /Pancakes/);
  assert.equal(push.url, "https://example.test/#digest");
  assert.equal(db.store.has("lifeCalendars/cal-1/pushTokens/old"), false);
  assert.equal(db.store.has("lifeCalendars/cal-1/pushTokens/phone"), true);

  assert.equal(deps.sentMail.length, 1);
  assert.equal(deps.sentMail[0].to, "owner@example.test");
  assert.equal(deps.sentMail[0].subject, "Your week, Nov 23 to Nov 29");
  assert.match(deps.sentMail[0].text, /Pancakes and a long walk/);
  assert.doesNotMatch(deps.sentMail[0].text, /Not this week/);
  assert.match(deps.sentMail[0].text, /Skating: Planned for your time with them next week/);

  const settings = db.store.get("lifeCalendars/cal-1/digestSettings/owner");
  assert.equal(settings.lastSentWeekEnd, "2026-11-29");
  assert.deepEqual(settings.lastResult, { push: { sent: 1, failed: 1, removed: 1 }, email: { sent: true } });

  // A second run the same evening (a retry) sends nothing.
  const again = await runWeeklyDigests({ ...deps, now: new Date("2026-11-30T00:30:00Z") });
  assert.equal(again.sent, 0);
  assert.equal(deps.sentMail.length, 1);
});

test("nothing is sent while the digest is off, or with no channel chosen", async () => {
  for (const settings of [{ enabled: false, push: true, email: true }, { enabled: true, push: false, email: false }]) {
    const db = fakeDb(seed(settings));
    const deps = services(db);
    const totals = await runWeeklyDigests({ ...deps, now: sundayEvening });
    assert.equal(totals.sent, 0);
    assert.equal(deps.sentPush.length + deps.sentMail.length, 0);
  }
});

test("each channel reports its own problem instead of stopping the other", async () => {
  const db = fakeDb(seed({ enabled: true, push: true, email: true }));
  const deps = services(db, { mailOk: false });
  await runWeeklyDigests({ ...deps, now: sundayEvening });
  const { lastResult } = db.store.get("lifeCalendars/cal-1/digestSettings/owner");
  assert.equal(lastResult.push.sent, 1);
  assert.deepEqual(lastResult.email, { sent: false, error: "Email isn't set up on the server yet (see docs/weekly-digest.md)." });

  const unverified = fakeDb(seed({ enabled: true, email: true }));
  const unverifiedDeps = services(unverified, { verified: false });
  await runWeeklyDigests({ ...unverifiedDeps, now: sundayEvening });
  assert.equal(unverifiedDeps.sentMail.length, 0);
  assert.equal(unverified.store.get("lifeCalendars/cal-1/digestSettings/owner").lastResult.email.error, "Your sign-in email isn't verified.");
});

test("the app's preview sends nothing; a test send is owner only and once a minute", async () => {
  const db = fakeDb(seed({ enabled: false, push: true, email: false }));
  const deps = services(db);

  const { digest } = await handleDigestCall({ ...deps, uid: "owner-1", data: { calendarId: "cal-1", action: "preview" }, now: new Date("2026-12-01T15:00:00Z") });
  assert.equal(digest.title, "Your week, Nov 23 to Nov 29");
  assert.equal(deps.sentPush.length, 0);

  await assert.rejects(handleDigestCall({ ...deps, uid: "viewer-1", data: { calendarId: "cal-1", action: "preview" } }), { code: "permission-denied" });
  await assert.rejects(handleDigestCall({ ...deps, uid: "owner-1", data: { calendarId: "cal-1/x", action: "preview" } }), { code: "invalid-argument" });

  const now = new Date("2026-12-01T15:00:00Z");
  const { results } = await handleDigestCall({ ...deps, uid: "owner-1", data: { calendarId: "cal-1", action: "test" }, now });
  assert.equal(results.push.sent, 1);
  assert.equal(results.email, undefined);
  await assert.rejects(
    handleDigestCall({ ...deps, uid: "owner-1", data: { calendarId: "cal-1", action: "test" }, now: new Date(now.getTime() + 30 * 1000) }),
    { code: "resource-exhausted" }
  );

  const off = fakeDb(seed({ enabled: true, push: false, email: false }));
  await assert.rejects(handleDigestCall({ ...services(off), uid: "owner-1", data: { calendarId: "cal-1", action: "test" } }), { code: "failed-precondition" });
});

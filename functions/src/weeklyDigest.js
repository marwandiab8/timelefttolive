// The Sunday digest (docs/weekly-digest.md). The content comes from src/utils/weeklyDigest.js, copied into
// functions/shared by scripts/copy-functions-shared.mjs, so the app's preview, the notification and the email agree.
// Nothing is sent unless the owner turned it on in the app (digestSettings/owner); the email only ever goes to the
// owner's own verified sign-in address.
const { Timestamp, FieldValue } = require("firebase-admin/firestore");

const SETTINGS_DOC = "owner";
const TEST_INTERVAL_MS = 60 * 1000;
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument"
]);

const loadShared = () => Promise.all([import("../shared/weeklyDigest.js"), import("../shared/lifeEventUtils.js")])
  .then(([digest, life]) => ({ ...digest, getLocalDateId: life.getLocalDateId }));

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function shiftDateId(dateId, days) {
  const date = new Date(`${dateId}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const docs = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

/** Builds the digest for one calendar as of `now` (Toronto date), reading only that week's data. */
async function buildCalendarDigest(db, calendarId, calendarData, now = new Date()) {
  const shared = await loadShared();
  const todayId = shared.getLocalDateId(now);
  const week = shared.digestWeek(todayId);
  const window = shared.digestEventWindow(week);
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const [events, entries, reviews, plans] = await Promise.all([
    calendarRef.collection("lifeEvents")
      .where("occurredAt", ">=", Timestamp.fromDate(window.start))
      .where("occurredAt", "<", Timestamp.fromDate(window.end))
      .orderBy("occurredAt", "asc")
      .get(),
    calendarRef.collection("dailyEntries").where("dateId", ">=", week.start).where("dateId", "<=", week.end).get(),
    calendarRef.collection("weeklyReviews").where("weekStart", ">=", shiftDateId(week.start, -6)).where("weekStart", "<=", week.end).get(),
    calendarRef.collection("plans").get()
  ]);
  return shared.buildWeeklyDigest({
    calendar: calendarData,
    events: docs(events),
    entries: docs(entries),
    reviews: docs(reviews),
    plans: docs(plans),
    todayId,
    now
  });
}

/** The owner's own sign-in address, only when it is verified. */
async function ownerEmail(auth, ownerUid) {
  const user = await auth.getUser(ownerUid);
  return user.email && user.emailVerified ? user.email : "";
}

/**
 * Sends one digest on the channels asked for. `messaging` is firebase-admin's; `sendMail` is null until the email
 * secrets are set. Devices whose notification token is no longer valid are removed. Never throws for a channel: each
 * result says what happened.
 */
async function sendDigest({ db, auth, messaging, sendMail, calendarId, ownerUid, digest, channels, appUrl }) {
  const shared = await loadShared();
  const url = appUrl || shared.DIGEST_APP_URL;
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const results = {};

  if (channels.push) {
    try {
      const tokens = docs(await calendarRef.collection("pushTokens").get()).filter((item) => item.token);
      if (!tokens.length) {
        results.push = { sent: 0, error: "No device has notifications turned on." };
      } else {
        const response = await messaging.sendEach(tokens.map((item) => ({
          token: item.token,
          webpush: {
            headers: { TTL: "86400", Urgency: "normal" },
            data: { title: digest.push.title, body: digest.push.body, url: `${url}/#digest`, tag: `digest-${digest.week.end}` }
          }
        })));
        const dead = response.responses
          .map((item, index) => (!item.success && DEAD_TOKEN_CODES.has(item.error?.code) ? tokens[index] : null))
          .filter(Boolean);
        await Promise.all(dead.map((item) => calendarRef.collection("pushTokens").doc(item.id).delete()));
        results.push = { sent: response.successCount, failed: response.failureCount, removed: dead.length };
      }
    } catch (error) {
      results.push = { sent: 0, error: error.message || "The notification could not be sent." };
    }
  }

  if (channels.email) {
    try {
      const to = await ownerEmail(auth, ownerUid);
      if (!to) results.email = { sent: false, error: "Your sign-in email isn't verified." };
      else if (!sendMail) results.email = { sent: false, error: "Email isn't set up on the server yet (see docs/weekly-digest.md)." };
      else {
        await sendMail({ to, subject: digest.title, text: shared.digestText(digest, url), html: shared.digestHtml(digest, url) });
        results.email = { sent: true };
      }
    } catch (error) {
      results.email = { sent: false, error: error.message || "The email could not be sent." };
    }
  }
  return results;
}

/** Sunday 7 pm: every calendar whose owner turned the digest on gets this week's, once. */
async function runWeeklyDigests({ db, auth, messaging, sendMail, now = new Date(), appUrl } = {}) {
  const totals = { calendars: 0, sent: 0, skipped: 0, failed: 0 };
  const calendars = await db.collection("lifeCalendars").get();
  for (const calendar of calendars.docs) {
    totals.calendars += 1;
    const settingsRef = calendar.ref.collection("digestSettings").doc(SETTINGS_DOC);
    const settings = (await settingsRef.get()).data() || {};
    const channels = { push: Boolean(settings.push), email: Boolean(settings.email) };
    if (!settings.enabled || (!channels.push && !channels.email)) {
      totals.skipped += 1;
      continue;
    }
    try {
      const data = calendar.data();
      const digest = await buildCalendarDigest(db, calendar.id, data, now);
      if (settings.lastSentWeekEnd === digest.week.end) {
        totals.skipped += 1;
        continue;
      }
      const results = await sendDigest({ db, auth, messaging, sendMail, calendarId: calendar.id, ownerUid: data.ownerUid, digest, channels, appUrl });
      await settingsRef.set({ lastSentWeekEnd: digest.week.end, lastSentAt: FieldValue.serverTimestamp(), lastResult: results }, { merge: true });
      totals.sent += 1;
    } catch (error) {
      totals.failed += 1;
      await settingsRef.set({ lastError: error.message || "The digest could not be built.", lastErrorAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  return totals;
}

/**
 * The app's callable: `preview` returns this week's digest without sending anything; `test` sends it now on the
 * channels turned on, at most once a minute. Owner only.
 */
async function handleDigestCall({ db, auth, messaging, sendMail, uid, data = {}, now = new Date(), appUrl }) {
  const calendarId = typeof data.calendarId === "string" ? data.calendarId : "";
  if (!calendarId || calendarId.includes("/")) fail("invalid-argument", "Which calendar?");
  const calendarSnap = await db.collection("lifeCalendars").doc(calendarId).get();
  if (!calendarSnap.exists || calendarSnap.data().ownerUid !== uid) fail("permission-denied", "Only the calendar owner can see the digest.");
  const calendarData = calendarSnap.data();

  if (data.action === "preview") {
    return { digest: await buildCalendarDigest(db, calendarId, calendarData, now) };
  }
  if (data.action !== "test") fail("invalid-argument", "Unknown digest action.");

  const settingsRef = db.collection("lifeCalendars").doc(calendarId).collection("digestSettings").doc(SETTINGS_DOC);
  const settings = (await settingsRef.get()).data() || {};
  const channels = { push: Boolean(settings.push), email: Boolean(settings.email) };
  if (!channels.push && !channels.email) fail("failed-precondition", "Turn on the notification or the email first.");
  const lastTest = settings.lastTestAt?.toDate ? settings.lastTestAt.toDate() : null;
  if (lastTest && now - lastTest < TEST_INTERVAL_MS) fail("resource-exhausted", "A test went out less than a minute ago.");
  await settingsRef.set({ lastTestAt: Timestamp.fromDate(now) }, { merge: true });
  const digest = await buildCalendarDigest(db, calendarId, calendarData, now);
  const results = await sendDigest({ db, auth, messaging, sendMail, calendarId, ownerUid: uid, digest, channels, appUrl });
  return { results };
}

module.exports = { buildCalendarDigest, sendDigest, runWeeklyDigests, handleDigestCall, shiftDateId };

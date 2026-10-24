const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const {
  createSourceIngestionToken,
  revokeSourceIngestionToken
} = require("./src/ingestion/tokens");
const {
  ingestOneRequest,
  ingestBatchRequest,
  ingestLifeEventSingle,
  ingestLifeEventBatch
} = require("./src/ingestion/ingestExternalDailyItem");
const { cleanupLifeEventArtifacts } = require("./src/ingestion/lifeEventFoundation");
const {
  createActivityMediaHandler,
  createJournalDetailsHandler
} = require("./src/activityJournal");
const { editActivityEntry, deleteActivityEntry } = require("./src/activityEntries");
const { syncCalendarEventLifeEvents, carryOngoingCalendarEvents } = require("./src/calendarLifeEvents");

admin.initializeApp();

const region = "northamerica-northeast1";

let activitySourceApp;
function activitySourceServices() {
  if (!activitySourceApp) {
    activitySourceApp = admin.apps.find((candidate) => candidate.name === "activity-gridline-source")
      || admin.initializeApp({
        projectId: "gridlineai",
        storageBucket: "gridlineai.firebasestorage.app"
      }, "activity-gridline-source");
  }
  return {
    sourceDb: admin.firestore(activitySourceApp),
    sourceBucket: admin.storage(activitySourceApp).bucket()
  };
}

exports.createSourceIngestionToken = onCall({ region }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to generate ingestion tokens.");
  }
  return createSourceIngestionToken(admin.firestore(), request.auth.uid, request.data || {});
});

exports.revokeSourceIngestionToken = onCall({ region }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to revoke ingestion tokens.");
  }
  return revokeSourceIngestionToken(admin.firestore(), request.auth.uid, request.data || {});
});

exports.editActivityEntry = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to edit activities.");
  try {
    return await editActivityEntry(admin.firestore(), request.auth.uid, request.data || {});
  } catch (error) {
    throw new HttpsError(error.code || "internal", error.message || "Unable to edit activity.");
  }
});

exports.deleteActivityEntry = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to delete activities.");
  try {
    return await deleteActivityEntry(admin.firestore(), request.auth.uid, request.data || {});
  } catch (error) {
    throw new HttpsError(error.code || "internal", error.message || "Unable to delete activity.");
  }
});

exports.ingestExternalDailyItem = onRequest({ region, cors: false }, async (req, res) => {
  await ingestOneRequest(admin.firestore(), req, res);
});

exports.ingestExternalDailyItemsBatch = onRequest({ region, cors: false }, async (req, res) => {
  await ingestBatchRequest(admin.firestore(), req, res);
});

exports.apiV1LifeEvents = onRequest({ region, cors: false }, async (req, res) => {
  await ingestLifeEventSingle(admin.firestore(), req, res);
});

exports.apiV1LifeEventsBatch = onRequest({ region, cors: false }, async (req, res) => {
  await ingestLifeEventBatch(admin.firestore(), req, res);
});

exports.getActivityJournalDetails = onRequest({ region, cors: false }, async (req, res) => {
  const { sourceDb } = activitySourceServices();
  await createJournalDetailsHandler({
    timeDb: admin.firestore(),
    sourceDb,
    auth: admin.auth()
  })(req, res);
});

exports.getActivityMedia = onRequest({ region, cors: false }, async (req, res) => {
  const { sourceDb, sourceBucket } = activitySourceServices();
  await createActivityMediaHandler({
    timeDb: admin.firestore(),
    sourceDb,
    sourceBucket,
    auth: admin.auth()
  })(req, res);
});

exports.cleanupLifeEventIngestionArtifacts = onSchedule({
  schedule: "every 24 hours",
  region,
  timeZone: "Etc/UTC"
}, async () => {
  await cleanupLifeEventArtifacts(admin.firestore());
});

// Main-calendar events as life events on the days they cover, so they show in the Activity dashboard's day view and in
// the gridlineai journal's "Day at a glance" (src/calendarLifeEvents.js). Firestore triggers run where the database
// is: this one is in nam5, the US multi-region, which means us-central1. It reads the event again rather than using
// the change, so a quick run of edits ends on the latest one; an ongoing event can mean thousands of days.
exports.syncCalendarEventToLifeEvents = onDocumentWritten({
  document: "lifeCalendars/{calendarId}/events/{eventId}",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "512MiB"
}, async (event) => {
  const { calendarId, eventId } = event.params;
  const db = admin.firestore();
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const [calendar, current] = await Promise.all([calendarRef.get(), calendarRef.collection("events").doc(eventId).get()]);
  const ownerUid = calendar.exists ? (calendar.data() || {}).ownerUid || "" : "";
  const after = current.exists ? current.data() : null;
  const counts = await syncCalendarEventLifeEvents(db, { calendarId, eventId, event: after, ownerUid });
  logger.info("Calendar event synced to life events", { calendarId, eventId, deletedEvent: !after, ...counts });
});

// Ongoing main-calendar events are carried every day until they're stopped: just after midnight, add the new day.
exports.carryOngoingCalendarEvents = onSchedule({
  schedule: "5 0 * * *",
  timeZone: "America/Toronto",
  region,
  timeoutSeconds: 300,
  memory: "512MiB"
}, async () => {
  const totals = await carryOngoingCalendarEvents(admin.firestore());
  logger.info("Ongoing calendar events carried to today", totals);
});

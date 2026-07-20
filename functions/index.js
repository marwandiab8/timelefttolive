const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

admin.initializeApp();

const region = "northamerica-northeast1";

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

exports.cleanupLifeEventIngestionArtifacts = onSchedule({
  schedule: "every 24 hours",
  region,
  timeZone: "Etc/UTC"
}, async () => {
  await cleanupLifeEventArtifacts(admin.firestore());
});

const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { sha256 } = require("./dedupe");

function tokenHash(token) {
  return sha256(token);
}

function generateToken() {
  return `tltl_ingest_v1_${crypto.randomBytes(32).toString("base64url")}`;
}

async function assertCalendarOwner(db, uid, calendarId) {
  if (!calendarId) throw new HttpsError("invalid-argument", "calendarId is required.");
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const calendarSnap = await calendarRef.get();
  if (!calendarSnap.exists) throw new HttpsError("not-found", "Calendar not found.");
  const calendar = calendarSnap.data();
  if (calendar.ownerUid !== uid) throw new HttpsError("permission-denied", "Only the calendar owner can manage ingestion tokens.");
  return { calendarRef, calendar };
}

async function assertConnection(db, calendarId, connectionId) {
  if (!connectionId) throw new HttpsError("invalid-argument", "connectionId is required.");
  const connectionRef = db.collection("lifeCalendars").doc(calendarId).collection("sourceConnections").doc(connectionId);
  const connectionSnap = await connectionRef.get();
  if (!connectionSnap.exists) throw new HttpsError("not-found", "Source connection not found.");
  return { connectionRef, connection: connectionSnap.data() };
}

async function createSourceIngestionToken(db, uid, data) {
  const { calendarId, connectionId } = data;
  const { calendar } = await assertCalendarOwner(db, uid, calendarId);
  const { connectionRef } = await assertConnection(db, calendarId, connectionId);
  const connectionSnap = await connectionRef.get();
  const connection = connectionSnap.exists ? connectionSnap.data() : {};
  const resolvedIntegrationId = toTrimmedValue(connection.integrationId) || `integration_${connectionId}`;
  const token = generateToken();
  const lastFour = token.slice(-4);
  const secretRef = db.collection("lifeCalendars").doc(calendarId).collection("sourceConnectionSecrets").doc(connectionId);
  await db.runTransaction(async (transaction) => {
    transaction.set(secretRef, {
      tokenHash: tokenHash(token),
      tokenVersion: 1,
      tokenStatus: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(connectionRef, {
      integrationId: resolvedIntegrationId,
      timeLeftUserId: calendar.ownerUid,
      tokenCreatedAt: FieldValue.serverTimestamp(),
      tokenLastFour: lastFour,
      tokenVersion: 1,
      tokenStatus: "active",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return {
    token,
    tokenLastFour: lastFour,
    tokenStatus: "active",
    integrationId: resolvedIntegrationId
  };
}

async function revokeSourceIngestionToken(db, uid, data) {
  const { calendarId, connectionId } = data;
  await assertCalendarOwner(db, uid, calendarId);
  const { connectionRef } = await assertConnection(db, calendarId, connectionId);
  const secretRef = db.collection("lifeCalendars").doc(calendarId).collection("sourceConnectionSecrets").doc(connectionId);
  await db.runTransaction(async (transaction) => {
    transaction.set(secretRef, {
      tokenStatus: "revoked",
      tokenHash: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(connectionRef, {
      tokenStatus: "revoked",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { tokenStatus: "revoked" };
}

async function validateBearerToken(db, token, calendarId, connectionId, options = {}) {
  const expectedIntegrationId = toTrimmedValue(options.integrationId);
  if (!token) throw Object.assign(new Error("Missing bearer token."), { status: 401 });
  const calendarRef = db.collection("lifeCalendars").doc(calendarId || "");
  const connectionRef = calendarRef.collection("sourceConnections").doc(connectionId || "");
  const secretRef = calendarRef.collection("sourceConnectionSecrets").doc(connectionId || "");
  const [calendarSnap, connectionSnap, secretSnap] = await Promise.all([
    calendarRef.get(),
    connectionRef.get(),
    secretRef.get()
  ]);
  if (!calendarSnap.exists) throw Object.assign(new Error("Calendar not found."), { status: 404 });
  if (!connectionSnap.exists) throw Object.assign(new Error("Source connection not found."), { status: 404 });
  if (!secretSnap.exists) throw Object.assign(new Error("Ingestion token has not been generated."), { status: 401 });
  const connection = connectionSnap.data();
  const secret = secretSnap.data();
  if (connection.status !== "active") throw Object.assign(new Error("Source connection is not active."), { status: 403 });
  if (connection.tokenStatus === "revoked" || secret.tokenStatus === "revoked") throw Object.assign(new Error("Ingestion token is revoked."), { status: 401 });
  if (!secret.tokenHash || tokenHash(token) !== secret.tokenHash) throw Object.assign(new Error("Invalid ingestion token."), { status: 401 });
  const resolvedIntegrationId = connection.integrationId || connectionId;
  if (expectedIntegrationId && resolvedIntegrationId && expectedIntegrationId !== resolvedIntegrationId) {
    throw Object.assign(new Error("integrationId mismatch."), { code: "auth_error", status: 403 });
  }
  return {
    calendar: calendarSnap.data(),
    connection,
    integrationId: resolvedIntegrationId,
    calendarRef,
    connectionRef
  };
}

function toTrimmedValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createSourceIngestionToken,
  generateToken,
  revokeSourceIngestionToken,
  tokenHash,
  validateBearerToken
};

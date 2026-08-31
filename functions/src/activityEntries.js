const admin = require("firebase-admin");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function asDate(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof admin.firestore.Timestamp ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) fail("invalid-argument", `${field} must be a valid date.`);
  return date;
}

function assertOwner(calendar, uid) {
  if (!calendar.exists || calendar.data().ownerUid !== uid) fail("permission-denied", "Only the calendar owner can manage activities.");
}

function cleanString(value, field, max = 2000) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail("invalid-argument", `${field} must be text.`);
  const result = value.trim();
  if (result.length > max) fail("invalid-argument", `${field} is too long.`);
  return result;
}

function objectValue(value, field) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-argument", `${field} must be an object.`);
  return value;
}

async function editActivityEntry(db, uid, data = {}) {
  const calendarId = cleanString(data.calendarId, "calendarId", 200);
  const eventId = cleanString(data.eventId, "eventId", 200);
  if (!calendarId || !eventId) fail("invalid-argument", "calendarId and eventId are required.");
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const eventRef = calendarRef.collection("lifeEvents").doc(eventId);
  const updated = await db.runTransaction(async (tx) => {
    const [calendar, event] = await Promise.all([tx.get(calendarRef), tx.get(eventRef)]);
    assertOwner(calendar, uid);
    if (!event.exists || event.data().deletedAt) fail("not-found", "This activity no longer exists.");
    const current = event.data();
    const startAt = asDate(data.startAt === undefined ? current.startAt : data.startAt, "startAt");
    const occurredAt = asDate(data.occurredAt === undefined ? current.occurredAt : data.occurredAt, "occurredAt") || startAt;
    const endAt = asDate(data.endAt === undefined ? current.endAt : data.endAt, "endAt");
    if (startAt && endAt && endAt < startAt) fail("invalid-argument", "End time cannot be earlier than start time.");
    let durationSeconds = data.durationSeconds === undefined ? current.durationSeconds : data.durationSeconds;
    if (durationSeconds === "" || durationSeconds === null) durationSeconds = null;
    if (durationSeconds !== null && durationSeconds !== undefined) {
      durationSeconds = Number(durationSeconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0) fail("invalid-argument", "Duration must be zero or greater.");
      durationSeconds = Math.round(durationSeconds);
    }
    if (startAt && endAt) {
      const computed = Math.round((endAt.getTime() - startAt.getTime()) / 1000);
      if (data.durationSeconds === undefined || data.durationSeconds === "" || data.durationSeconds === null) durationSeconds = computed;
      else if (durationSeconds !== computed) fail("invalid-argument", "Duration must match the start and end time.");
    }
    const patch = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
      updatedByUid: uid,
      manualOverride: true,
      occurredAt: occurredAt ? admin.firestore.Timestamp.fromDate(occurredAt) : null,
      startAt: startAt ? admin.firestore.Timestamp.fromDate(startAt) : null,
      endAt: endAt ? admin.firestore.Timestamp.fromDate(endAt) : null,
      durationSeconds: durationSeconds === undefined ? null : durationSeconds
    };
    for (const [field, max] of [["title", 500], ["activityFamily", 120], ["categoryId", 120], ["eventType", 120], ["description", 4000], ["timezone", 100]]) {
      const value = cleanString(data[field], field, max);
      if (value !== undefined) patch[field] = value;
    }
    const location = objectValue(data.location, "location");
    if (location !== undefined) patch.location = location;
    const metadata = objectValue(data.metadata, "metadata");
    if (metadata !== undefined) patch.metadata = { ...(current.metadata || {}), ...metadata };
    tx.update(eventRef, patch);
    return { id: eventId };
  });
  return updated;
}

async function deleteActivityEntry(db, uid, data = {}) {
  const calendarId = cleanString(data.calendarId, "calendarId", 200);
  const eventId = cleanString(data.eventId, "eventId", 200);
  if (!calendarId || !eventId) fail("invalid-argument", "calendarId and eventId are required.");
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const eventRef = calendarRef.collection("lifeEvents").doc(eventId);
  const tombstoneRef = calendarRef.collection("lifeEventTombstones").doc(eventId);
  await db.runTransaction(async (tx) => {
    const [calendar, event] = await Promise.all([tx.get(calendarRef), tx.get(eventRef)]);
    assertOwner(calendar, uid);
    if (!event.exists) fail("not-found", "This activity no longer exists.");
    const current = event.data();
    tx.set(tombstoneRef, {
      eventId,
      idempotencyKey: current.idempotencyKey || eventId,
      sourceApp: current.sourceApp || "",
      sourceRecordId: current.sourceRecordId || "",
      sourceEventId: current.sourceEventId || "",
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: uid,
      deletedByUid: uid
    }, { merge: true });
    tx.delete(eventRef);
  });
  return { id: eventId };
}

module.exports = { editActivityEntry, deleteActivityEntry };

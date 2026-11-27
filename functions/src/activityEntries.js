const admin = require("firebase-admin");
// Imported directly: the Functions emulator wraps the firebase-admin namespace, and admin.firestore.Timestamp can be
// missing there, while the class itself is the same one.
const { Timestamp } = require("firebase-admin/firestore");

const RECYCLE_BIN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function asDate(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Timestamp ? value.toDate() : new Date(value);
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

function objectValue(value, field, { allowNull = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-argument", `${field} must be an object.`);
  return value;
}

async function editActivityEntry(db, uid, data = {}) {
  const calendarId = cleanString(data.calendarId, "calendarId", 200);
  const eventId = cleanString(data.eventId, "eventId", 200);
  if (!calendarId || !eventId) fail("invalid-argument", "calendarId and eventId are required.");
  const linkedEventId = cleanString(data.linkedEventId ?? undefined, "linkedEventId", 200);
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const eventRef = calendarRef.collection("lifeEvents").doc(eventId);
  const linkedEventRef = linkedEventId ? calendarRef.collection("lifeEvents").doc(linkedEventId) : null;
  const updated = await db.runTransaction(async (tx) => {
    const reads = [tx.get(calendarRef), tx.get(eventRef)];
    if (linkedEventRef) reads.push(tx.get(linkedEventRef));
    const [calendar, event, linkedEvent] = await Promise.all(reads);
    assertOwner(calendar, uid);
    if (!event.exists || event.data().deletedAt) fail("not-found", "This activity no longer exists.");
    if (linkedEventRef && (!linkedEvent?.exists || linkedEvent.data().deletedAt)) fail("not-found", "The linked activity boundary no longer exists.");
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
      occurredAt: occurredAt ? Timestamp.fromDate(occurredAt) : null,
      startAt: startAt ? Timestamp.fromDate(startAt) : null,
      endAt: endAt ? Timestamp.fromDate(endAt) : null,
      durationSeconds: durationSeconds === undefined ? null : durationSeconds
    };
    for (const [field, max] of [["title", 500], ["activityFamily", 120], ["categoryId", 120], ["eventType", 120], ["description", 4000], ["timezone", 100]]) {
      const value = cleanString(data[field], field, max);
      if (value !== undefined) patch[field] = value;
    }
    // null clears the location; omitting the field leaves it unchanged.
    const location = objectValue(data.location, "location", { allowNull: true });
    if (location !== undefined) patch.location = location;
    const metadata = objectValue(data.metadata, "metadata");
    if (metadata !== undefined) patch.metadata = { ...(current.metadata || {}), ...metadata };
    if (linkedEventRef) {
      const linkedEndAt = asDate(data.linkedEndAt, "linkedEndAt");
      if (linkedEndAt && startAt && linkedEndAt < startAt) fail("invalid-argument", "End time cannot be earlier than start time.");
      // Boundary sessions derive their finish from the linked departure event.
      // Do not turn the arrival record into a second reported interval.
      delete patch.endAt;
      delete patch.durationSeconds;
      tx.update(linkedEventRef, {
        occurredAt: linkedEndAt ? Timestamp.fromDate(linkedEndAt) : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedByUid: uid,
        manualOverride: true
      });
    }
    tx.update(eventRef, patch);
    return { id: eventId };
  });
  return updated;
}

async function deleteActivityEntry(db, uid, data = {}) {
  const calendarId = cleanString(data.calendarId, "calendarId", 200);
  const eventId = cleanString(data.eventId, "eventId", 200);
  if (!calendarId || !eventId) fail("invalid-argument", "calendarId and eventId are required.");
  const linkedEventId = cleanString(data.linkedEventId ?? undefined, "linkedEventId", 200);
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  // A paired session is two events (arrival and departure). Deleting only one
  // would leave an "Incomplete" boundary behind, so both go in one transaction.
  const eventIds = linkedEventId && linkedEventId !== eventId ? [eventId, linkedEventId] : [eventId];
  await db.runTransaction(async (tx) => {
    const eventRefs = eventIds.map((id) => calendarRef.collection("lifeEvents").doc(id));
    const [calendar, ...events] = await Promise.all([tx.get(calendarRef), ...eventRefs.map((ref) => tx.get(ref))]);
    assertOwner(calendar, uid);
    events.forEach((event, index) => {
      if (!event.exists) fail("not-found", index === 0 ? "This activity no longer exists." : "The linked activity boundary no longer exists.");
    });
    events.forEach((event, index) => {
      const id = eventIds[index];
      const current = event.data();
      // A copy waits in the recycle bin for 90 days, so a delete can be undone (restoreActivityEntry):
      // the tombstone below stops the source from re-sending the event, and nothing else keeps it.
      tx.set(calendarRef.collection("lifeEventRecycleBin").doc(id), {
        ...current,
        id,
        recycledAt: admin.firestore.FieldValue.serverTimestamp(),
        recycledBy: uid,
        recycledWith: eventIds,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + RECYCLE_BIN_TTL_MS))
      });
      tx.set(calendarRef.collection("lifeEventTombstones").doc(id), {
        eventId: id,
        idempotencyKey: current.idempotencyKey || id,
        sourceApp: current.sourceApp || "",
        sourceRecordId: current.sourceRecordId || "",
        sourceEventId: current.sourceEventId || "",
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: uid,
        deletedByUid: uid
      }, { merge: true });
      tx.delete(eventRefs[index]);
    });
  });
  return { id: eventId };
}

// Brings a deleted activity back from the recycle bin: the event document is re-created from its copy,
// the tombstone that blocked its source from re-sending it is removed, and the copy is discarded. A paired
// session (arrival and departure deleted together) comes back whole.
async function restoreActivityEntry(db, uid, data = {}) {
  const calendarId = cleanString(data.calendarId, "calendarId", 200);
  const eventId = cleanString(data.eventId, "eventId", 200);
  if (!calendarId || !eventId) fail("invalid-argument", "calendarId and eventId are required.");
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const bin = (id) => calendarRef.collection("lifeEventRecycleBin").doc(id);
  const restored = await db.runTransaction(async (tx) => {
    const calendar = await tx.get(calendarRef);
    assertOwner(calendar, uid);
    const first = await tx.get(bin(eventId));
    if (!first.exists) fail("not-found", "This activity is no longer in Recently deleted.");
    const together = Array.isArray(first.data().recycledWith) ? first.data().recycledWith : [];
    const ids = [...new Set([eventId, ...together])].filter((id) => typeof id === "string" && id);
    const copies = await Promise.all(ids.map((id) => tx.get(bin(id))));
    const live = await Promise.all(ids.map((id) => tx.get(calendarRef.collection("lifeEvents").doc(id))));
    const out = [];
    copies.forEach((copy, index) => {
      const id = ids[index];
      if (!copy.exists) return;
      const { recycledAt, recycledBy, recycledWith, expiresAt, ...event } = copy.data();
      if (!live[index].exists) {
        tx.set(calendarRef.collection("lifeEvents").doc(id), {
          ...event,
          id,
          restoredAt: admin.firestore.FieldValue.serverTimestamp(),
          restoredBy: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      tx.delete(calendarRef.collection("lifeEventTombstones").doc(id));
      tx.delete(bin(id));
      out.push(id);
    });
    return out;
  });
  return { ids: restored };
}

// What a hand-added activity can be. Each maps to the activityFamily the dashboard already sorts into that slice
// (src/utils/lifeEventUtils.js, getTallyActivityLabel); "Other" keeps the name you give it.
const MANUAL_FAMILIES = {
  Sleep: "sleep",
  Work: "work",
  Home: "home",
  "Gym/Fitness": "gym",
  Reading: "reading",
  Meals: "meals",
  Transportation: "driving",
  Darts: "darts",
  Music: "music"
};
const MAX_MANUAL_SECONDS = 36 * 3600;

/**
 * Adds an activity by hand: an owner-only life event from the "manual" source, with a start and an end. It has the
 * shape the source apps' events have, so the wheel, the totals, edit, delete and restore treat it like any other.
 */
async function createActivityEntry(db, uid, data = {}, { now = new Date(), newId = () => require("node:crypto").randomUUID() } = {}) {
  const calendarId = cleanString(data.calendarId, "calendarId", 200);
  if (!calendarId) fail("invalid-argument", "calendarId is required.");
  const category = cleanString(data.category, "category", 60) || "";
  const customName = cleanString(data.name ?? "", "name", 60);
  const family = MANUAL_FAMILIES[category] || (category === "Other" && customName ? customName.toLowerCase() : "");
  if (!family) fail("invalid-argument", "Pick what the activity was.");
  const startAt = asDate(data.startAt, "startAt");
  const endAt = asDate(data.endAt, "endAt");
  if (!startAt || !endAt) fail("invalid-argument", "An activity needs a start and an end.");
  const seconds = Math.round((endAt - startAt) / 1000);
  if (seconds <= 0) fail("invalid-argument", "The end has to be after the start.");
  if (seconds > MAX_MANUAL_SECONDS) fail("invalid-argument", "One activity can be at most 36 hours long.");
  if (startAt > now) fail("invalid-argument", "An activity can't start in the future.");
  const title = cleanString(data.title ?? "", "title", 200) || (category === "Other" ? customName : category);
  const note = cleanString(data.note ?? "", "note", 2000);
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const id = `manual_${newId()}`;
  const eventRef = calendarRef.collection("lifeEvents").doc(id);
  const timestamp = (date) => Timestamp.fromDate(date);
  const record = {
    id,
    sourceApp: "manual",
    sourceRecordId: id,
    eventType: "manual_activity",
    eventClass: "completed_activity",
    activityFamily: family,
    categoryId: family,
    title,
    occurredAt: timestamp(startAt),
    startAt: timestamp(startAt),
    endAt: timestamp(endAt),
    durationSeconds: seconds,
    timezone: "America/Toronto",
    privacyLevel: "ownerOnly",
    location: null,
    metadata: { manual: true, ...(note ? { note } : {}) },
    calendarId,
    ownerUid: uid,
    timeLeftUserId: uid,
    ingestionStatus: "received",
    receivedAt: timestamp(now),
    createdAt: timestamp(now),
    updatedAt: timestamp(now)
  };
  await db.runTransaction(async (tx) => {
    const calendar = await tx.get(calendarRef);
    assertOwner(calendar, uid);
    tx.set(eventRef, record);
  });
  return { ok: true, eventId: id };
}

module.exports = { editActivityEntry, deleteActivityEntry, restoreActivityEntry, createActivityEntry, MANUAL_FAMILIES, RECYCLE_BIN_TTL_MS };

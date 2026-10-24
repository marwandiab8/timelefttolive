// Main-calendar events as life events, so each calendar event shows on the days it covers in the Activity
// dashboard's day view ("What happened") and in anything else that reads a day's life events, such as the gridlineai
// journal's "Day at a glance". The calendar stays the source: a trigger on lifeCalendars/{calendarId}/events keeps
// these life events in step when an event is added, renamed, moved or deleted.
//
// Calendar events are date-only ranges (startDate..endDate, inclusive). One up to a month long (an appointment, a
// trip) gets a life event on every day it covers ("Trip — day 2 of 5"). A longer one is a chapter of life (school, a
// job, where you lived), so it gets one on its first and last day only, never one a day for years - unless it is
// marked to show every day (everyDay), or it is ongoing: carried every day, through today, until it is stopped
// ("With Ashley — day 1,286"). A scheduled job adds each new day to the ongoing ones.
const { normalizeLifeEventRecord } = require("./ingestion/lifeEventFoundation");
const { isValidDateId } = require("./ingestion/dateId");

const CALENDAR_SOURCE_APP = "timelefttolive";
const CALENDAR_INTEGRATION_ID = "timelefttolive-calendar";
const CALENDAR_EVENT_TYPE = "calendar_event";
const CALENDAR_TIMEZONE = "America/Toronto";
const EVERY_DAY_LIMIT = 31;
// An every-day event keeps its first day and at most its last ten years of days.
const DAILY_LIMIT_DAYS = 3660;
const SCHEMA_VERSION = 1;
const DESCRIPTION_LIMIT = 1000;
const READ_CHUNK = 300;
const WRITE_CHUNK = 400;

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const noon = (dateId) => Date.parse(`${dateId}T12:00:00Z`);
const addDays = (dateId, days) => new Date(noon(dateId) + days * 86400000).toISOString().slice(0, 10);
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/** Today in the calendar's time zone, as YYYY-MM-DD. */
function todayDateId(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The days a calendar event shows on, with each day's title: every day up to a month, else the first and last; every
 * day of an every-day event; and every day so far (through today) of an ongoing one.
 */
function calendarEventDays(event, { today = todayDateId() } = {}) {
  const startDate = clean(event && event.startDate);
  if (!isValidDateId(startDate)) return [];
  const ongoing = event.ongoing === true;
  const endDate = ongoing ? today : clean(event.endDate) || startDate;
  if (!isValidDateId(endDate) || endDate < startDate) return []; // includes an ongoing event that hasn't started yet
  const title = clean(event.title) || "Calendar event";
  const dayCount = Math.round((noon(endDate) - noon(startDate)) / 86400000) + 1;
  if (ongoing || event.everyDay === true) {
    // The count runs from the first day and doesn't change from one day to the next, so a day once written stays put.
    const first = Math.max(0, dayCount - DAILY_LIMIT_DAYS);
    const day = (index) => ({
      dateId: addDays(startDate, index),
      dayIndex: index + 1,
      dayCount: ongoing ? null : dayCount,
      phase: "day",
      title: `${title} — day ${(index + 1).toLocaleString("en-US")}`
    });
    return [...(first > 0 ? [day(0)] : []), ...Array.from({ length: dayCount - first }, (_, i) => day(first + i))];
  }
  if (dayCount === 1) return [{ dateId: startDate, dayIndex: 1, dayCount, phase: "single", title }];
  if (dayCount <= EVERY_DAY_LIMIT) {
    return Array.from({ length: dayCount }, (_, index) => ({
      dateId: addDays(startDate, index),
      dayIndex: index + 1,
      dayCount,
      phase: "day",
      title: `${title} — day ${index + 1} of ${dayCount}`
    }));
  }
  return [
    { dateId: startDate, dayIndex: 1, dayCount, phase: "first", title: `${title} — first day` },
    { dateId: endDate, dayIndex: dayCount, dayCount, phase: "last", title: `${title} — last day` }
  ];
}

/** One day of a calendar event as a canonical life event record (date-only, no clock time). */
function buildCalendarLifeEventRecord({ calendarId, ownerUid, eventId, event, day }) {
  const ongoing = event.ongoing === true;
  return normalizeLifeEventRecord({
    schemaVersion: SCHEMA_VERSION,
    sourceApp: CALENDAR_SOURCE_APP,
    sourceRecordId: `calendar:${eventId}:${day.dateId}`,
    eventType: CALENDAR_EVENT_TYPE,
    eventClass: "project",
    activityFamily: "calendar",
    categoryId: "calendar",
    title: day.title,
    occurredAt: day.dateId,
    timezone: CALENDAR_TIMEZONE,
    privacyLevel: event.visibility === "viewers" ? "viewers" : "ownerOnly",
    metadata: {
      dateOnly: true,
      dateId: day.dateId,
      calendarEventId: eventId,
      eventTitle: clean(event.title),
      note: clean(event.description).slice(0, DESCRIPTION_LIMIT),
      startDate: clean(event.startDate),
      endDate: ongoing ? "" : clean(event.endDate) || clean(event.startDate),
      ongoing,
      everyDay: ongoing || event.everyDay === true,
      dayIndex: day.dayIndex,
      dayCount: day.dayCount,
      phase: day.phase,
      color: typeof event.color === "string" ? event.color : ""
    }
  }, {
    integrationId: CALENDAR_INTEGRATION_ID,
    calendarId,
    connectionId: CALENDAR_INTEGRATION_ID,
    timeLeftUserId: ownerUid || "",
    connection: null
  });
}

/**
 * Bring a calendar event's life events in line with the event (null when it was deleted): create or update one per
 * day it shows on, and delete the ones for days it no longer covers. A day deleted from the Activity dashboard
 * (tombstoned) or edited there (manual override) is left as it is. An ongoing event can mean thousands of days, so
 * this reads them in one query and writes in batches.
 */
async function syncCalendarEventLifeEvents(db, { calendarId, eventId, event, ownerUid, today }) {
  const counts = { created: 0, updated: 0, unchanged: 0, kept: 0, deleted: 0 };
  const calendarRef = db.collection("lifeCalendars").doc(calendarId);
  const lifeEvents = calendarRef.collection("lifeEvents");
  const records = event
    ? calendarEventDays(event, { today }).map((day) => buildCalendarLifeEventRecord({ calendarId, ownerUid, eventId, event, day }))
    : [];
  const existing = new Map();
  for (const doc of (await lifeEvents.where("metadata.calendarEventId", "==", eventId).get()).docs) {
    const data = doc.data() || {};
    if (data.sourceApp === CALENDAR_SOURCE_APP && data.eventType === CALENDAR_EVENT_TYPE) existing.set(doc.id, { ref: doc.ref, data });
  }
  const tombstoned = new Set();
  for (const part of chunks(records.filter((record) => !existing.has(record.idempotencyKey)), READ_CHUNK)) {
    const snaps = await db.getAll(...part.map((record) => calendarRef.collection("lifeEventTombstones").doc(record.idempotencyKey)));
    for (const snap of snaps) if (snap.exists) tombstoned.add(snap.id);
  }
  const now = new Date();
  const writes = [];
  for (const record of records) {
    const found = existing.get(record.idempotencyKey);
    if (!found) {
      if (tombstoned.has(record.idempotencyKey)) {
        counts.kept += 1;
        continue;
      }
      writes.push([lifeEvents.doc(record.idempotencyKey), { id: record.idempotencyKey, ...record, ingestionStatus: "received", receivedAt: now, createdAt: now, updatedAt: now }]);
      counts.created += 1;
    } else if (found.data.manualOverride) {
      counts.kept += 1;
    } else if (found.data.contentHash === record.contentHash) {
      counts.unchanged += 1;
    } else {
      writes.push([found.ref, {
        id: record.idempotencyKey,
        ...record,
        ingestionStatus: "received",
        receivedAt: found.data.receivedAt || now,
        createdAt: found.data.createdAt || now,
        updatedAt: now,
        revisionCount: (Number(found.data.revisionCount) || 0) + 1
      }]);
      counts.updated += 1;
    }
  }
  const wanted = new Set(records.map((record) => record.idempotencyKey));
  for (const [id, found] of existing) {
    if (wanted.has(id)) continue;
    writes.push([found.ref, null]);
    counts.deleted += 1;
  }
  for (const part of chunks(writes, WRITE_CHUNK)) {
    const batch = db.batch();
    for (const [ref, data] of part) {
      if (data) batch.set(ref, data);
      else batch.delete(ref);
    }
    await batch.commit();
  }
  return counts;
}

/** Add today (and any missed day) to every ongoing calendar event: the scheduled carry-forward. */
async function carryOngoingCalendarEvents(db, { today } = {}) {
  const totals = { events: 0, created: 0, updated: 0, unchanged: 0, kept: 0, deleted: 0 };
  for (const calendar of (await db.collection("lifeCalendars").get()).docs) {
    const ownerUid = (calendar.data() || {}).ownerUid || "";
    const ongoing = await calendar.ref.collection("events").where("ongoing", "==", true).get();
    for (const doc of ongoing.docs) {
      const counts = await syncCalendarEventLifeEvents(db, { calendarId: calendar.id, eventId: doc.id, event: doc.data() || {}, ownerUid, today });
      totals.events += 1;
      for (const key of Object.keys(counts)) totals[key] += counts[key];
    }
  }
  return totals;
}

module.exports = {
  CALENDAR_SOURCE_APP,
  CALENDAR_EVENT_TYPE,
  EVERY_DAY_LIMIT,
  DAILY_LIMIT_DAYS,
  todayDateId,
  calendarEventDays,
  buildCalendarLifeEventRecord,
  syncCalendarEventLifeEvents,
  carryOngoingCalendarEvents
};

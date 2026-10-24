// Main-calendar events as life events, so each calendar event shows on the days it covers in the Activity
// dashboard's day view ("What happened") and in anything else that reads a day's life events, such as the gridlineai
// journal's "Day at a glance". The calendar stays the source: a trigger on lifeCalendars/{calendarId}/events keeps
// these life events in step when an event is added, renamed, moved or deleted.
//
// Calendar events are date-only ranges (startDate..endDate, inclusive). One up to a month long (an appointment, a
// trip) gets a life event on every day it covers ("Trip — day 2 of 5"). A longer one is a chapter of life (school, a
// job, where you lived), so it gets one on its first and last day only, never one a day for years.
const { normalizeLifeEventRecord, upsertLifeEventRecord } = require("./ingestion/lifeEventFoundation");
const { isValidDateId } = require("./ingestion/dateId");

const CALENDAR_SOURCE_APP = "timelefttolive";
const CALENDAR_INTEGRATION_ID = "timelefttolive-calendar";
const CALENDAR_EVENT_TYPE = "calendar_event";
const CALENDAR_TIMEZONE = "America/Toronto";
const EVERY_DAY_LIMIT = 31;
const SCHEMA_VERSION = 1;
const DESCRIPTION_LIMIT = 1000;

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const noon = (dateId) => Date.parse(`${dateId}T12:00:00Z`);
const addDays = (dateId, days) => new Date(noon(dateId) + days * 86400000).toISOString().slice(0, 10);

/** The days a calendar event shows on, with each day's title: every day up to a month, else the first and last. */
function calendarEventDays(event) {
  const startDate = clean(event && event.startDate);
  const endDate = clean(event && event.endDate) || startDate;
  if (!isValidDateId(startDate) || !isValidDateId(endDate) || endDate < startDate) return [];
  const title = clean(event.title) || "Calendar event";
  const dayCount = Math.round((noon(endDate) - noon(startDate)) / 86400000) + 1;
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
      endDate: clean(event.endDate) || clean(event.startDate),
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
 * (tombstoned) or edited there (manual override) is left as it is.
 */
async function syncCalendarEventLifeEvents(db, { calendarId, eventId, event, ownerUid }) {
  const counts = { created: 0, updated: 0, unchanged: 0, kept: 0, deleted: 0 };
  const lifeEvents = db.collection("lifeCalendars").doc(calendarId).collection("lifeEvents");
  const records = event
    ? calendarEventDays(event).map((day) => buildCalendarLifeEventRecord({ calendarId, ownerUid, eventId, event, day }))
    : [];
  const wanted = new Set(records.map((record) => record.idempotencyKey));
  for (const record of records) {
    const result = await upsertLifeEventRecord(db, record);
    if (result.status === "created") counts.created += 1;
    else if (result.status === "updated") counts.updated += 1;
    else if (result.status === "duplicate") counts.unchanged += 1;
    else counts.kept += 1;
  }
  const existing = await lifeEvents.where("metadata.calendarEventId", "==", eventId).get();
  for (const doc of existing.docs) {
    const data = doc.data() || {};
    if (data.sourceApp !== CALENDAR_SOURCE_APP || data.eventType !== CALENDAR_EVENT_TYPE || wanted.has(doc.id)) continue;
    await doc.ref.delete();
    counts.deleted += 1;
  }
  return counts;
}

module.exports = {
  CALENDAR_SOURCE_APP,
  CALENDAR_EVENT_TYPE,
  EVERY_DAY_LIMIT,
  calendarEventDays,
  buildCalendarLifeEventRecord,
  syncCalendarEventLifeEvents
};

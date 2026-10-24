const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calendarEventDays,
  buildCalendarLifeEventRecord,
  syncCalendarEventLifeEvents
} = require("./calendarLifeEvents");

// A small in-memory Firestore: documents by path, nested-field equality queries, and transactions.
class Doc {
  constructor(store, path) { this.store = store; this.path = path; this.id = path.split("/").pop(); }
  collection(name) { return new Collection(this.store, `${this.path}/${name}`); }
  async get() { return snapshot(this, this.store.get(this.path)); }
  async set(data) { this.store.set(this.path, structuredClone(data)); }
  async delete() { this.store.delete(this.path); }
}
class Collection {
  constructor(store, path, filters = []) { this.store = store; this.path = path; this.filters = filters; }
  doc(id) { return new Doc(this.store, `${this.path}/${id}`); }
  where(field, op, value) {
    assert.equal(op, "==");
    return new Collection(this.store, this.path, [...this.filters, [field, value]]);
  }
  async get() {
    const docs = [];
    for (const [path, data] of this.store) {
      if (!path.startsWith(`${this.path}/`) || path.slice(this.path.length + 1).includes("/")) continue;
      const pass = this.filters.every(([field, value]) => field.split(".").reduce((v, k) => (v == null ? v : v[k]), data) === value);
      if (pass) docs.push(snapshot(new Doc(this.store, path), data));
    }
    return { docs };
  }
}
function snapshot(ref, data) {
  return { id: ref.id, ref, exists: data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
}
class FakeDb {
  constructor() { this.store = new Map(); }
  collection(name) { return new Collection(this.store, name); }
  async runTransaction(fn) {
    return fn({ get: (ref) => ref.get(), set: (ref, data) => { this.store.set(ref.path, structuredClone(data)); } });
  }
  lifeEvents(calendarId = "cal1") {
    return [...this.store].filter(([path]) => path.startsWith(`lifeCalendars/${calendarId}/lifeEvents/`)).map(([, data]) => data);
  }
}

const sync = (db, event, eventId = "ev1") => syncCalendarEventLifeEvents(db, { calendarId: "cal1", eventId, event, ownerUid: "u1" });
const titles = (db) => db.lifeEvents().map((e) => e.title).sort();

test("a calendar event shows on each day up to a month, and on the first and last day when longer", () => {
  assert.deepEqual(calendarEventDays({ title: "Dentist", startDate: "2026-10-24", endDate: "2026-10-24" }).map((d) => [d.dateId, d.title]),
    [["2026-10-24", "Dentist"]]);
  assert.deepEqual(calendarEventDays({ title: "Montreal trip", startDate: "2026-10-30", endDate: "2026-11-02" }).map((d) => [d.dateId, d.title]), [
    ["2026-10-30", "Montreal trip — day 1 of 4"],
    ["2026-10-31", "Montreal trip — day 2 of 4"],
    ["2026-11-01", "Montreal trip — day 3 of 4"],
    ["2026-11-02", "Montreal trip — day 4 of 4"]
  ]);
  assert.equal(calendarEventDays({ title: "Month", startDate: "2026-01-01", endDate: "2026-01-31" }).length, 31);
  assert.deepEqual(calendarEventDays({ title: "University", startDate: "2005-09-01", endDate: "2009-04-30" }).map((d) => [d.dateId, d.title, d.phase]), [
    ["2005-09-01", "University — first day", "first"],
    ["2009-04-30", "University — last day", "last"]
  ]);
  assert.deepEqual(calendarEventDays({ title: "No end", startDate: "2026-10-24" }).map((d) => d.dateId), ["2026-10-24"]);
  assert.deepEqual(calendarEventDays({ title: "Backwards", startDate: "2026-10-24", endDate: "2026-10-20" }), []);
  assert.deepEqual(calendarEventDays({ title: "Bad", startDate: "soon" }), []);
  assert.equal(calendarEventDays({ startDate: "2026-10-24" })[0].title, "Calendar event");
});

test("each day is a date-only calendar life event at local midnight, keyed by the event and the day", () => {
  const event = { title: "Dentist", description: "Cleaning", startDate: "2026-10-24", endDate: "2026-10-24", color: "#ff0000", visibility: "viewers" };
  const [day] = calendarEventDays(event);
  const record = buildCalendarLifeEventRecord({ calendarId: "cal1", ownerUid: "u1", eventId: "ev1", event, day });
  assert.equal(record.eventType, "calendar_event");
  assert.equal(record.sourceApp, "timelefttolive");
  assert.equal(record.eventClass, "project");
  assert.equal(record.title, "Dentist");
  assert.equal(record.occurredAt.toISOString(), "2026-10-24T04:00:00.000Z"); // midnight in Toronto (EDT)
  assert.equal(record.timeLeftUserId, "u1");
  assert.equal(record.privacyLevel, "viewers");
  assert.deepEqual(
    { dateOnly: record.metadata.dateOnly, dateId: record.metadata.dateId, calendarEventId: record.metadata.calendarEventId, note: record.metadata.note, color: record.metadata.color },
    { dateOnly: true, dateId: "2026-10-24", calendarEventId: "ev1", note: "Cleaning", color: "#ff0000" }
  );
  const again = buildCalendarLifeEventRecord({ calendarId: "cal1", ownerUid: "u1", eventId: "ev1", event: { ...event, title: "Dentist (moved room)" }, day });
  assert.equal(again.idempotencyKey, record.idempotencyKey, "same event and day, same life event");
  assert.notEqual(again.contentHash, record.contentHash);
  const other = buildCalendarLifeEventRecord({ calendarId: "cal1", ownerUid: "u1", eventId: "ev2", event, day });
  assert.notEqual(other.idempotencyKey, record.idempotencyKey);
});

test("adding, renaming, shortening and deleting a calendar event keeps its life events in step", async () => {
  const db = new FakeDb();
  assert.deepEqual(await sync(db, { title: "Trip", startDate: "2026-10-30", endDate: "2026-11-01" }), { created: 3, updated: 0, unchanged: 0, kept: 0, deleted: 0 });
  assert.deepEqual(titles(db), ["Trip — day 1 of 3", "Trip — day 2 of 3", "Trip — day 3 of 3"]);

  assert.deepEqual(await sync(db, { title: "Trip", startDate: "2026-10-30", endDate: "2026-11-01" }), { created: 0, updated: 0, unchanged: 3, kept: 0, deleted: 0 });

  const renamed = await sync(db, { title: "Montreal", startDate: "2026-10-30", endDate: "2026-11-01" });
  assert.equal(renamed.updated, 3, "a rename updates the days rather than failing as a conflict");
  assert.deepEqual(titles(db), ["Montreal — day 1 of 3", "Montreal — day 2 of 3", "Montreal — day 3 of 3"]);

  const shorter = await sync(db, { title: "Montreal", startDate: "2026-10-30", endDate: "2026-10-31" });
  assert.equal(shorter.deleted, 1);
  assert.deepEqual(titles(db), ["Montreal — day 1 of 2", "Montreal — day 2 of 2"]);

  assert.deepEqual(await sync(db, null), { created: 0, updated: 0, unchanged: 0, kept: 0, deleted: 2 });
  assert.deepEqual(db.lifeEvents(), []);
});

test("a day deleted or edited in the Activity dashboard stays that way, and other life events are untouched", async () => {
  const db = new FakeDb();
  await sync(db, { title: "Trip", startDate: "2026-10-30", endDate: "2026-10-31" });
  const [first, second] = db.lifeEvents().sort((a, b) => a.metadata.dateId.localeCompare(b.metadata.dateId));
  // the first day was deleted from the dashboard (tombstoned), the second edited there
  db.store.delete(`lifeCalendars/cal1/lifeEvents/${first.id}`);
  db.store.set(`lifeCalendars/cal1/lifeEventTombstones/${first.id}`, { deletedAt: new Date() });
  db.store.set(`lifeCalendars/cal1/lifeEvents/${second.id}`, { ...second, title: "My own title", manualOverride: true });
  db.store.set("lifeCalendars/cal1/lifeEvents/gym1", { id: "gym1", sourceApp: "GYM-K2", eventType: "workout", title: "Push day", metadata: { calendarEventId: "ev1" } });

  const counts = await sync(db, { title: "Renamed trip", startDate: "2026-10-30", endDate: "2026-10-31" });
  assert.deepEqual(counts, { created: 0, updated: 0, unchanged: 0, kept: 2, deleted: 0 });
  assert.deepEqual(titles(db), ["My own title", "Push day"]);

  await sync(db, null);
  assert.deepEqual(titles(db), ["Push day"], "deleting the calendar event removes its days, never another source's events");
});

test("a chapter of life adds its first and last day only", async () => {
  const db = new FakeDb();
  await sync(db, { title: "Living in Toronto", startDate: "2008-06-01", endDate: "2026-10-24" }, "ev9");
  assert.deepEqual(titles(db), ["Living in Toronto — first day", "Living in Toronto — last day"]);
  assert.deepEqual(db.lifeEvents().map((e) => e.metadata.dateId).sort(), ["2008-06-01", "2026-10-24"]);
});

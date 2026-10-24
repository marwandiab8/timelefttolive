const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DAILY_LIMIT_DAYS,
  todayDateId,
  calendarEventDays,
  buildCalendarLifeEventRecord,
  syncCalendarEventLifeEvents,
  carryOngoingCalendarEvents
} = require("./calendarLifeEvents");

// A small in-memory Firestore: documents by path, nested-field equality queries, getAll and batched writes.
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
  constructor() { this.store = new Map(); this.commits = 0; }
  collection(name) { return new Collection(this.store, name); }
  async getAll(...refs) { return Promise.all(refs.map((ref) => ref.get())); }
  batch() {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => this.store.set(ref.path, structuredClone(data))),
      delete: (ref) => ops.push(() => this.store.delete(ref.path)),
      commit: async () => { this.commits += 1; ops.forEach((op) => op()); }
    };
  }
  lifeEvents(calendarId = "cal1") {
    return [...this.store].filter(([path]) => path.startsWith(`lifeCalendars/${calendarId}/lifeEvents/`)).map(([, data]) => data);
  }
}

const TODAY = "2026-10-24";
const sync = (db, event, eventId = "ev1", today = TODAY) => syncCalendarEventLifeEvents(db, { calendarId: "cal1", eventId, event, ownerUid: "u1", today });
const titles = (db) => db.lifeEvents().map((e) => e.title).sort();
const byDate = (db) => db.lifeEvents().sort((a, b) => a.metadata.dateId.localeCompare(b.metadata.dateId));

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

test("an ongoing event is carried every day through today, and an every-day one on every day it covers", () => {
  const ongoing = calendarEventDays({ title: "With Ashley", startDate: "2026-10-20", endDate: "", ongoing: true }, { today: TODAY });
  assert.deepEqual(ongoing.map((d) => [d.dateId, d.title, d.dayCount]), [
    ["2026-10-20", "With Ashley — day 1", null],
    ["2026-10-21", "With Ashley — day 2", null],
    ["2026-10-22", "With Ashley — day 3", null],
    ["2026-10-23", "With Ashley — day 4", null],
    ["2026-10-24", "With Ashley — day 5", null]
  ]);
  const years = calendarEventDays({ title: "With Ashley", startDate: "2021-04-17", ongoing: true }, { today: TODAY });
  assert.equal(years.length, 2017);
  assert.equal(years.at(-1).title, "With Ashley — day 2,017");
  assert.deepEqual(calendarEventDays({ title: "Later", startDate: "2026-11-01", ongoing: true }, { today: TODAY }), [], "nothing until it starts");
  const everyDay = calendarEventDays({ title: "Course", startDate: "2026-01-01", endDate: "2026-03-31", everyDay: true });
  assert.equal(everyDay.length, 90);
  assert.equal(everyDay[89].title, "Course — day 90");
  const capped = calendarEventDays({ title: "Since 1990", startDate: "1990-01-01", ongoing: true }, { today: TODAY });
  assert.equal(capped.length, DAILY_LIMIT_DAYS + 1, "the first day and the last ten years");
  assert.equal(capped[0].dateId, "1990-01-01");
  assert.equal(capped.at(-1).dateId, TODAY);
  assert.match(todayDateId(new Date("2026-10-25T03:30:00Z")), /^2026-10-24$/, "today is Toronto's today");
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
    { dateOnly: record.metadata.dateOnly, dateId: record.metadata.dateId, calendarEventId: record.metadata.calendarEventId, note: record.metadata.note, color: record.metadata.color, ongoing: record.metadata.ongoing },
    { dateOnly: true, dateId: "2026-10-24", calendarEventId: "ev1", note: "Cleaning", color: "#ff0000", ongoing: false }
  );
  const again = buildCalendarLifeEventRecord({ calendarId: "cal1", ownerUid: "u1", eventId: "ev1", event: { ...event, title: "Dentist (moved room)" }, day });
  assert.equal(again.idempotencyKey, record.idempotencyKey, "same event and day, same life event");
  assert.notEqual(again.contentHash, record.contentHash);
  const other = buildCalendarLifeEventRecord({ calendarId: "cal1", ownerUid: "u1", eventId: "ev2", event, day });
  assert.notEqual(other.idempotencyKey, record.idempotencyKey);
});

test("an ongoing event's day reads the same whichever night it is written", () => {
  const event = { title: "With Ashley", startDate: "2026-10-20", ongoing: true, visibility: "ownerOnly" };
  const record = (today) => {
    const day = calendarEventDays(event, { today }).find((d) => d.dateId === "2026-10-22");
    return buildCalendarLifeEventRecord({ calendarId: "cal1", ownerUid: "u1", eventId: "ev1", event, day });
  };
  assert.equal(record("2026-10-22").contentHash, record("2026-11-30").contentHash);
  assert.equal(record("2026-10-22").metadata.endDate, "");
});

test("adding, renaming, shortening and deleting a calendar event keeps its life events in step", async () => {
  const db = new FakeDb();
  assert.deepEqual(await sync(db, { title: "Trip", startDate: "2026-10-30", endDate: "2026-11-01" }), { created: 3, updated: 0, unchanged: 0, kept: 0, deleted: 0 });
  assert.deepEqual(titles(db), ["Trip — day 1 of 3", "Trip — day 2 of 3", "Trip — day 3 of 3"]);
  assert.equal(db.lifeEvents()[0].ingestionStatus, "received");

  assert.deepEqual(await sync(db, { title: "Trip", startDate: "2026-10-30", endDate: "2026-11-01" }), { created: 0, updated: 0, unchanged: 3, kept: 0, deleted: 0 });

  const renamed = await sync(db, { title: "Montreal", startDate: "2026-10-30", endDate: "2026-11-01" });
  assert.equal(renamed.updated, 3);
  assert.deepEqual(titles(db), ["Montreal — day 1 of 3", "Montreal — day 2 of 3", "Montreal — day 3 of 3"]);
  assert.equal(db.lifeEvents()[0].revisionCount, 1);

  const shorter = await sync(db, { title: "Montreal", startDate: "2026-10-30", endDate: "2026-10-31" });
  assert.equal(shorter.deleted, 1);
  assert.deepEqual(titles(db), ["Montreal — day 1 of 2", "Montreal — day 2 of 2"]);

  assert.deepEqual(await sync(db, null), { created: 0, updated: 0, unchanged: 0, kept: 0, deleted: 2 });
  assert.deepEqual(db.lifeEvents(), []);
});

test("a day deleted or edited in the Activity dashboard stays that way, and other life events are untouched", async () => {
  const db = new FakeDb();
  await sync(db, { title: "Trip", startDate: "2026-10-30", endDate: "2026-10-31" });
  const [first, second] = byDate(db);
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

test("making a chapter ongoing carries it every day, the next night adds one day, and stopping keeps every day", async () => {
  const db = new FakeDb();
  const event = { title: "With Ashley", startDate: "2021-04-17", endDate: "2026-08-31" };
  await sync(db, event, "ash");
  assert.deepEqual(titles(db), ["With Ashley — first day", "With Ashley — last day"]);

  const ongoing = { ...event, endDate: "", ongoing: true, everyDay: true };
  const made = await sync(db, ongoing, "ash");
  assert.deepEqual(made, { created: 2015, updated: 2, unchanged: 0, kept: 0, deleted: 0 }, "the first and last day become day 1 and day 1,963");
  assert.equal(db.lifeEvents().length, 2017);
  assert.ok(db.commits >= 6, "written in batches");

  const nextNight = await sync(db, ongoing, "ash", "2026-10-25");
  assert.deepEqual(nextNight, { created: 1, updated: 0, unchanged: 2017, kept: 0, deleted: 0 });
  assert.equal(byDate(db).at(-1).title, "With Ashley — day 2,018");

  const stopped = await sync(db, { ...ongoing, ongoing: false, endDate: "2026-10-25" }, "ash", "2026-11-03");
  assert.deepEqual({ created: stopped.created, deleted: stopped.deleted }, { created: 0, deleted: 0 }, "stopping keeps the days, and adds none after the end");
  assert.equal(db.lifeEvents().length, 2018);
  assert.equal(byDate(db).at(-1).metadata.endDate, "2026-10-25");
});

test("the nightly carry adds today to each ongoing event and leaves the others alone", async () => {
  const db = new FakeDb();
  db.store.set("lifeCalendars/cal1", { ownerUid: "u1" });
  db.store.set("lifeCalendars/cal1/events/ash", { title: "With Ashley", startDate: "2026-10-22", endDate: "", ongoing: true, everyDay: true });
  db.store.set("lifeCalendars/cal1/events/trip", { title: "Trip", startDate: "2026-10-01", endDate: "2026-10-02" });
  const totals = await carryOngoingCalendarEvents(db, { today: TODAY });
  assert.deepEqual(totals, { events: 1, created: 3, updated: 0, unchanged: 0, kept: 0, deleted: 0 });
  assert.deepEqual(titles(db), ["With Ashley — day 1", "With Ashley — day 2", "With Ashley — day 3"]);
  assert.deepEqual((await carryOngoingCalendarEvents(db, { today: "2026-10-25" })).created, 1);
});

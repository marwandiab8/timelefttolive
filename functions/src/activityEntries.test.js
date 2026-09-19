const assert = require('node:assert/strict');
const test = require('node:test');
const admin = require('firebase-admin');
const { editActivityEntry, deleteActivityEntry } = require('./activityEntries');

function fakeDb(seed) {
  const store = new Map(Object.entries(seed));
  const ref = (path) => ({
    path,
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    get: async () => { const value = store.get(path); return { exists: value !== undefined, data: () => value, id: path.split('/').pop() }; }
  });
  const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), runTransaction: async (fn) => fn({
    get: async (target) => target.get(),
    update: (target, value) => store.set(target.path, { ...store.get(target.path), ...value }),
    set: (target, value) => store.set(target.path, { ...store.get(target.path), ...value }),
    delete: (target) => store.delete(target.path)
  }) };
  db.store = store;
  return db;
}

function seedEvent() {
  return {
    'lifeCalendars/cal-1': { ownerUid: 'owner-1' },
    'lifeCalendars/cal-1/lifeEvents/event-1': {
      id: 'event-1', title: 'Leave Home', activityFamily: 'Home', eventType: 'leave_home',
      occurredAt: admin.firestore.Timestamp.fromDate(new Date('2026-08-31T12:00:00Z')),
      startAt: admin.firestore.Timestamp.fromDate(new Date('2026-08-31T12:00:00Z')),
      endAt: null, durationSeconds: null, metadata: { source: 'shortcut', keep: true }
    }
  };
}

test('owner can edit an active entry while preserving metadata', async () => {
  const db = fakeDb(seedEvent());
  await editActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', title: 'Corrected', endAt: null, metadata: { note: 'fixed' } });
  const event = db.store.get('lifeCalendars/cal-1/lifeEvents/event-1');
  assert.equal(event.title, 'Corrected');
  assert.equal(event.metadata.keep, true);
  assert.equal(event.metadata.note, 'fixed');
  assert.equal(event.manualOverride, true);
});

test('ownership and time validation are enforced', async () => {
  const db = fakeDb(seedEvent());
  await assert.rejects(() => editActivityEntry(db, 'other-user', { calendarId: 'cal-1', eventId: 'event-1' }), { code: 'permission-denied' });
  await assert.rejects(() => editActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', startAt: '2026-08-31T13:00:00Z', endAt: '2026-08-31T12:00:00Z' }), { code: 'invalid-argument' });
});

test('delete writes an owner tombstone and removes only the canonical event', async () => {
  const db = fakeDb(seedEvent());
  await deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1' });
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-1'), false);
  const tombstone = db.store.get('lifeCalendars/cal-1/lifeEventTombstones/event-1');
  assert.equal(tombstone.deletedBy, 'owner-1');
  assert.equal(tombstone.sourceApp, '');
});

test('editing an entry that has no location accepts location: null', async () => {
  // The dialog sends location: null when the location box is empty.
  const db = fakeDb(seedEvent());
  await editActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', title: 'Renamed', location: null });
  const event = db.store.get('lifeCalendars/cal-1/lifeEvents/event-1');
  assert.equal(event.title, 'Renamed');
  assert.equal(event.location, null);
});

test('location: null clears an existing location', async () => {
  const seed = seedEvent();
  seed['lifeCalendars/cal-1/lifeEvents/event-1'].location = { label: 'Home', latitude: 43.7, longitude: -79.4 };
  const db = fakeDb(seed);
  await editActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', location: null });
  assert.equal(db.store.get('lifeCalendars/cal-1/lifeEvents/event-1').location, null);
});

test('omitting location leaves the stored location unchanged', async () => {
  const seed = seedEvent();
  seed['lifeCalendars/cal-1/lifeEvents/event-1'].location = { label: 'Home' };
  const db = fakeDb(seed);
  await editActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', title: 'Renamed' });
  assert.deepEqual(db.store.get('lifeCalendars/cal-1/lifeEvents/event-1').location, { label: 'Home' });
});

test('location must still be an object or null', async () => {
  const db = fakeDb(seedEvent());
  for (const location of ['Home', ['Home'], 42, true]) {
    await assert.rejects(
      () => editActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', location }),
      { code: 'invalid-argument' }
    );
  }
});

function seedPair() {
  const seed = seedEvent();
  seed['lifeCalendars/cal-1/lifeEvents/event-1'] = {
    ...seed['lifeCalendars/cal-1/lifeEvents/event-1'],
    eventType: 'arrive_home', idempotencyKey: 'key-arrive', sourceApp: 'shortcut', sourceEventId: 'src-arrive'
  };
  seed['lifeCalendars/cal-1/lifeEvents/event-2'] = {
    id: 'event-2', eventType: 'leave_home', idempotencyKey: 'key-leave', sourceApp: 'shortcut', sourceEventId: 'src-leave',
    occurredAt: admin.firestore.Timestamp.fromDate(new Date('2026-08-31T20:00:00Z'))
  };
  return seed;
}

test('deleting a paired session removes both boundary events and tombstones both', async () => {
  const db = fakeDb(seedPair());
  await deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', linkedEventId: 'event-2' });
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-1'), false);
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-2'), false);
  const arrive = db.store.get('lifeCalendars/cal-1/lifeEventTombstones/event-1');
  const leave = db.store.get('lifeCalendars/cal-1/lifeEventTombstones/event-2');
  assert.equal(arrive.idempotencyKey, 'key-arrive');
  assert.equal(leave.idempotencyKey, 'key-leave');
  assert.equal(leave.sourceEventId, 'src-leave');
  assert.equal(leave.deletedBy, 'owner-1');
});

test('deleting without linkedEventId leaves the other boundary alone', async () => {
  const db = fakeDb(seedPair());
  await deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1' });
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-2'), true);
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEventTombstones/event-2'), false);
});

test('a null or empty linkedEventId is treated as no linked event', async () => {
  // The callable client encodes undefined as null, so unpaired deletes can arrive this way.
  for (const linkedEventId of [null, '']) {
    const db = fakeDb(seedPair());
    await deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', linkedEventId });
    assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-1'), false);
    assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-2'), true);
  }
});

test('a missing linked event aborts the delete without changing anything', async () => {
  const db = fakeDb(seedPair());
  await assert.rejects(
    () => deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', linkedEventId: 'no-such-event' }),
    { code: 'not-found' }
  );
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-1'), true);
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEventTombstones/event-1'), false);
});

test('a non-owner cannot delete either half of a paired session', async () => {
  const db = fakeDb(seedPair());
  await assert.rejects(
    () => deleteActivityEntry(db, 'other-user', { calendarId: 'cal-1', eventId: 'event-1', linkedEventId: 'event-2' }),
    { code: 'permission-denied' }
  );
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-1'), true);
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-2'), true);
});

test('paired boundary edits update the linked departure timestamp', async () => {
  const seed = seedEvent();
  seed['lifeCalendars/cal-1/lifeEvents/event-2'] = { id: 'event-2', eventType: 'leave_home', occurredAt: admin.firestore.Timestamp.fromDate(new Date('2026-08-31T13:30:00Z')) };
  const db = fakeDb(seed);
  await editActivityEntry(db, 'owner-1', {
    calendarId: 'cal-1', eventId: 'event-1', linkedEventId: 'event-2',
    startAt: '2026-08-31T06:00:00Z', endAt: '2026-08-31T08:51:00Z', linkedEndAt: '2026-08-31T08:51:00Z'
  });
  assert.equal(db.store.get('lifeCalendars/cal-1/lifeEvents/event-2').occurredAt.toDate().toISOString(), '2026-08-31T08:51:00.000Z');
});

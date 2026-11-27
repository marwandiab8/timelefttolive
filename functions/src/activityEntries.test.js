const assert = require('node:assert/strict');
const test = require('node:test');
const admin = require('firebase-admin');
const { editActivityEntry, deleteActivityEntry, restoreActivityEntry, createActivityEntry } = require('./activityEntries');

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

test('delete keeps a copy in the recycle bin, and restore brings the event back and lifts the tombstone', async () => {
  const db = fakeDb(seedEvent());
  await deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1' });
  const copy = db.store.get('lifeCalendars/cal-1/lifeEventRecycleBin/event-1');
  assert.equal(copy.title, 'Leave Home');
  assert.equal(copy.recycledBy, 'owner-1');
  assert.deepEqual(copy.recycledWith, ['event-1']);
  assert.ok(copy.expiresAt.toDate().getTime() > Date.now() + 80 * 24 * 3600 * 1000);

  await assert.rejects(() => restoreActivityEntry(db, 'other-user', { calendarId: 'cal-1', eventId: 'event-1' }), { code: 'permission-denied' });
  const result = await restoreActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1' });
  assert.deepEqual(result, { ids: ['event-1'] });
  const event = db.store.get('lifeCalendars/cal-1/lifeEvents/event-1');
  assert.equal(event.title, 'Leave Home');
  assert.equal(event.eventType, 'leave_home');
  assert.equal(event.metadata.keep, true);
  assert.equal(event.restoredBy, 'owner-1');
  assert.equal('recycledAt' in event, false);
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEventTombstones/event-1'), false);
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEventRecycleBin/event-1'), false);
  await assert.rejects(() => restoreActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1' }), { code: 'not-found' });
});

test('a paired session deleted together is restored together', async () => {
  const seed = seedEvent();
  seed['lifeCalendars/cal-1/lifeEvents/event-2'] = { id: 'event-2', title: 'Arrived Home', eventType: 'arrive_home', occurredAt: admin.firestore.Timestamp.fromDate(new Date('2026-08-31T20:00:00Z')) };
  const db = fakeDb(seed);
  await deleteActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-1', linkedEventId: 'event-2' });
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEvents/event-2'), false);
  const result = await restoreActivityEntry(db, 'owner-1', { calendarId: 'cal-1', eventId: 'event-2' });
  assert.deepEqual(result.ids.sort(), ['event-1', 'event-2']);
  assert.equal(db.store.get('lifeCalendars/cal-1/lifeEvents/event-1').title, 'Leave Home');
  assert.equal(db.store.get('lifeCalendars/cal-1/lifeEvents/event-2').title, 'Arrived Home');
  assert.equal(db.store.has('lifeCalendars/cal-1/lifeEventTombstones/event-2'), false);
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

test('the owner can add an activity by hand, shaped like any other life event', async () => {
  const db = fakeDb({ 'lifeCalendars/cal-1': { ownerUid: 'owner-1' } });
  const result = await createActivityEntry(db, 'owner-1', {
    calendarId: 'cal-1', category: 'Reading', startAt: '2026-11-25T02:00:00Z', endAt: '2026-11-25T02:45:00Z', note: ' Dune '
  }, { now: new Date('2026-11-26T12:00:00Z'), newId: () => 'abc' });
  assert.deepEqual(result, { ok: true, eventId: 'manual_abc' });
  const event = db.store.get('lifeCalendars/cal-1/lifeEvents/manual_abc');
  assert.equal(event.sourceApp, 'manual');
  assert.equal(event.activityFamily, 'reading');
  assert.equal(event.eventClass, 'completed_activity');
  assert.equal(event.title, 'Reading');
  assert.equal(event.durationSeconds, 2700);
  assert.equal(event.privacyLevel, 'ownerOnly');
  assert.equal(event.metadata.note, 'Dune');
  assert.equal(event.startAt.toDate().toISOString(), '2026-11-25T02:00:00.000Z');
});

test('a hand-added "Other" activity keeps its own name', async () => {
  const db = fakeDb({ 'lifeCalendars/cal-1': { ownerUid: 'owner-1' } });
  await createActivityEntry(db, 'owner-1', { calendarId: 'cal-1', category: 'Other', name: 'Hockey', startAt: '2026-11-25T23:00:00Z', endAt: '2026-11-26T00:30:00Z' }, { now: new Date('2026-11-26T12:00:00Z'), newId: () => 'h' });
  const event = db.store.get('lifeCalendars/cal-1/lifeEvents/manual_h');
  assert.equal(event.activityFamily, 'hockey');
  assert.equal(event.title, 'Hockey');
});

test('adding by hand checks the owner, the kind and the times', async () => {
  const db = fakeDb({ 'lifeCalendars/cal-1': { ownerUid: 'owner-1' } });
  const now = { now: new Date('2026-11-26T12:00:00Z') };
  const good = { calendarId: 'cal-1', category: 'Work', startAt: '2026-11-25T13:00:00Z', endAt: '2026-11-25T21:00:00Z' };
  await assert.rejects(() => createActivityEntry(db, 'someone-else', good, now), { code: 'permission-denied' });
  await assert.rejects(() => createActivityEntry(db, 'owner-1', { ...good, category: 'Nonsense' }, now), { code: 'invalid-argument' });
  await assert.rejects(() => createActivityEntry(db, 'owner-1', { ...good, category: 'Other' }, now), { code: 'invalid-argument' });
  await assert.rejects(() => createActivityEntry(db, 'owner-1', { ...good, endAt: good.startAt }, now), { code: 'invalid-argument' });
  await assert.rejects(() => createActivityEntry(db, 'owner-1', { ...good, endAt: '2026-11-27T13:00:00Z' }, now), { code: 'invalid-argument' });
  await assert.rejects(() => createActivityEntry(db, 'owner-1', { ...good, startAt: '2026-11-27T13:00:00Z', endAt: '2026-11-27T14:00:00Z' }, now), { code: 'invalid-argument' });
  await assert.rejects(() => createActivityEntry(db, 'owner-1', { ...good, endAt: null }, now), { code: 'invalid-argument' });
  assert.equal([...db.store.keys()].some((key) => key.includes('lifeEvents')), false);
});

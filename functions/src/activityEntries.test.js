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

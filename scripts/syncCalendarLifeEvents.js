#!/usr/bin/env node
// Bring every main-calendar event's life events in line with the event, the same way the
// syncCalendarEventToLifeEvents trigger does on each write (functions/src/calendarLifeEvents.js). Use it once after
// the trigger is first deployed, for the events that were already there, or to repair. Also removes calendar life
// events whose event no longer exists. A dry run unless --apply is passed.
//
//   npm run sync:calendar-life-events -- --project=timelefttolive [--calendar-id=ID] [--apply]
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
  CALENDAR_SOURCE_APP,
  CALENDAR_EVENT_TYPE,
  calendarEventDays,
  syncCalendarEventLifeEvents
} = require('../functions/src/calendarLifeEvents.js');

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    options[key] = rest.length ? rest.join('=') : true;
  }
  return options;
}

const args = parseArgs(process.argv.slice(2));
const projectId = typeof args.project === 'string' ? args.project.trim() : '';
if (!projectId) throw new Error('Missing required --project argument.');
const apply = args.apply === true;
const db = getFirestore(initializeApp({ projectId }, `calendar-life-events-${Date.now()}`));

const calendars = typeof args['calendar-id'] === 'string'
  ? [await db.collection('lifeCalendars').doc(args['calendar-id']).get()]
  : (await db.collection('lifeCalendars').get()).docs;

const totals = { calendars: 0, events: 0, days: 0, created: 0, updated: 0, unchanged: 0, kept: 0, deleted: 0, orphansDeleted: 0 };
for (const calendar of calendars) {
  if (!calendar.exists) continue;
  totals.calendars += 1;
  const ownerUid = (calendar.data() || {}).ownerUid || '';
  const events = (await calendar.ref.collection('events').get()).docs;
  const eventIds = new Set(events.map((doc) => doc.id));
  for (const doc of events) {
    const event = doc.data() || {};
    const days = calendarEventDays(event);
    totals.events += 1;
    totals.days += days.length;
    console.log(`${calendar.id.slice(0, 6)}… ${doc.id.slice(0, 6)}… ${event.startDate || '?'}..${event.endDate || event.startDate || '?'}: ${days.length} day(s)${days.length ? ` (${days[0].phase})` : ''}`);
    if (!apply) continue;
    const counts = await syncCalendarEventLifeEvents(db, { calendarId: calendar.id, eventId: doc.id, event, ownerUid });
    for (const key of ['created', 'updated', 'unchanged', 'kept', 'deleted']) totals[key] += counts[key];
  }
  // calendar life events left behind by an event that no longer exists
  const derived = await calendar.ref.collection('lifeEvents').where('eventType', '==', CALENDAR_EVENT_TYPE).get();
  for (const doc of derived.docs) {
    const data = doc.data() || {};
    if (data.sourceApp !== CALENDAR_SOURCE_APP || eventIds.has(data.metadata?.calendarEventId)) continue;
    totals.orphansDeleted += 1;
    if (apply) await doc.ref.delete();
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', projectId, ...totals }));

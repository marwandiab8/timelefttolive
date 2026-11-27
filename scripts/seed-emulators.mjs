#!/usr/bin/env node
// Fills the local Firebase emulators with a realistic demo calendar, so every feature can be clicked through without
// real data. It only ever talks to the emulators of the `demo-timelefttolive` project: the emulator hosts are forced
// below, and a `demo-` project ID cannot reach a real Firebase project.
//
//   firebase emulators:start --only auth,firestore,storage --project demo-timelefttolive
//   npm run seed:emulators            (in a second terminal; run it again to reset the demo data)
//
// Sign in at http://localhost:5174 (npm run dev:emulators) with the demo account below. These are emulator-only
// test credentials.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { lifeWeekFor, previousLifeWeek } from '../src/utils/weeklyReview.js';

export const DEMO_PROJECT_ID = 'demo-timelefttolive';
export const DEMO_EMAIL = 'owner@demo.test';
export const DEMO_PASSWORD = 'demo-owner-password';
export const DEMO_VIEWER_EMAIL = 'viewer@demo.test';
export const DEMO_VIEWER_PASSWORD = 'demo-viewer-password';
const CALENDAR_ID = 'demo-calendar';
const TIME_ZONE = 'America/Toronto';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)
  || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error('Refusing to seed: the emulator hosts must be on this machine.');
  process.exit(1);
}

// YYYY-MM-DD for a local calendar day, `days` from `from`.
function dayId(from, days = 0) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The instant the Toronto clock shows hh:mm on `dateId`.
function torontoTime(dateId, hours, minutes = 0) {
  const [year, month, day] = dateId.split('-').map(Number);
  let guess = Date.UTC(year, month - 1, day, hours + 5, minutes);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const wanted = Date.UTC(year, month - 1, day, hours, minutes);
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess);
}

function lifeEvent(id, fields) {
  const occurredAt = fields.occurredAt;
  return {
    id,
    data: {
      sourceApp: 'gridlineai',
      sourceRecordId: id,
      timeLeftUserId: 'demo-owner',
      location: null,
      ...fields,
      occurredAt: Timestamp.fromDate(occurredAt),
      ...(fields.startAt ? { startAt: Timestamp.fromDate(fields.startAt) } : {}),
      ...(fields.endAt ? { endAt: Timestamp.fromDate(fields.endAt) } : {}),
      receivedAt: Timestamp.fromDate(occurredAt)
    }
  };
}

function visit(id, label, activity, startAt, endAt) {
  const base = {
    eventClass: 'location', activityFamily: 'location', categoryId: 'other_location', title: `${activity} at ${label}`,
    location: { label, latitude: 43.55, longitude: -80.25 }, metadata: { placeActivity: activity }
  };
  const events = [lifeEvent(`${id}-in`, { ...base, eventType: 'arrive_location', occurredAt: startAt })];
  if (endAt) events.push(lifeEvent(`${id}-out`, { ...base, eventType: 'leave_location', occurredAt: endAt, startAt, endAt }));
  return events;
}

function night(id, bedtime, wake) {
  return lifeEvent(id, {
    eventType: 'sleep_session', eventClass: 'activity_boundary', activityFamily: 'sleep', categoryId: 'sleep', title: 'Slept',
    occurredAt: bedtime, startAt: bedtime, endAt: wake, metrics: { totalSleepHours: Math.round(((wake - bedtime) / 3.6e6) * 100) / 100 }
  });
}

// Two weeks of ordinary life: nights, work on weekdays, the gym three times a week, darts on Thursdays. Yesterday's
// gym visit has no departure, so the tracking-health features have something to find.
export function buildDemoLifeEvents(today) {
  const events = [];
  for (let offset = -14; offset <= 0; offset += 1) {
    const date = dayId(today, offset);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const bedtime = torontoTime(dayId(today, offset - 1), 22 + (offset % 2), 40);
    const wake = torontoTime(date, 6, 15 + ((offset * 7) % 30));
    events.push(night(`night-${date}`, bedtime, wake));
    // Two nights ago arrived three times, with later bedtimes and less sleep (the tracking-health list shows it).
    if (offset === -2) {
      events.push(night(`night-${date}-again-1`, new Date(bedtime.getTime() + 75 * 60000), wake));
      events.push(night(`night-${date}-again-2`, new Date(bedtime.getTime() + 150 * 60000), wake));
    }
    // Five days ago a drive started and never finished.
    if (offset === -5) {
      events.push(lifeEvent(`drive-${date}`, { eventType: 'start_drive', eventClass: 'activity_boundary', title: 'Started driving', occurredAt: torontoTime(date, 18, 40) }));
    }
    if (offset === 0) continue;
    if (weekday >= 1 && weekday <= 5) {
      events.push(...visit(`work-${date}`, 'Site office', 'work', torontoTime(date, 7, 30), torontoTime(date, 16, 10)));
    }
    if ([1, 3, 5].includes(weekday)) {
      const end = offset === -1 ? null : torontoTime(date, 18, 25);
      events.push(...visit(`gym-${date}`, 'Downtown gym', 'gym', torontoTime(date, 17, 10), end));
    }
    if (weekday === 4) events.push(...visit(`darts-${date}`, 'Darts club', 'darts', torontoTime(date, 19, 30), torontoTime(date, 22, 0)));
  }
  return events;
}

export function buildDemoCalendar(today) {
  // The custody schedule is anchored on this week's Sunday, so the demo owner has the kids this week.
  const sunday = dayId(today, -today.getDay());
  return {
    ownerUid: 'demo-owner',
    firstName: 'Sam',
    lastName: 'Demo',
    birthDate: '1985-03-14',
    targetAge: 90,
    targetEndDate: '2075-03-14',
    spouse: { name: '', birthDate: '' },
    children: [
      {
        id: 'child-alex', name: 'Alex', birthDate: '2010-07-12', grade: '11', gradeSchoolYear: 2026, school: 'Riverside High',
        details: [
          { id: 'd1', label: 'Height, Nov 23, 2026', value: "5' 11\"" },
          { id: 'd2', label: 'Height, Sep 27, 2026', value: "5' 10 9/8\"" },
          { id: 'd3', label: 'Height, Feb 10, 2025', value: "5' 8 1/2\"" },
          { id: 'd4', label: 'Height, May 3, 2023', value: "5' 2 3/4\"" },
          { id: 'd5', label: 'Shoe size', value: '11' }
        ]
      },
      {
        id: 'child-ben', name: 'Ben', birthDate: '2011-05-03', grade: '10', gradeSchoolYear: 2026, school: 'Riverside High',
        details: [
          { id: 'd6', label: 'Height, Jan 12, 2025', value: "5' 6 7/16\"" },
          { id: 'd7', label: 'Height, Jun 2, 2024', value: "5' 4 7/8\"" }
        ]
      },
      {
        id: 'child-charlie', name: 'Charlie', birthDate: '2013-04-20', grade: '8', gradeSchoolYear: 2026, school: 'Maple PS',
        details: [{ id: 'd8', label: 'Height, Nov 23, 2026', value: "5' 3 7/8\"" }]
      },
      { id: 'child-drew', name: 'Drew', birthDate: '2013-10-09', grade: '8', gradeSchoolYear: 2026, school: 'Maple PS', details: [] }
    ],
    custodySchedule: {
      enabled: true, nextStartDate: sunday, since: '2024-09-01', cycleWeeks: 2, withParentWeeks: 1, countUntilChildAge: 18,
      childIds: ['child-alex', 'child-ben', 'child-charlie', 'child-drew']
    },
    settings: { pastColor: '#46505c', currentWeekColor: '#f4c542', futureColor: '#17222c', defaultEventColor: '#7c9cff' },
    activityTargets: { Sleep: { minSeconds: 7 * 3600 }, 'Gym/Fitness': { sessionsPerWeek: 3 } },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };
}

export function buildDemoEvents(today) {
  const year = today.getFullYear();
  return [
    { id: 'event-cottage', title: 'Cottage week with the boys', startDate: `${year}-07-20`, endDate: `${year}-07-26`, color: '#4fb286', visibility: 'viewers' },
    { id: 'event-move', title: 'Moved house', startDate: '2019-09-01', endDate: '2019-09-01', color: '#c98bdb', visibility: 'viewers' },
    { id: 'event-trip', title: 'Montreal trip', startDate: `${year - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(Math.min(today.getDate(), 28)).padStart(2, '0')}`, endDate: `${year - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(Math.min(today.getDate(), 28)).padStart(2, '0')}`, color: '#7c9cff', visibility: 'ownerOnly' }
  ].map(({ id, ...data }) => ({ id, data: { ...data, description: '', createdAt: Timestamp.now(), updatedAt: Timestamp.now() } }));
}

export function buildDemoDailyEntries(today) {
  const entry = (dateId, notes, visibility = 'ownerOnly') => ({
    id: dateId,
    data: { dateId, date: dateId, journalText: '', notes, tags: [], visibility, updatedAt: Timestamp.now(), updatedByUid: 'demo-owner', createdAt: Timestamp.now() }
  });
  return [
    entry(dayId(today, -1), 'Long day on site. Gym after, but forgot to log leaving.'),
    entry(dayId(today, -3), 'Took the boys for wings after hockey. Charlie talked the whole way home.', 'viewers'),
    entry(dayId(today, -9), 'Quiet week. Read before bed most nights.'),
    entry(dayId(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())), 'Montreal: Alex ate three bagels in a row.')
  ];
}

// Reviews for most of the twelve weeks before last week (last week is left for you to review), so the life calendar's
// "How the week went" view has something to show.
export function buildDemoReviews(today) {
  const ratings = [4, 3, null, 5, 2, 4, 3, 4, null, 1, 3, 4];
  const words = ['Cottage plans with the boys', 'Long site week', '', 'Hockey final, all four of us', 'Sick most of the week', 'Good gym streak', 'Quiet', 'Parent-teacher nights', '', 'Rough one at work', 'Back on track', 'Wings after hockey'];
  const reviews = [];
  let week = previousLifeWeek('1985-03-14', lifeWeekFor('1985-03-14', dayId(today)));
  for (let index = 0; index < ratings.length; index += 1) {
    week = previousLifeWeek('1985-03-14', week);
    if (ratings[index] === null) continue;
    reviews.push({
      id: week.start,
      data: {
        weekStart: week.start, weekEnd: week.end, rating: ratings[index], mattered: words[index], moment: '', intention: index === 0 ? 'Sleep by 11 on school nights' : '',
        intentionKept: null, numbers: null, visibility: index % 4 === 0 ? 'viewers' : 'ownerOnly', createdAt: Timestamp.now(), updatedAt: Timestamp.now()
      }
    });
  }
  return reviews;
}

// A few things to do before it's too late, one planned for the next week with the kids and one already done.
export function buildDemoPlans(today) {
  const year = today.getFullYear();
  const plan = (id, fields) => ({ id, data: { notes: '', plannedWeekStart: '', doneOn: '', visibility: 'ownerOnly', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...fields } });
  const sunday = dayId(today, 14 - today.getDay()); // the start of the next week with the kids, two weeks after this one
  return [
    plan('plan-leafs', { title: 'Take the boys to a Leafs game', who: ['child-alex', 'child-ben', 'child-charlie', 'child-drew'], deadline: { kind: 'season', season: 'christmas', year }, plannedWeekStart: sunday }),
    plan('plan-drive', { title: 'Teach Alex to drive stick', who: ['child-alex'], deadline: { kind: 'age', personId: 'child-alex', age: 18 } }),
    plan('plan-cottage', { title: 'A week at a cottage, all five of us', who: ['me', 'child-alex', 'child-ben', 'child-charlie', 'child-drew'], deadline: { kind: 'season', season: 'summer', year: year + 1 }, visibility: 'viewers' }),
    plan('plan-iceland', { title: 'See the northern lights in Iceland', who: ['me'], deadline: { kind: 'age', personId: 'me', age: 50 } }),
    plan('plan-hike', { title: 'Hike a stretch of the Bruce Trail', who: ['me', 'child-charlie'], deadline: null, doneOn: dayId(today, -10) })
  ];
}

async function upsertUser(auth, uid, email, password, displayName) {
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email, password, emailVerified: true, displayName });
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid, email, password, emailVerified: true, displayName });
  }
}

async function deleteCollection(ref) {
  const snapshot = await ref.get();
  await Promise.all(snapshot.docs.map(async (docSnap) => {
    for (const sub of await docSnap.ref.listCollections()) await deleteCollection(sub);
    await docSnap.ref.delete();
  }));
}

async function main() {
  initializeApp({ projectId: DEMO_PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();
  const today = new Date();

  await upsertUser(auth, 'demo-owner', DEMO_EMAIL, DEMO_PASSWORD, 'Sam Demo');
  await upsertUser(auth, 'demo-viewer', DEMO_VIEWER_EMAIL, DEMO_VIEWER_PASSWORD, 'Viewer Demo');

  const calendarRef = db.collection('lifeCalendars').doc(CALENDAR_ID);
  for (const sub of await calendarRef.listCollections()) await deleteCollection(sub);
  await calendarRef.set(buildDemoCalendar(today));

  const writes = [
    ...buildDemoEvents(today).map(({ id, data }) => calendarRef.collection('events').doc(id).set(data)),
    ...buildDemoDailyEntries(today).map(({ id, data }) => calendarRef.collection('dailyEntries').doc(id).set(data)),
    ...buildDemoLifeEvents(today).map(({ id, data }) => calendarRef.collection('lifeEvents').doc(id).set(data)),
    ...buildDemoReviews(today).map(({ id, data }) => calendarRef.collection('weeklyReviews').doc(id).set(data)),
    ...buildDemoPlans(today).map(({ id, data }) => calendarRef.collection('plans').doc(id).set(data)),
    calendarRef.collection('viewers').doc(DEMO_VIEWER_EMAIL).set({
      uid: 'demo-viewer', email: DEMO_VIEWER_EMAIL, role: 'viewer', status: 'accepted', invitedAt: Timestamp.now(), acceptedAt: Timestamp.now()
    })
  ];
  await Promise.all(writes);
  console.log(`Seeded ${DEMO_PROJECT_ID}: calendar "${CALENDAR_ID}", ${writes.length} documents.`);
  console.log(`Sign in as ${DEMO_EMAIL} (owner) or ${DEMO_VIEWER_EMAIL} (viewer); the passwords are in scripts/seed-emulators.mjs.`);
}

if (process.argv[1]?.endsWith('seed-emulators.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

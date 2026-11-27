import { describe, expect, it } from 'vitest';
import {
  buildWeeklyDigest,
  describeWeekWithKids,
  digestEventWindow,
  digestHtml,
  digestPlans,
  digestText,
  digestWeek,
  pickMoment,
  targetLine
} from './weeklyDigest.js';

// With you Nov 22 to 28, their other parent Nov 29 to Dec 5, with you again from Dec 6.
const custodySchedule = { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, childIds: ['d', 'j'] };
const calendar = {
  birthDate: '1975-02-24',
  children: [
    { id: 'd', name: 'David', birthDate: '2010-12-10' },
    { id: 'j', name: 'Joseph', birthDate: '2013-04-15' }
  ],
  custodySchedule,
  activityTargets: { Sleep: { minSeconds: 7 * 3600 }, 'Gym/Fitness': { sessionsPerWeek: 3 } }
};

const sleep = (id, startAt, endAt, hours) => ({
  id, sourceRecordId: id, sourceApp: 'gridlineai', eventType: 'sleep_session', eventClass: 'activity_boundary', activityFamily: 'sleep',
  categoryId: 'sleep', title: 'Slept', occurredAt: startAt, startAt, endAt, metrics: { totalSleepHours: hours }
});

describe('the digest week', () => {
  it('is this week on a Sunday and last week on any other day', () => {
    expect(digestWeek('2026-11-29')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
    expect(digestWeek('2026-11-30')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
    expect(digestWeek('2026-12-05')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
  });

  it('loads events from 36 hours either side of the Toronto week', () => {
    const window = digestEventWindow({ start: '2026-11-23', end: '2026-11-29' });
    expect(window.bounds.start.toISOString()).toBe('2026-11-23T05:00:00.000Z');
    expect(window.bounds.end.toISOString()).toBe('2026-11-30T05:00:00.000Z');
    expect(window.start.toISOString()).toBe('2026-11-21T17:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });
});

describe('next week with the boys', () => {
  it('names the days, or says all week or none', () => {
    expect(describeWeekWithKids(custodySchedule, { start: '2026-11-30', end: '2026-12-06' })).toBe('The boys are with you Sun next week.');
    expect(describeWeekWithKids(custodySchedule, { start: '2026-11-23', end: '2026-11-29' })).toBe('The boys are with you Mon to Sat next week.');
    expect(describeWeekWithKids(custodySchedule, { start: '2026-12-07', end: '2026-12-13' })).toBe('The boys are with you Mon to Sat next week.');
    expect(describeWeekWithKids({ ...custodySchedule, cycleWeeks: 1 }, { start: '2026-11-30', end: '2026-12-06' })).toBe('The boys are with you all next week.');
    expect(describeWeekWithKids(custodySchedule, { start: '2026-12-01', end: '2026-12-05' })).toBe('The boys are with their other parent next week.');
    expect(describeWeekWithKids({ enabled: false }, { start: '2026-11-30', end: '2026-12-06' })).toBe('');
  });
});

describe('plans in the digest', () => {
  it('lists plans placed in next week with the boys first, then ones due within eight weeks', () => {
    const plans = [
      { id: 'p1', title: 'Skating at the Bentway', who: ['d', 'j'], plannedWeekStart: '2026-12-06', deadline: null },
      { id: 'p2', title: 'Pick a summer camp', who: ['me'], deadline: { kind: 'date', date: '2027-01-15' } },
      { id: 'p3', title: 'Already done', who: ['d'], plannedWeekStart: '2026-12-06', doneOn: '2026-11-20' },
      { id: 'p4', title: 'Too far away', who: ['me'], deadline: { kind: 'date', date: '2027-06-01' } },
      { id: 'p5', title: 'Placed in a later week', who: ['d'], plannedWeekStart: '2026-12-20' }
    ];
    const items = digestPlans(plans, calendar, { start: '2026-11-30', end: '2026-12-06' }, '2026-11-29');
    expect(items).toEqual([
      { id: 'p1', title: 'Skating at the Bentway', when: 'Planned for your time with them next week' },
      { id: 'p2', title: 'Pick a summer camp', when: 'By Jan 15, 2027' }
    ]);
  });
});

describe('target lines', () => {
  it('names the target unless its text already does', () => {
    expect(targetLine({ label: 'Sleep', text: '2h 16m over your 7h goal on average' })).toBe('Sleep: 2h 16m over your 7h goal on average');
    expect(targetLine({ label: 'Gym/Fitness', text: '3 of 3 gym visits this week' })).toBe('3 of 3 gym visits this week');
  });
});

describe('one moment', () => {
  const week = { start: '2026-11-23', end: '2026-11-29' };

  it("uses the weekly review's moment first", () => {
    const moment = pickMoment({
      week,
      reviews: [{ weekStart: '2026-11-17', weekEnd: '2026-11-23', moment: 'Ben read to Drew at bedtime.' }],
      entries: [{ dateId: '2026-11-28', notes: '7:24 PM: Pancakes' }]
    });
    expect(moment).toEqual({ text: 'Ben read to Drew at bedtime.', from: 'From your weekly review' });
  });

  it('otherwise takes the latest line written down that week, without the quick-capture time', () => {
    const moment = pickMoment({
      week,
      entries: [
        { dateId: '2026-11-24', notes: 'Older' },
        { dateId: '2026-11-28', notes: '9:02 AM: Hockey at 7\n7:24 PM: Pancakes, then the long walk' },
        { dateId: '2026-11-30', notes: 'Next week, not this one' }
      ]
    });
    expect(moment).toEqual({ text: 'Pancakes, then the long walk', from: 'Sat, Nov 28' });
  });

  it('is null when nothing was written', () => {
    expect(pickMoment({ week, entries: [{ dateId: '2026-11-25', notes: '  ' }] })).toBeNull();
  });
});

describe('the whole digest', () => {
  const events = [
    sleep('n1', '2026-11-24T03:00:00Z', '2026-11-24T11:00:00Z', 7.5),
    sleep('n2', '2026-11-25T03:00:00Z', '2026-11-25T09:00:00Z', 5.5),
    // A second report of the same night only counts once.
    sleep('n2b', '2026-11-25T04:00:00Z', '2026-11-25T09:00:00Z', 4.2)
  ];
  const digest = buildWeeklyDigest({
    calendar,
    events,
    entries: [{ dateId: '2026-11-28', notes: '7:24 PM: Pancakes <with> "syrup" & jam', visibility: 'ownerOnly' }],
    reviews: [],
    plans: [{ id: 'p1', title: 'Skating at the Bentway', who: ['d', 'j'], plannedWeekStart: '2026-12-06' }],
    todayId: '2026-11-29',
    now: new Date('2026-11-30T00:00:00Z')
  });

  it('has the week in numbers, targets, the moment and next week', () => {
    expect(digest.title).toBe('Your week, Nov 23 to Nov 29');
    expect(digest.numbers.daysWithKids).toBe(6);
    expect(digest.numberLines[0]).toBe('6 days with the boys');
    expect(digest.numberLines).toContain('Something written down on 1 of 7 days');
    expect(digest.targetsMissed.length + digest.targetsMet.length).toBe(digest.numbers.targets.length);
    expect(digest.targetsMissed.some((text) => /gym|visit/i.test(text))).toBe(true);
    expect(digest.moment.text).toBe('Pancakes <with> "syrup" & jam');
    expect(digest.nextWeekWithKids).toBe('The boys are with you Sun next week.');
    expect(digest.plans).toHaveLength(1);
    expect(digest.milestones[0]).toMatch(/^David turns 16 in 1 week|^David can get a G1 licence/);
  });

  it('keeps the notification to numbers, never what was written', () => {
    expect(digest.push.title).toBe('Your week, Nov 23 to Nov 29');
    expect(digest.push.body).toMatch(/^6 days with the boys · 13h tracked · \d of \d targets met\. Next week: with you Sun\.$/);
    expect(digest.push.body).not.toMatch(/Pancakes|Skating|David/);
    expect(digest.push.body.length).toBeLessThanOrEqual(178);
  });

  it('escapes what was written in the email page, and links back to the app', () => {
    const html = digestHtml(digest, 'https://example.test');
    expect(html).toContain('Pancakes &lt;with&gt; &quot;syrup&quot; &amp; jam');
    expect(html).not.toContain('<with>');
    expect(html).toContain('href="https://example.test/#digest"');
    const text = digestText(digest, 'https://example.test');
    expect(text).toContain('One moment (Sat, Nov 28):\nPancakes <with> "syrup" & jam');
    expect(text).toContain('- Skating at the Bentway: Planned for your time with them next week');
  });

  it('still reads sensibly for an empty week with no schedule', () => {
    const empty = buildWeeklyDigest({ calendar: { birthDate: '1975-02-24' }, todayId: '2026-11-29', now: new Date('2026-11-30T00:00:00Z') });
    expect(empty.numberLines).toEqual(['Nothing written down this week']);
    expect(empty.push.body).toBe('Your week is ready to look back on.');
    expect(empty.moment).toBeNull();
    expect(empty.plans).toEqual([]);
  });
});

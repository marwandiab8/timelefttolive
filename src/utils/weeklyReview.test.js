import { describe, expect, it } from 'vitest';
import { buildPeriodAnalysis } from './lifeEventUtils.js';
import { addDays, formatDateId, getLifeYearsWeeks } from './dateUtils.js';
import {
  buildReviewDocument,
  carriedIntention,
  countDaysWithKids,
  describeWeekNumbers,
  isReviewEmpty,
  lifeWeekBounds,
  lifeWeekFor,
  nextLifeWeek,
  previousLifeWeek,
  reviewDue,
  reviewStreak,
  summarizeWeek,
  weekDayIds
} from './weeklyReview.js';

const BIRTH = '1985-03-12'; // in 2026 a Thursday: every square starts on the weekday of that year's birthday

describe('lifeWeekFor', () => {
  it('finds the same square as the life calendar draws, for every day of several years', () => {
    const rows = getLifeYearsWeeks(BIRTH, 45);
    const cells = rows.flatMap((row) => row.weeks);
    for (let day = new Date(2023, 0, 1); day < new Date(2027, 0, 1); day = addDays(day, 1)) {
      const dateId = formatDateId(day);
      const cell = cells.find((candidate) => day >= candidate.start && day <= candidate.end);
      const week = lifeWeekFor(BIRTH, dateId);
      expect(week.start, dateId).toBe(formatDateId(cell.start));
      expect(week.end, dateId).toBe(formatDateId(cell.end));
      expect(week.age).toBe(cell.age);
      expect(week.weekIndex).toBe(cell.weekIndex);
    }
  });

  it('gives the last square of a year its leftover days and steps across birthdays', () => {
    const last = lifeWeekFor(BIRTH, '2027-03-11');
    expect(last).toEqual({ start: '2027-03-04', end: '2027-03-11', age: 41, weekIndex: 51 });
    expect(nextLifeWeek(BIRTH, last)).toEqual({ start: '2027-03-12', end: '2027-03-18', age: 42, weekIndex: 0 });
    expect(previousLifeWeek(BIRTH, nextLifeWeek(BIRTH, last))).toEqual(last);
    expect(weekDayIds(last)).toHaveLength(8);
  });

  it('has no square before birth or without a birth date', () => {
    expect(lifeWeekFor(BIRTH, '1985-03-11')).toBeNull();
    expect(lifeWeekFor('', '2026-11-26')).toBeNull();
  });
});

describe('lifeWeekBounds', () => {
  it('runs from midnight on the first day to midnight after the last, Toronto time', () => {
    const bounds = lifeWeekBounds({ start: '2026-10-29', end: '2026-11-04' });
    expect(bounds.start.toISOString()).toBe('2026-10-29T04:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-11-05T05:00:00.000Z'); // the clocks went back on Nov 1
    expect(bounds).toMatchObject({ startDateId: '2026-10-29', endDateId: '2026-11-04', timezone: 'America/Toronto' });
  });
});

describe('countDaysWithKids', () => {
  const custody = { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1 };

  it('counts the days of the square that fall in your weeks', () => {
    expect(countDaysWithKids(custody, { start: '2026-11-19', end: '2026-11-25' })).toBe(4); // Sun 22 to Wed 25
    expect(countDaysWithKids(custody, { start: '2026-11-26', end: '2026-12-02' })).toBe(3); // Thu 26 to Sat 28
    expect(countDaysWithKids(custody, { start: '2026-11-29', end: '2026-12-05' })).toBe(0);
  });

  it('counts nothing before the arrangement began, and nothing without a schedule', () => {
    expect(countDaysWithKids({ ...custody, since: '2026-11-24' }, { start: '2026-11-19', end: '2026-11-25' })).toBe(2);
    expect(countDaysWithKids({ ...custody, since: '2026-12-01' }, { start: '2026-11-19', end: '2026-11-25' })).toBe(0);
    expect(countDaysWithKids({ ...custody, enabled: false }, { start: '2026-11-19', end: '2026-11-25' })).toBeNull();
    expect(countDaysWithKids(null, { start: '2026-11-19', end: '2026-11-25' })).toBeNull();
  });
});

describe('summarizeWeek', () => {
  const week = { start: '2026-11-12', end: '2026-11-18' };
  const bounds = lifeWeekBounds(week);
  const visit = (id, activity, start, end) => {
    const base = { sourceApp: 'gridlineai', eventClass: 'location', activityFamily: 'location', categoryId: 'other_location', title: activity, location: { label: activity }, metadata: { placeActivity: activity } };
    return [
      { ...base, id: `${id}-in`, sourceRecordId: `${id}-in`, eventType: 'arrive_location', occurredAt: start },
      { ...base, id: `${id}-out`, sourceRecordId: `${id}-out`, eventType: 'leave_location', occurredAt: end, startAt: start, endAt: end }
    ];
  };
  const night = (id, startAt, endAt) => ({
    id, sourceRecordId: id, sourceApp: 'gridlineai', eventType: 'sleep_session', eventClass: 'activity_boundary', activityFamily: 'sleep', categoryId: 'sleep',
    title: 'Slept', occurredAt: startAt, startAt, endAt
  });
  const events = [
    night('n1', '2026-11-13T03:30:00Z', '2026-11-13T11:30:00Z'),
    night('n2', '2026-11-14T04:00:00Z', '2026-11-14T10:00:00Z'),
    ...visit('g1', 'gym', '2026-11-13T22:00:00Z', '2026-11-13T23:15:00Z'),
    ...visit('g2', 'gym', '2026-11-16T22:00:00Z', '2026-11-16T23:00:00Z')
  ];
  const analysis = buildPeriodAnalysis(events, bounds, { now: new Date('2026-11-20T12:00:00Z') });

  it('keeps the totals, judges the targets and counts days with the kids and written days', () => {
    const numbers = summarizeWeek({
      analysis,
      bounds,
      week,
      targets: { Sleep: { minSeconds: 7 * 3600 }, 'Gym/Fitness': { sessionsPerWeek: 3 }, Darts: { sessionsPerWeek: 1 }, Reading: { minSeconds: 1800 } },
      custodySchedule: { enabled: true, nextStartDate: '2026-11-08', cycleWeeks: 2, withParentWeeks: 1 },
      journalDateIds: ['2026-11-12', '2026-11-12', '2026-11-15', '2026-11-30']
    });
    expect(numbers.categories.map((category) => category.label)).toEqual(['Sleep', 'Gym/Fitness']);
    expect(numbers.trackedSeconds).toBe(14 * 3600 + 135 * 60);
    expect(numbers.targets).toEqual([
      { label: 'Sleep', met: true, text: 'At your 7h goal' },
      { label: 'Gym/Fitness', met: false, text: '2 of 3 gym visits this week' },
      { label: 'Darts', met: false, text: '0 of 1 darts sessions this week' }
    ]);
    expect(numbers.daysWithKids).toBe(3); // your week runs Nov 8 to 14
    expect(numbers.journalDays).toBe(2);
    expect(numbers.dayCount).toBe(7);
  });

  it('reads as short lines', () => {
    const numbers = summarizeWeek({ analysis, bounds, week, targets: { 'Gym/Fitness': { sessionsPerWeek: 2 } }, custodySchedule: null, journalDateIds: [] });
    expect(describeWeekNumbers(numbers)).toEqual([
      '16h 15m tracked: Sleep 14h · Gym/Fitness 2h 15m',
      '1 of 1 target met',
      'Nothing written down this week'
    ]);
    expect(describeWeekNumbers({ ...numbers, daysWithKids: 0, journalDays: 3 })).toEqual([
      'The boys were with their other parent all week',
      '16h 15m tracked: Sleep 14h · Gym/Fitness 2h 15m',
      '1 of 1 target met',
      'Something written down on 3 of 7 days'
    ]);
    expect(describeWeekNumbers(null)).toEqual([]);
  });
});

describe('reviewDue', () => {
  // Thursday squares: Nov 19 to 25 is last week, Nov 26 to Dec 2 this week.
  it('asks about last week until it has a review or was skipped', () => {
    expect(reviewDue({ birthDate: BIRTH, today: '2026-11-26' })).toEqual({ week: { start: '2026-11-19', end: '2026-11-25', age: 41, weekIndex: 36 }, when: 'last' });
    expect(reviewDue({ birthDate: BIRTH, today: '2026-11-26', reviews: { '2026-11-19': {} } })).toBeNull();
    expect(reviewDue({ birthDate: BIRTH, today: '2026-11-26', skipped: ['2026-11-19'] })).toBeNull();
  });

  it('asks about this week on its last day', () => {
    expect(reviewDue({ birthDate: BIRTH, today: '2026-12-02', reviews: { '2026-11-19': {} } })).toMatchObject({ week: { start: '2026-11-26' }, when: 'endsToday' });
    expect(reviewDue({ birthDate: BIRTH, today: '2026-12-02', reviews: { '2026-11-19': {}, '2026-11-26': {} } })).toBeNull();
  });
});

describe('carriedIntention and reviewStreak', () => {
  const reviews = {
    '2026-11-05': { intention: '' },
    '2026-11-12': { intention: 'Gym three times' },
    '2026-11-19': { intention: 'Call Mom on Sunday' }
  };

  it('carries the intention from the review of the week before', () => {
    expect(carriedIntention(BIRTH, { start: '2026-11-26', end: '2026-12-02' }, reviews)).toEqual({ week: { start: '2026-11-19', end: '2026-11-25', age: 41, weekIndex: 36 }, text: 'Call Mom on Sunday' });
    expect(carriedIntention(BIRTH, { start: '2026-11-12', end: '2026-11-18' }, reviews)).toBeNull();
  });

  it('counts reviewed weeks in a row up to last week, or this week once reviewed', () => {
    expect(reviewStreak(BIRTH, '2026-11-26', reviews)).toBe(3);
    expect(reviewStreak(BIRTH, '2026-11-26', { ...reviews, '2026-11-26': {} })).toBe(4);
    expect(reviewStreak(BIRTH, '2026-11-26', { '2026-11-12': {} })).toBe(0);
  });
});

describe('buildReviewDocument', () => {
  const week = { start: '2026-11-19', end: '2026-11-25' };

  it('saves a clean, owner-only review by default', () => {
    expect(buildReviewDocument({ rating: '4', mattered: '  Wings with the boys ', moment: '', intention: 'Gym x3', intentionKept: 'partly' }, week, { trackedSeconds: 1 })).toEqual({
      weekStart: '2026-11-19',
      weekEnd: '2026-11-25',
      rating: 4,
      mattered: 'Wings with the boys',
      moment: '',
      intention: 'Gym x3',
      intentionKept: 'partly',
      numbers: { trackedSeconds: 1 },
      visibility: 'ownerOnly'
    });
  });

  it('drops a rating or outcome it does not know and shares only when asked', () => {
    const saved = buildReviewDocument({ rating: 9, intentionKept: 'maybe', shareWithViewers: true }, week, null);
    expect(saved).toMatchObject({ rating: null, intentionKept: null, numbers: null, visibility: 'viewers' });
  });

  it('knows an empty form', () => {
    expect(isReviewEmpty({ rating: '', mattered: ' ', moment: '', intention: '' })).toBe(true);
    expect(isReviewEmpty({ rating: 3 })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  APP_TIMEZONE,
  buildActivitySessions,
  buildActivityTallies,
  buildComparison,
  buildPeriodAnalysis,
  filterLifeEventsByRange,
  formatDuration,
  getActivityTallyRange,
  getDateIdInTimezone,
  getPeriodBounds,
  getTallyActivityLabel,
  isPointEvent,
  shiftPeriodDate,
  toJsDate
} from './lifeEventUtils.js';

describe('activity analysis utilities', () => {
  it('normalizes Firestore timestamps safely', () => {
    expect(toJsDate({ seconds: 1_700_000_000, nanoseconds: 0 }).toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(toJsDate({ toDate: () => new Date('2026-08-11T10:00:00Z') }).toISOString()).toBe('2026-08-11T10:00:00.000Z');
    expect(toJsDate('not-a-date')).toBeNull();
  });

  it('uses Toronto period boundaries across winter, summer, and DST', () => {
    expect(getPeriodBounds('day', '2026-01-15').start.toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(getPeriodBounds('day', '2026-08-11').start.toISOString()).toBe('2026-08-11T04:00:00.000Z');
    expect(getPeriodBounds('day', '2026-03-08').start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(getPeriodBounds('day', '2026-11-01').start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(getDateIdInTimezone(new Date('2026-08-12T03:59:59Z'))).toBe('2026-08-11');
  });

  it('creates Monday week, month, and year periods', () => {
    const week = getPeriodBounds('week', '2026-08-12');
    expect(week.startDateId).toBe('2026-08-10');
    expect(week.endDateId).toBe('2026-08-16');
    expect(getPeriodBounds('month', '2026-08-12').startDateId).toBe('2026-08-01');
    expect(getPeriodBounds('year', '2026-08-12').startDateId).toBe('2026-01-01');
    expect(shiftPeriodDate('2026-08-12', 'week', -1)).toBe('2026-08-03');
    expect(APP_TIMEZONE).toBe('America/Toronto');
  });

  it('pairs boundaries by activity and location and preserves incomplete starts', () => {
    const bounds = getPeriodBounds('day', '2026-08-11');
    const sessions = buildActivitySessions([
      { id: 'arrive', eventType: 'arrive_gym', activityFamily: 'gym', occurredAt: '2026-08-11T13:00:00Z', location: { label: 'Gym A' } },
      { id: 'unrelated', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-11T13:30:00Z', location: { label: 'Gym B' } },
      { id: 'leave', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-11T14:30:00Z', location: { label: 'Gym A' } },
      { id: 'active', eventType: 'start_work', activityFamily: 'work', occurredAt: '2026-08-11T15:00:00Z' }
    ], bounds);
    expect(sessions.some((session) => session.kind === 'paired' && session.durationSeconds === 5400)).toBe(true);
    expect(sessions.some((session) => session.kind === 'active' && session.category === 'Work')).toBe(true);
  });

  it('clips sessions crossing midnight to the selected period', () => {
    const sessions = buildActivitySessions([
      { id: 'sleep', activityFamily: 'sleep', startAt: '2026-08-11T03:00:00Z', endAt: '2026-08-11T07:00:00Z' }
    ], getPeriodBounds('day', '2026-08-11'));
    expect(sessions[0].durationSeconds).toBe(10800);
  });

  it('excludes moments and prevents nested gym/workout double counting', () => {
    const events = [
      { id: 'gym', activityFamily: 'gym', startAt: '2026-08-11T12:00:00Z', endAt: '2026-08-11T14:00:00Z' },
      { id: 'workout', activityFamily: 'workout', startAt: '2026-08-11T12:30:00Z', endAt: '2026-08-11T13:30:00Z' },
      { id: 'journal', eventType: 'journal', occurredAt: '2026-08-11T15:00:00Z' }
    ];
    expect(isPointEvent(events[2])).toBe(true);
    const analysis = buildPeriodAnalysis(events, getPeriodBounds('day', '2026-08-11'));
    expect(analysis.moments).toHaveLength(1);
    expect(analysis.timedSeconds).toBe(7200);
    expect(analysis.categories[0].label).toBe('Gym');
    expect(analysis.categories[0].nestedSessions).toHaveLength(1);
  });

  it('deduplicates repeated canonical identities', () => {
    const event = { id: 'same', activityFamily: 'work', startAt: '2026-08-11T13:00:00Z', endAt: '2026-08-11T14:00:00Z' };
    expect(buildActivitySessions([event, event], getPeriodBounds('day', '2026-08-11'))).toHaveLength(1);
  });

  it('normalizes tally categories while retaining future categories', () => {
    expect(getTallyActivityLabel({ eventType: 'completed_workout' })).toBe('Gym');
    expect(getTallyActivityLabel({ eventType: 'arrive_work' })).toBe('Work');
    expect(getTallyActivityLabel({ activityFamily: 'spotify' })).toBe('Music');
    expect(getTallyActivityLabel({ activityFamily: 'reading' })).toBe('Reading');
  });

  it('builds all-time tallies from the shared overlap-safe sessionization', () => {
    const tallies = buildActivityTallies([
      { id: 'work', activityFamily: 'work', startAt: '2026-08-10T13:00:00Z', endAt: '2026-08-10T21:00:00Z', sourceApp: 'gridlineai' },
      { id: 'gym', activityFamily: 'gym', startAt: '2026-08-11T12:00:00Z', endAt: '2026-08-11T14:00:00Z', sourceApp: 'gridlineai' },
      { id: 'workout', activityFamily: 'workout', startAt: '2026-08-11T12:30:00Z', endAt: '2026-08-11T13:30:00Z', sourceApp: 'gym' },
      { id: 'journal', eventType: 'journal', occurredAt: '2026-08-11T15:00:00Z', sourceApp: 'gridlineai' }
    ]);
    expect(tallies.find((tally) => tally.label === 'Work')).toMatchObject({ totalSeconds: 28800, dayCount: 1, sessionCount: 1 });
    expect(tallies.find((tally) => tally.label === 'Gym')).toMatchObject({ totalSeconds: 7200, dayCount: 1, sessionCount: 1 });
    expect(tallies.find((tally) => tally.label === 'Journal')).toMatchObject({ totalSeconds: 0, eventCount: 1 });
  });

  it('filters seven-day, thirty-day, yearly, and all-time tally ranges', () => {
    const now = new Date('2026-08-17T16:00:00Z');
    const events = [
      { id: 'old', occurredAt: '2025-01-01T12:00:00Z' },
      { id: 'recent', occurredAt: '2026-08-11T12:00:00Z' },
      { id: 'today', occurredAt: '2026-08-17T12:00:00Z' }
    ];
    expect(filterLifeEventsByRange(events, getActivityTallyRange('7d', now)).map((event) => event.id)).toEqual(['recent', 'today']);
    expect(filterLifeEventsByRange(events, getActivityTallyRange('year', now)).map((event) => event.id)).toEqual(['recent', 'today']);
    expect(filterLifeEventsByRange(events, getActivityTallyRange('all', now))).toHaveLength(3);
  });

  it('formats comparisons and safe empty states', () => {
    expect(formatDuration(2713)).toBe('45m');
    expect(buildComparison(
      { timedSeconds: 3600, events: [{}] },
      { timedSeconds: 1800, events: [{}] }
    )).toMatchObject({ deltaSeconds: 1800, hasPrevious: true });
    expect(buildPeriodAnalysis([], getPeriodBounds('day', '2026-08-11')).timedSeconds).toBe(0);
  });
});

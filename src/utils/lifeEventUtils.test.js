import { describe, expect, it } from 'vitest';
import {
  buildActivityAnalysis,
  buildActivityBreakdown,
  buildActivitySessions,
  buildDailyInsight,
  filterLifeEvents,
  formatDuration,
  getDailySummary,
  getDeliveryLatencySeconds,
  getEventDurationSeconds,
  getEventTime,
  getDonutBackground,
  getLocalDateId,
  getLocalDayBounds,
  sortLifeEvents,
  toJsDate
} from './lifeEventUtils.js';

describe('life event dashboard utilities', () => {
  it('builds valid local day bounds without accepting impossible dates', () => {
    const bounds = getLocalDayBounds('2026-08-11');
    expect(getLocalDateId(bounds.start)).toBe('2026-08-11');
    expect(getLocalDateId(bounds.end)).toBe('2026-08-12');
    expect(getLocalDayBounds('2026-02-30')).toBeNull();
  });

  it('normalizes Firestore timestamp-like values and safely rejects invalid dates', () => {
    expect(toJsDate({ seconds: 1_700_000_000, nanoseconds: 0 }).toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(toJsDate({ toDate: () => new Date('2026-08-11T10:00:00Z') }).toISOString()).toBe('2026-08-11T10:00:00.000Z');
    expect(toJsDate('not-a-date')).toBeNull();
  });

  it('summarizes canonical life events into four daily metrics', () => {
    const summary = getDailySummary([
      { sourceApp: 'GYM-K2', durationSeconds: 3600, eventClass: 'completed_activity' },
      { sourceApp: 'aigridline', durationSeconds: 900, eventType: 'arrive_work' },
      { sourceApp: 'GYM-K2', durationSeconds: -1, eventType: 'completed-workout' }
    ]);
    expect(summary).toEqual({ eventCount: 3, activeSeconds: 4500, sourceCount: 2, completedCount: 2 });
    expect(formatDuration(summary.activeSeconds)).toBe('1h 15m');
  });

  it('builds duration-weighted donut groups and falls back to counts', () => {
    const timed = buildActivityBreakdown([
      { activityFamily: 'workout', durationSeconds: 1200 },
      { activityFamily: 'workout', durationSeconds: 600 },
      { eventClass: 'project', durationSeconds: 300 }
    ]);
    expect(timed.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Workout', value: 1800 },
      { label: 'Project', value: 300 }
    ]);
    expect(getDonutBackground(timed)).toContain('conic-gradient');

    const untimed = buildActivityBreakdown([{ eventType: 'journal' }, { eventType: 'journal' }]);
    expect(untimed[0].value).toBe(2);

    const mixed = buildActivityBreakdown([
      { activityFamily: 'workout', durationSeconds: 600 },
      { eventClass: 'activity_boundary' }
    ]);
    expect(mixed.map((item) => item.value)).toEqual([1, 1]);
    expect(mixed.every((item) => item.usesDuration === false)).toBe(true);
  });

  it('sorts the daily timeline chronologically and creates safe empty insights', () => {
    const sorted = sortLifeEvents([
      { id: 'late', occurredAt: '2026-08-11T14:00:00Z' },
      { id: 'early', startAt: '2026-08-11T08:00:00Z' }
    ]);
    expect(sorted.map((event) => event.id)).toEqual(['early', 'late']);
    expect(buildDailyInsight([])).toContain('No life events');
    expect(buildDailyInsight([{ sourceApp: 'GYM-K2', eventType: 'completed_workout' }])).toContain('Workout');
  });

  it('prioritizes the real start time and computes finish duration and delivery latency', () => {
    const workout = {
      occurredAt: '2026-08-11T04:00:00Z',
      startAt: '2026-08-11T09:10:09Z',
      endAt: '2026-08-11T10:09:59Z',
      receivedAt: '2026-08-11T10:10:04Z'
    };
    expect(getEventTime(workout).toISOString()).toBe('2026-08-11T09:10:09.000Z');
    expect(getEventDurationSeconds(workout)).toBe(3590);
    expect(getDeliveryLatencySeconds(workout)).toBe(5);
  });

  it('filters drill-down events by category, source, or exact event identity', () => {
    const events = [
      { id: 'workout', sourceApp: 'GYM-K2', activityFamily: 'workout' },
      { id: 'gym', sourceApp: 'gridlineai', activityFamily: 'gym' },
      { id: 'work', sourceApp: 'gridlineai', activityFamily: 'work' }
    ];
    expect(filterLifeEvents(events, { kind: 'category', value: 'Workout' }).map((event) => event.id)).toEqual(['workout']);
    expect(filterLifeEvents(events, { kind: 'category', value: 'Gym' }).map((event) => event.id)).toEqual(['workout', 'gym']);
    expect(filterLifeEvents(events, { kind: 'source', value: 'GRIDLINEAI' }).map((event) => event.id)).toEqual(['gym', 'work']);
    expect(filterLifeEvents(events, { kind: 'event', value: 'work' }).map((event) => event.id)).toEqual(['work']);
  });

  it('pairs arrival and departure boundaries into calculated sessions', () => {
    const sessions = buildActivitySessions([
      {
        id: 'arrive',
        eventType: 'arrive_gym',
        activityFamily: 'gym',
        occurredAt: '2026-08-11T09:00:00Z',
        sourceApp: 'gridlineai'
      },
      {
        id: 'leave',
        eventType: 'leave_gym',
        activityFamily: 'gym',
        occurredAt: '2026-08-11T10:30:00Z',
        sourceApp: 'gridlineai'
      }
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: 'paired', durationSeconds: 5400, sourceApp: 'gridlineai' });
  });

  it('builds a source analysis from sessions, timings, event types, and delivery delays', () => {
    const analysis = buildActivityAnalysis([
      {
        id: 'one',
        sourceApp: 'GYM-K2',
        eventType: 'completed_workout',
        activityFamily: 'workout',
        startAt: '2026-08-11T09:10:00Z',
        endAt: '2026-08-11T10:10:00Z',
        receivedAt: '2026-08-11T10:10:05Z'
      },
      {
        id: 'two',
        sourceApp: 'GYM-K2',
        eventType: 'achievement',
        occurredAt: '2026-08-11T10:10:00Z',
        receivedAt: '2026-08-11T10:10:15Z'
      }
    ]);
    expect(analysis.eventCount).toBe(2);
    expect(analysis.sourceCount).toBe(1);
    expect(analysis.sessionCount).toBe(1);
    expect(analysis.trackedSeconds).toBe(3600);
    expect(analysis.averageDeliverySeconds).toBe(10);
    expect(analysis.eventTypes[0]).toEqual({ label: 'achievement', count: 1 });
  });
});

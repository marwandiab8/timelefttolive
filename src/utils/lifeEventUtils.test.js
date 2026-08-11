import { describe, expect, it } from 'vitest';
import {
  buildActivityBreakdown,
  buildDailyInsight,
  formatDuration,
  getDailySummary,
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
});

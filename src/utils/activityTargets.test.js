import { describe, expect, it } from 'vitest';
import { TARGETABLE_LABELS, describeTarget, evaluateTarget, normalizeActivityTargets, targetAmount } from './activityTargets.js';

const H = 3600;

describe('activity targets', () => {
  it('keeps only known categories with one sensible positive number', () => {
    expect(normalizeActivityTargets({
      Sleep: { minSeconds: '25200', extra: 1 },
      Work: { maxSeconds: 0 },
      'Gym/Fitness': { sessionsPerWeek: 3.4 },
      Darts: { sessionsPerWeek: 999 },
      Places: { minSeconds: 100 },
      Reading: 'nope',
      Meals: { minSeconds: 30 * H }
    })).toEqual({ Sleep: { minSeconds: 25200 }, 'Gym/Fitness': { sessionsPerWeek: 3 } });
    expect(normalizeActivityTargets(null)).toEqual({});
    expect(TARGETABLE_LABELS).toContain('Sleep');
  });

  it('reads and describes a target', () => {
    const targets = { Sleep: { minSeconds: 7 * H }, Work: { maxSeconds: 9 * H }, 'Gym/Fitness': { sessionsPerWeek: 3 } };
    expect(targetAmount(targets, 'Sleep')).toBe(7 * H);
    expect(targetAmount(targets, 'Darts')).toBeNull();
    expect(describeTarget('Sleep', 7 * H)).toBe('at least 7h a night');
    expect(describeTarget('Work', 9 * H)).toBe('at most 9h a day');
    expect(describeTarget('Gym/Fitness', 3)).toBe('3 gym visits a week');
  });

  it('judges a day on its total and says how far from the goal it landed', () => {
    const targets = { Sleep: { minSeconds: 7 * H }, Work: { maxSeconds: 9 * H } };
    const short = evaluateTarget(targets, { label: 'Sleep', totalSeconds: 6 * H + 12 * 60, activeDays: 1 }, 'day');
    expect(short).toMatchObject({ met: false, text: '48m under your 7h goal', ringSeconds: 7 * H });
    const atGoal = evaluateTarget(targets, { label: 'Sleep', totalSeconds: 7 * H + 30, activeDays: 1 }, 'day');
    expect(atGoal).toMatchObject({ met: true, text: 'At your 7h goal' });
    const long = evaluateTarget(targets, { label: 'Work', totalSeconds: 10 * H + 10 * 60, activeDays: 1 }, 'day');
    expect(long).toMatchObject({ met: false, text: '1h 10m over your 9h limit' });
    const fine = evaluateTarget(targets, { label: 'Work', totalSeconds: 8 * H, activeDays: 1 }, 'day');
    expect(fine.met).toBe(true);
    expect(evaluateTarget(targets, { label: 'Darts', totalSeconds: H }, 'day')).toBeNull();
  });

  it('judges a week on the average per active night and places the mark across those nights', () => {
    const targets = { Sleep: { minSeconds: 7 * H } };
    const week = evaluateTarget(targets, { label: 'Sleep', totalSeconds: 45 * H, activeDays: 7, averageActiveDaySeconds: 45 * H / 7 }, 'week');
    expect(week.met).toBe(false);
    expect(week.text).toMatch(/under your 7h goal on average$/);
    expect(week.ringSeconds).toBe(49 * H);
  });

  it('counts visits against the week, and against the weeks in a month', () => {
    const targets = { 'Gym/Fitness': { sessionsPerWeek: 3 } };
    const bounds = (days) => ({ start: new Date(0), end: new Date(days * 86_400_000) });
    expect(evaluateTarget(targets, { label: 'Gym/Fitness', sessionCount: 2 }, 'week', bounds(7))).toMatchObject({ met: false, text: '2 of 3 gym visits this week', ringSeconds: null });
    expect(evaluateTarget(targets, { label: 'Gym/Fitness', sessionCount: 13 }, 'month', bounds(30))).toMatchObject({ goal: 12, met: true, text: '13 of 12 gym visits this month' });
    expect(evaluateTarget(targets, { label: 'Gym/Fitness', sessionCount: 1 }, 'day', bounds(1), { weekSessionCount: 2 })).toMatchObject({ measured: 2, text: '2 of 3 gym visits this week' });
    expect(evaluateTarget(targets, { label: 'Gym/Fitness', sessionCount: 1 }, 'day', bounds(1))).toBeNull();
  });
});

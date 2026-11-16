import { describe, expect, it } from 'vitest';
import { getPeriodBounds, shiftPeriodDate } from './lifeEventUtils.js';
import { buildNotableFacts, countWeekDays } from './activityNotables.js';

const H = 3600;
const analysisOf = (entries) => ({ categories: Object.entries(entries).map(([label, seconds]) => ({ label, seconds })) });
// History the way the dashboard builds it: index 0 is the previous period.
const historyOf = (period, dateId, days) => days.map((entries, index) => {
  const bounds = getPeriodBounds(period, shiftPeriodDate(dateId, period, -(index + 1)));
  return { bounds, analysis: analysisOf(entries) };
});

describe('notable facts', () => {
  const dateId = '2026-11-12'; // a Thursday
  const bounds = getPeriodBounds('day', dateId);

  it('finds a streak and says since when and how much', () => {
    const history = historyOf('day', dateId, [{ Darts: H }, { Darts: H / 2 }, { Darts: H / 2 }, { Work: 8 * H }]);
    const [fact] = buildNotableFacts({ analysis: analysisOf({ Darts: H }), history, period: 'day', bounds });
    expect(fact.text).toBe('Darts 4 days in a row');
    expect(fact.detail).toBe('Every day since Nov 9, 3h in all');
  });

  it('needs at least three in a row, and never invents a streak across a gap', () => {
    const history = historyOf('day', dateId, [{ Darts: H }, { Work: H }, { Darts: H }, { Darts: H }]);
    const facts = buildNotableFacts({ analysis: analysisOf({ Darts: H }), history, period: 'day', bounds });
    expect(facts.find((fact) => fact.id.startsWith('streak'))).toBeUndefined();
    expect(facts.map((fact) => fact.text)).toEqual(['Third Darts session this week']);
  });

  it('calls out the best period with the previous best beside it', () => {
    const history = historyOf('day', dateId, [{ Work: 8 * H }, { Work: 8.5 * H }, {}, { Work: 7 * H }, { Work: 8 * H }]);
    const facts = buildNotableFacts({ analysis: analysisOf({ Work: 9 * H + 20 * 60 }), history, period: 'day', bounds });
    const best = facts.find((fact) => fact.id === 'best:Work');
    expect(best.text).toBe('Most work in 6 days');
    expect(best.detail).toBe('9h 20m this day; the previous best was 8h 30m (Nov 10)');
  });

  it('counts the gym visit of the week from the days already loaded, on a day view only', () => {
    const history = historyOf('day', dateId, [{ Home: H }, { 'Gym/Fitness': H }, { 'Gym/Fitness': H }, { 'Gym/Fitness': H }]);
    const facts = buildNotableFacts({ analysis: analysisOf({ 'Gym/Fitness': 1.5 * H }), history, period: 'day', bounds });
    const nth = facts.find((fact) => fact.id === 'nth:Gym/Fitness');
    // Thursday: Monday Nov 9 and Tuesday Nov 10 count, Sunday Nov 8 belongs to last week.
    expect(nth.text).toBe('Third gym visit this week');
    expect(nth.detail).toBe('Also on Nov 9, Nov 10; 1h 30m today');
    expect(buildNotableFacts({ analysis: analysisOf({ 'Gym/Fitness': H }), history, period: 'week', bounds: getPeriodBounds('week', dateId) }).find((fact) => fact.id.startsWith('nth'))).toBeUndefined();
  });

  it('keeps one fact per category, strongest first, at most three', () => {
    const history = historyOf('day', dateId, [
      { Darts: H, Work: 8 * H, Reading: H, 'Gym/Fitness': H },
      { Darts: H, Work: 8 * H, Reading: H, 'Gym/Fitness': H },
      { Darts: H, Work: 8 * H, Reading: H },
      { Darts: H, Work: 8 * H, Reading: H },
      { Darts: H, Work: 8 * H, Reading: H }
    ]);
    const facts = buildNotableFacts({ analysis: analysisOf({ Darts: 2 * H, Work: 9 * H, Reading: H, 'Gym/Fitness': H }), history, period: 'day', bounds });
    expect(facts).toHaveLength(3);
    expect(new Set(facts.map((fact) => fact.label)).size).toBe(3);
    expect(facts[0].text).toMatch(/6 days in a row$/);
    expect(facts.every((fact) => /\d/.test(fact.detail))).toBe(true);
  });

  it('returns nothing for an empty period', () => {
    expect(buildNotableFacts({ analysis: { categories: [] }, history: [], period: 'day', bounds })).toEqual([]);
    expect(buildNotableFacts()).toEqual([]);
  });

  it('counts the days of this week with a category, stopping at Monday', () => {
    const history = historyOf('day', dateId, [{ 'Gym/Fitness': H }, {}, { 'Gym/Fitness': H }, { 'Gym/Fitness': H }, { 'Gym/Fitness': H }]);
    expect(countWeekDays('Gym/Fitness', analysisOf({ 'Gym/Fitness': H }), history, dateId)).toBe(3);
    expect(countWeekDays('Gym/Fitness', analysisOf({}), history, dateId)).toBe(2);
  });
});

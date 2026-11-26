import { describe, expect, it } from 'vitest';
import { getLifeYearsWeeks } from './dateUtils.js';
import { RATING_COLORS, buildLivedWeekMarks, kidsFill, kidsModeNote, normalizeLivedMode, ratingLegend } from './livedWeeks.js';

const BIRTH = '1985-03-12'; // 2026 squares start on Thursdays
const weeks = getLifeYearsWeeks(BIRTH, 45).flatMap((row) => row.weeks);
const custody = { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, since: '2026-11-01' };

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('rating colours', () => {
  it('get lighter as the week gets better, all lighter than an unrated lived week', () => {
    const values = [1, 2, 3, 4, 5].map((rating) => luminance(RATING_COLORS[rating]));
    values.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(values[index]));
    expect(values[0]).toBeGreaterThan(luminance('#46505c'));
    expect(ratingLegend().map((item) => item.label)).toEqual(['Rough', 'Meh', 'Okay', 'Good', 'Great']);
  });
});

describe('normalizeLivedMode', () => {
  it('falls back to events, and to events for the kids view without a schedule', () => {
    expect(normalizeLivedMode('rating')).toBe('rating');
    expect(normalizeLivedMode('kids', { hasCustody: true })).toBe('kids');
    expect(normalizeLivedMode('kids')).toBe('events');
    expect(normalizeLivedMode('nonsense')).toBe('events');
  });
});

describe('buildLivedWeekMarks', () => {
  it('marks nothing in the events view', () => {
    expect(buildLivedWeekMarks({ mode: 'events', weeks, today: '2026-11-26' }).size).toBe(0);
  });

  it('colours reviewed weeks by their rating and dots weeks with something written', () => {
    const marks = buildLivedWeekMarks({
      mode: 'rating',
      weeks,
      today: '2026-11-26',
      reviews: { '2026-11-19': { rating: 4 }, '2026-11-12': { rating: null }, '2026-12-03': { rating: 5 } },
      writtenDateIds: new Set(['2026-11-07', '2026-11-21'])
    });
    expect(marks.get('2026-11-19')).toEqual({ fill: RATING_COLORS[4], dot: true, label: 'Reviewed: good' });
    expect(marks.get('2026-11-12')).toEqual({ fill: null, dot: false, label: 'Reviewed' });
    expect(marks.get('2026-11-05')).toEqual({ fill: null, dot: true, label: '' });
    expect(marks.has('2026-12-03')).toBe(false); // the future stays as it is
    expect(marks.size).toBe(3);
  });

  it('colours weeks by the days with the kids, from the day the schedule began', () => {
    const marks = buildLivedWeekMarks({ mode: 'kids', weeks, today: '2026-11-26', custodySchedule: custody });
    expect(marks.get('2026-11-19')).toEqual({ fill: kidsFill(4, 7), dot: false, label: '4 days with the boys' });
    expect(marks.get('2026-11-26')).toEqual({ fill: kidsFill(3, 7), dot: false, label: '3 days with the boys' });
    // Your weeks run Sunday to Saturday from Nov 8 and Nov 22; the squares run Thursday to Wednesday.
    expect(marks.get('2026-11-12')).toEqual({ fill: kidsFill(3, 7), dot: false, label: '3 days with the boys' });
    expect(marks.get('2026-11-05')).toEqual({ fill: kidsFill(4, 7), dot: false, label: '4 days with the boys' });
    // Oct 29 to 31 were your days, but before the schedule began on Nov 1.
    expect(marks.has('2026-10-29')).toBe(false);
    expect(marks.size).toBe(4);
  });

  it('colours nothing for the kids until the schedule has its start date', () => {
    const { since, ...noStart } = custody;
    const marks = buildLivedWeekMarks({ mode: 'kids', weeks, today: '2026-11-26', custodySchedule: noStart, writtenDateIds: new Set(['2026-11-20']) });
    expect([...marks.values()]).toEqual([{ fill: null, dot: true, label: '' }]);
    expect(kidsModeNote(noStart)).toMatch(/day this schedule began/);
    expect(kidsModeNote(custody)).toBe('');
    expect(kidsModeNote(null)).toMatch(/Set up/);
  });
});

describe('kidsFill', () => {
  it('blends the kids colour into the lived-week colour, more for more days', () => {
    expect(kidsFill(7)).toBe('color-mix(in srgb, #ef9a6b 100%, var(--life-past, #46505c))');
    expect(kidsFill(1)).toBe('color-mix(in srgb, #ef9a6b 44%, var(--life-past, #46505c))');
    expect(kidsFill(3, 3)).toBe('color-mix(in srgb, #ef9a6b 100%, var(--life-past, #46505c))');
  });
});

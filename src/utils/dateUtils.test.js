import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  eventIntersectsWeek,
  formatDateId,
  getDaysInWeek,
  getDaysInRange,
  getLifeStats,
  getLifeYearsWeeks,
  parseDateId
} from './dateUtils.js';

describe('dateUtils', () => {
  it('formats and parses local date IDs without timezone shifts', () => {
    expect(formatDateId(parseDateId('1990-02-03'))).toBe('1990-02-03');
  });

  it('creates one 52-week row per target age year', () => {
    const rows = getLifeYearsWeeks('2000-01-01', 3);
    expect(rows).toHaveLength(3);
    expect(rows[0].weeks).toHaveLength(52);
    expect(formatDateId(rows[0].weeks[51].end)).toBe('2000-12-31');
    expect(rows[2].label).toBe('Age 2');
  });

  it('counts calendar days across daylight saving boundaries', () => {
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
    expect(daysBetween('2026-10-31', '2026-11-03')).toBe(3);
  });

  it('detects events intersecting a week', () => {
    const week = { start: parseDateId('2028-07-21'), end: parseDateId('2028-07-27') };
    expect(eventIntersectsWeek({ startDate: '2028-07-25', endDate: '2028-08-15' }, week)).toBe(true);
  });

  it('returns seven individual days for a weekly cell', () => {
    expect(getDaysInWeek(parseDateId('2028-07-21')).map(formatDateId)).toHaveLength(7);
  });

  it('returns every date in an extended final year cell', () => {
    expect(getDaysInRange(parseDateId('2028-12-24'), parseDateId('2028-12-31')).map(formatDateId)).toHaveLength(8);
  });

  it('calculates remaining life stats', () => {
    const stats = getLifeStats('2000-01-01', 80, parseDateId('2020-01-01'));
    expect(stats.currentAge).toBe(20);
    expect(stats.targetAge).toBe(80);
    expect(stats.weeksRemaining).toBeGreaterThan(3000);
  });
});

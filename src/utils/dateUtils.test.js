import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  eventIntersectsWeek,
  eventIntersectsDate,
  eventIntersectsMonth,
  formatDateId,
  getDaysInWeek,
  getDaysInRange,
  getLifeYearRange,
  getMonthsForLifeYear,
  getWeeksForMonth,
  getLifeStats,
  getLifeYearsWeeks,
  isValidDateId,
  parseDateId,
  timestampToDateId
} from './dateUtils.js';

describe('dateUtils', () => {
  it('formats and parses local date IDs without timezone shifts', () => {
    expect(formatDateId(parseDateId('1990-02-03'))).toBe('1990-02-03');
    expect(isValidDateId('1990-02-03')).toBe(true);
    expect(isValidDateId('1990-2-3')).toBe(false);
  });

  it('converts common timestamp values to date IDs', () => {
    expect(timestampToDateId({ seconds: 1848139200 })).toBe('2028-07-25');
    expect(timestampToDateId('2028-07-25')).toBe('2028-07-25');
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

  it('gets a birthday-based life year range', () => {
    const range = getLifeYearRange('1985-04-10', 42);
    expect(formatDateId(range.start)).toBe('2027-04-10');
    expect(formatDateId(range.end)).toBe('2028-04-09');
  });

  it('gets months intersecting a birthday-based life year', () => {
    const months = getMonthsForLifeYear('1985-04-10', 42);
    expect(months).toHaveLength(12);
    expect(formatDateId(months[0].rangeStart)).toBe('2027-04-10');
    expect(formatDateId(months.at(-1).rangeEnd)).toBe('2028-04-09');
  });

  it('gets real calendar weeks intersecting a month', () => {
    const weeks = getWeeksForMonth('2028-07-01');
    expect(formatDateId(weeks[0].start)).toBe('2028-06-25');
    expect(weeks.length).toBeGreaterThanOrEqual(5);
  });

  it('detects event date and month intersections', () => {
    const event = { startDate: '2028-07-25', endDate: '2028-08-15' };
    expect(eventIntersectsDate(event, '2028-07-25')).toBe(true);
    expect(eventIntersectsMonth(event, '2028-08-01', '2028-08-31')).toBe(true);
    expect(eventIntersectsMonth(event, '2028-09-01', '2028-09-30')).toBe(false);
  });
});

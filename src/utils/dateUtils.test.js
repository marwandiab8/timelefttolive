import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  eventIntersectsWeek,
  eventIntersectsDate,
  eventIntersectsMonth,
  formatDateId,
  getDaysForWeek,
  getDaysForWeekRange,
  getDaysInWeek,
  getDaysInRange,
  getLifeYearRange,
  getMonthsForLifeYear,
  getWeeksForMonth,
  getLifeStats,
  getLifeYearsWeeks,
  isCurrentWeek,
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

describe('weeks that do not start on a Sunday', () => {
  // The life calendar's weeks are counted from the birth date, so a week can
  // start on any weekday. This one runs Tuesday 2026-09-15 to Monday 2026-09-21.
  const start = '2026-09-15';
  const end = '2026-09-21';
  const days = (list) => list.map(formatDateId);

  it('lists exactly the days of the week that was clicked', () => {
    expect(days(getDaysForWeekRange(start, end))).toEqual([
      '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'
    ]);
  });

  it('keeps today in view: the old calendar-week snap showed the week before', () => {
    // Regression: the week view snapped a Tuesday start back to Sunday 2026-09-13,
    // which ends on Saturday 2026-09-19 and does not contain Sunday 2026-09-20.
    expect(days(getDaysForWeek(start)).at(-1)).toBe('2026-09-19');
    expect(days(getDaysForWeekRange(start, end))).toContain('2026-09-20');
  });

  it('shows every day of the longer last week of a life year', () => {
    // The last cell of each age row absorbs the leftover 1 or 2 days of the year.
    expect(getDaysForWeekRange('2026-09-15', '2026-09-23')).toHaveLength(9);
    expect(getDaysForWeekRange('2026-09-15', '2026-09-22')).toHaveLength(8);
  });

  it('falls back to the calendar week when there is no end date, or it is not usable', () => {
    expect(days(getDaysForWeekRange(start))).toEqual(days(getDaysForWeek(start)));
    expect(days(getDaysForWeekRange(start, '2026-09-10'))).toEqual(days(getDaysForWeek(start)));
    expect(days(getDaysForWeekRange(start, 'not-a-date'))).toEqual(days(getDaysForWeek(start)));
  });

  it('agrees with the heatmap on which week today is in, at any time of day', () => {
    const week = { start: new Date(2026, 8, 15), end: new Date(2026, 8, 21) };
    expect(isCurrentWeek(week, new Date(2026, 8, 20, 0, 5))).toBe(true);
    expect(isCurrentWeek(week, new Date(2026, 8, 20, 23, 59))).toBe(true);
    expect(isCurrentWeek(week, new Date(2026, 8, 22, 0, 0))).toBe(false);
    expect(isCurrentWeek(week, new Date(2026, 8, 14, 23, 59))).toBe(false);
  });
});

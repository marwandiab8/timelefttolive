import { describe, expect, it } from 'vitest';
import { getCustodyStats, getCustodyWeekStatus } from './custodyUtils.js';
import { parseDateId } from './dateUtils.js';

const calendar = {
  birthDate: '1975-02-24',
  targetAge: 90,
  targetEndDate: '2065-02-24',
  children: [
    { id: 'a', name: 'One', birthDate: '2010-06-28' },
    { id: 'b', name: 'Two', birthDate: '2011-04-27' },
    { id: 'c', name: 'Three', birthDate: '2013-04-15' },
    { id: 'd', name: 'Four', birthDate: '2013-10-04' }
  ],
  custodySchedule: {
    enabled: true,
    nextStartDate: '2026-06-01',
    cycleWeeks: 2,
    withParentWeeks: 1,
    childIds: ['a', 'b', 'c', 'd'],
    countUntilChildAge: 18
  }
};
const on = (dateId, cal = calendar) => getCustodyStats(cal, parseDateId(dateId));
const counts = (stats) => stats.children.map((child) => [child.name, child.weeksRemaining, child.daysRemaining]);

describe('getCustodyWeekStatus', () => {
  it('places the week of Monday Nov 2 2026 with you from a start date months earlier, the other parent from Nov 9', () => {
    expect(on('2026-11-02').status).toEqual({
      withYou: true,
      always: false,
      start: '2026-11-02',
      end: '2026-11-08',
      changeDate: '2026-11-09',
      nextStart: '2026-11-16'
    });
    expect(on('2026-11-09').status).toMatchObject({ withYou: false, start: '2026-11-09', end: '2026-11-15', changeDate: '2026-11-16' });
    expect(on('2026-11-16').status).toMatchObject({ withYou: true, start: '2026-11-16', changeDate: '2026-11-23' });
  });

  it('reads the start date both ways, so a future one places this week too', () => {
    const later = { ...calendar.custodySchedule, nextStartDate: '2026-11-16' };
    expect(getCustodyWeekStatus(later, parseDateId('2026-11-04'))).toEqual(getCustodyWeekStatus(calendar.custodySchedule, parseDateId('2026-11-04')));
  });

  it('says so when the time with you is the whole cycle', () => {
    expect(getCustodyWeekStatus({ ...calendar.custodySchedule, withParentWeeks: 2 }, parseDateId('2026-11-10'))).toEqual({ withYou: true, always: true });
  });

  it('is null when the schedule is off or has no start date', () => {
    expect(getCustodyWeekStatus({ ...calendar.custodySchedule, enabled: false })).toBeNull();
    expect(getCustodyWeekStatus({ ...calendar.custodySchedule, nextStartDate: '' })).toBeNull();
  });
});

describe('getCustodyStats', () => {
  it('counts each child until their own 18th birthday, not the youngest one', () => {
    const stats = on('2026-11-02');
    expect(counts(stats)).toEqual([
      ['One', 44, 303],
      ['Two', 65, 455],
      ['Three', 117, 813],
      ['Four', 129, 901]
    ]);
    expect(stats.children.map((child) => child.untilDate)).toEqual(['2028-06-28', '2029-04-27', '2031-04-15', '2031-10-04']);
    expect(stats.untilAge).toBe(18);
  });

  it('counts the week you are in until it ends, then drops it at the handover', () => {
    expect(counts(on('2026-11-08'))[0]).toEqual(['One', 44, 297]);
    expect(counts(on('2026-11-09'))[0]).toEqual(['One', 43, 296]);
    expect(counts(on('2026-11-15'))[0]).toEqual(['One', 43, 296]);
  });

  it('keeps the rest of this week when the start date given is a later one', () => {
    const later = { ...calendar, custodySchedule: { ...calendar.custodySchedule, nextStartDate: '2026-11-16' } };
    expect(counts(on('2026-11-04', later))).toEqual(counts(on('2026-11-04')));
    expect(counts(on('2026-11-04'))[0]).toEqual(['One', 44, 301]);
  });

  it('stops the day before the birthday', () => {
    // Three turns 18 on Tuesday Apr 15 2031, in a week with you that began Monday Apr 14: one day of it is left.
    const stats = on('2031-04-14');
    expect(counts(stats)[2]).toEqual(['Three', 1, 1]);
    expect(counts(on('2031-04-15'))[2]).toEqual(['Three', 0, 0]);
  });

  it('only counts children on the schedule with a birth date', () => {
    const some = { ...calendar, custodySchedule: { ...calendar.custodySchedule, childIds: ['b', 'zz'] } };
    expect(on('2026-11-02', some).children.map((child) => child.id)).toEqual(['b']);
  });

  it('returns null when parenting time is not configured', () => {
    expect(getCustodyStats({ children: [] })).toBeNull();
    expect(getCustodyStats({ ...calendar, custodySchedule: { ...calendar.custodySchedule, enabled: false } })).toBeNull();
  });
});

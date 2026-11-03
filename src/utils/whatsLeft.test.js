import { describe, expect, it } from 'vitest';
import { parseDateId } from './dateUtils.js';
import { countSummers, countWeekends, countYearly, getChildAhead, getLifeAhead, getNextBirthday } from './whatsLeft.js';

const on = parseDateId;

describe('counting what is ahead', () => {
  it('counts a yearly date from today up to, not including, the end', () => {
    expect(countYearly(12, 25, on('2026-11-02'), on('2028-06-28'))).toBe(2);
    expect(countYearly(12, 25, on('2026-12-25'), on('2027-12-25'))).toBe(1);
    expect(countYearly(12, 25, on('2026-12-26'), on('2027-12-26'))).toBe(1);
  });

  it('counts Saturdays', () => {
    expect(countWeekends(on('2026-11-07'), on('2026-11-08'))).toBe(1);
    expect(countWeekends(on('2026-11-08'), on('2026-11-14'))).toBe(0);
    expect(countWeekends(on('2026-11-02'), on('2026-11-15'))).toBe(2);
  });

  it('counts the summer under way, and a summer only if it begins before the end', () => {
    expect(countSummers(on('2026-07-15'), on('2027-01-01'))).toBe(1);
    expect(countSummers(on('2026-09-01'), on('2027-01-01'))).toBe(0);
    expect(countSummers(on('2026-11-02'), on('2028-06-28'))).toBe(1);
    expect(countSummers(on('2026-11-02'), on('2028-07-02'))).toBe(2);
  });

  it('finds the next birthday, today included', () => {
    expect(getNextBirthday('2010-06-28', on('2026-11-02'))).toEqual({ dateId: '2027-06-28', age: 17 });
    expect(getNextBirthday('2010-11-02', on('2026-11-02'))).toEqual({ dateId: '2026-11-02', age: 16 });
    expect(getNextBirthday('2010-11-01', on('2026-11-02'))).toEqual({ dateId: '2027-11-01', age: 17 });
  });
});

describe('getLifeAhead', () => {
  it('counts weekends, summers, Christmases and birthdays before the target age, through the target birthday', () => {
    expect(getLifeAhead({ birthDate: '1975-02-24', targetAge: 90, targetEndDate: '2065-02-24' }, on('2026-11-02'))).toEqual({
      targetAge: 90,
      weekends: 1999,
      summers: 38,
      christmases: 39,
      birthdays: 39
    });
  });
});

describe('getChildAhead', () => {
  it('counts each child up to the day they turn the age given', () => {
    const now = on('2026-11-02');
    expect(getChildAhead({ birthDate: '2010-06-28' }, 18, now)).toEqual({ summers: 1, christmases: 2, birthdays: 1 });
    expect(getChildAhead({ birthDate: '2011-04-27' }, 18, now)).toEqual({ summers: 2, christmases: 3, birthdays: 2 });
    expect(getChildAhead({ birthDate: '2013-10-04' }, 18, now)).toEqual({ summers: 5, christmases: 5, birthdays: 4 });
  });
});

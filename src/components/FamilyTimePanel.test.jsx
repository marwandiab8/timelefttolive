import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FamilyTimePanel, { describeChild, describeCustodyStatus } from './FamilyTimePanel.jsx';
import { parseDateId } from '../utils/dateUtils.js';

const same = (dateId) => dateId;

const calendar = {
  birthDate: '1975-02-24',
  targetAge: 90,
  children: [
    {
      id: 'a',
      name: 'David',
      birthDate: '2010-06-28',
      grade: '11',
      gradeSchoolYear: 2026,
      school: 'Central',
      details: [{ id: 'x', label: 'Teacher', value: 'Ms. Lee' }]
    },
    { id: 'b', name: 'Sam', birthDate: '2015-01-10' }
  ],
  custodySchedule: { enabled: true, nextStartDate: '2026-06-01', cycleWeeks: 2, withParentWeeks: 1, childIds: ['a'], countUntilChildAge: 18 }
};

describe('describeCustodyStatus', () => {
  it('says who has them this week and when that changes', () => {
    expect(describeCustodyStatus({ withYou: true, start: '2026-11-02', end: '2026-11-08', changeDate: '2026-11-09', nextStart: '2026-11-16' }, same)).toEqual({
      headline: 'With you this week',
      sentence: '2026-11-02 to 2026-11-08. They go to their other parent 2026-11-09 and are back with you 2026-11-16.'
    });
    expect(describeCustodyStatus({ withYou: false, end: '2026-11-15', changeDate: '2026-11-16' }, same)).toEqual({
      headline: 'With their other parent this week',
      sentence: 'Until 2026-11-15. Back with you 2026-11-16.'
    });
    expect(describeCustodyStatus(null)).toBeNull();
  });
});

describe('describeChild', () => {
  const now = parseDateId('2026-11-02');
  const custody = calendar.custodySchedule;

  it('gives age, grade, school, what is ahead before 18, the next birthday and the time left', () => {
    const time = { untilDate: '2028-06-28', weeksRemaining: 44, daysRemaining: 303 };
    const card = describeChild(calendar.children[0], { time, untilAge: 18, custody }, now, same);
    expect(card.meta).toEqual(['Age 16', 'Grade 11', 'Central']);
    expect(card.weeks).toEqual({ number: '44', unit: 'weeks left with you', note: '303 days, until 18 on 2028-06-28.' });
    expect(card.ahead).toBe('Before 18: 1\u00a0summer · 2\u00a0Christmases · 1\u00a0birthday');
    expect(card.nextBirthday).toBe('Turns 17 on 2027-06-28, in your week.');
    expect(card.details).toEqual([{ id: 'x', label: 'Teacher', value: 'Ms. Lee' }]);
  });

  it("says when a birthday falls in the other parent's week, or is today", () => {
    const myles = { id: 'm', name: 'Myles', birthDate: '2011-04-27' };
    expect(describeChild(myles, { untilAge: 18, custody }, now, same).nextBirthday).toBe("Turns 16 on 2027-04-27, in their other parent's week.");
    expect(describeChild({ ...myles, birthDate: '2011-11-02' }, { untilAge: 18, custody }, now, same).nextBirthday).toBe('Turns 15 today, in your week.');
  });

  it('has no time line or week for a child not on the schedule, and says when one has turned 18', () => {
    const sam = describeChild(calendar.children[1], { untilAge: 18, custody: null }, now, same);
    expect(sam.weeks).toBeNull();
    expect(sam.nextBirthday).toBe('Turns 12 on 2027-01-10.');
    const later = parseDateId('2028-07-01');
    const grown = describeChild(calendar.children[0], { time: { untilDate: '2028-06-28', weeksRemaining: 0, daysRemaining: 0 }, untilAge: 18, custody }, later, same);
    expect(grown.weeks.note).toBe('Turned 18 on 2028-06-28.');
    expect(grown.ahead).toBe('');
  });
});

describe('FamilyTimePanel', () => {
  it('shows every child, the schedule only for those on it, and editing only to the owner', () => {
    const owner = renderToStaticMarkup(<FamilyTimePanel calendar={calendar} today="2026-11-02" canEdit onEdit={() => {}} />);
    expect(owner).toContain('With you this week');
    expect(owner).toContain('David');
    expect(owner).toContain('Sam');
    expect(owner.match(/weeks? left with you/g)).toHaveLength(1);
    expect(owner).toContain('Ms. Lee');
    expect(owner).toContain('Before 18: 1\u00a0summer');
    expect(owner).toContain('Edit kids and schedule');
    expect(renderToStaticMarkup(<FamilyTimePanel calendar={calendar} today="2026-11-02" canEdit={false} />)).not.toContain('<button');
  });
});

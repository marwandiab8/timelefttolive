import { describe, expect, it } from 'vitest';
import { parseDateId } from './dateUtils.js';
import { describeMilestone, describeWeeksAway, getChildMilestones, getFamilyMilestones } from './childMilestones.js';

const now = parseDateId('2026-11-26');
const custody = { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, childIds: ['d', 'j'] };
const david = { id: 'd', name: 'David', birthDate: '2010-06-28', grade: '11', gradeSchoolYear: 2026 };
const joseph = { id: 'j', name: 'Joseph', birthDate: '2013-04-15', grade: '8', gradeSchoolYear: 2026 };
const keaton = { id: 'k', name: 'Keaton', birthDate: '2013-10-04', grade: '7', gradeSchoolYear: 2025 };

describe('getChildMilestones', () => {
  it('lists the G1, the end of Grade 8 and 12 and the 18th that are still ahead, soonest first', () => {
    const milestones = getChildMilestones(joseph, { now, custodySchedule: custody });
    expect(milestones.map((item) => [item.key, item.dateId, item.precision])).toEqual([
      ['grade8', '2027-06-30', 'month'],
      ['g1', '2029-04-15', 'day'],
      ['eighteen', '2031-04-15', 'day'],
      ['grade12', '2031-06-30', 'month']
    ]);
    expect(milestones[1]).toMatchObject({ name: 'Joseph', weeksAway: 124, withYou: false });
    expect(milestones[0].withYou).toBeNull(); // school endings are known to the month only
  });

  it('drops what has passed, and moves the grade up each September', () => {
    expect(getChildMilestones(david, { now }).map((item) => item.key)).toEqual(['eighteen', 'grade12']);
    // Saved as Grade 7 in 2025, so Grade 8 this school year.
    expect(getChildMilestones(keaton, { now }).find((item) => item.key === 'grade8').dateId).toBe('2027-06-30');
  });

  it('says nothing about whose week for a child not on the schedule, or without a birth date', () => {
    expect(getChildMilestones(keaton, { now, custodySchedule: custody }).every((item) => item.withYou === null)).toBe(true);
    expect(getChildMilestones({ id: 'x', name: 'X' }, { now })).toEqual([]);
  });
});

describe('getFamilyMilestones', () => {
  it('merges the children, soonest first, up to the limit', () => {
    const all = getFamilyMilestones([david, joseph, keaton], { now, custodySchedule: custody }, 3);
    expect(all.map((item) => `${item.name} ${item.key}`)).toEqual(['Joseph grade8', 'Keaton grade8', 'David eighteen']);
  });
});

describe('describeMilestone', () => {
  const same = (dateId) => dateId;
  it('reads as a plain sentence with the week it falls in', () => {
    const [, g1] = getChildMilestones(joseph, { now, custodySchedule: custody });
    expect(describeMilestone(g1, { day: same })).toBe("Joseph can get a G1 licence in 124 weeks (2029-04-15), in their other parent's week.");
    const [grade8] = getChildMilestones(joseph, { now });
    expect(describeMilestone(grade8, { month: () => 'June 2027' })).toBe('Joseph finishes Grade 8 in June 2027.');
    expect(describeMilestone({ ...g1, withYou: true }, { withName: false, day: same })).toBe('Can get a G1 licence in 124 weeks (2029-04-15), in your week.');
  });

  it('counts the weeks in words', () => {
    expect([0, 1, 2, 1200].map(describeWeeksAway)).toEqual(['this week', 'next week', 'in 2 weeks', `in ${(1200).toLocaleString()} weeks`]);
  });
});

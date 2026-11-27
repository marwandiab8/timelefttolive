import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  chancesLeft,
  countWeeksWithKids,
  deadlineDate,
  describeDeadline,
  planForm,
  plansFor,
  plansForWeek,
  sortPlans,
  upcomingWeeksWithKids
} from './thingsToDo.js';

const today = '2026-11-26';
const calendar = {
  birthDate: '1975-02-24',
  children: [
    { id: 'd', name: 'David', birthDate: '2010-06-28' },
    { id: 'j', name: 'Joseph', birthDate: '2013-04-15' }
  ],
  custodySchedule: { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, childIds: ['d', 'j'] }
};
const same = (dateId) => dateId;

describe('deadlines', () => {
  it('turns each kind of deadline into its last day and a phrase', () => {
    const joseph = { deadline: { kind: 'age', personId: 'j', age: 18 } };
    expect(deadlineDate(joseph, calendar)).toBe('2031-04-14');
    expect(describeDeadline(joseph, calendar, today)).toBe('Before Joseph turns 18');
    const me = { deadline: { kind: 'age', personId: 'me', age: 90 } };
    expect(deadlineDate(me, calendar)).toBe('2065-02-23');
    expect(describeDeadline(me, calendar, today)).toBe('Before I turn 90');
    expect(deadlineDate({ deadline: { kind: 'season', season: 'summer', year: 2027 } }, calendar)).toBe('2027-08-31');
    expect(describeDeadline({ deadline: { kind: 'season', season: 'summer', year: 2027 } }, calendar, today)).toBe('Next summer');
    expect(describeDeadline({ deadline: { kind: 'season', season: 'christmas', year: 2026 } }, calendar, today)).toBe('This Christmas');
    expect(describeDeadline({ deadline: { kind: 'season', season: 'summer', year: 2030 } }, calendar, today)).toBe('Summer 2030');
    expect(describeDeadline({ deadline: { kind: 'date', date: '2027-03-01' } }, calendar, today, same)).toBe('By 2027-03-01');
    expect(deadlineDate({ deadline: null }, calendar)).toBeNull();
    expect(deadlineDate({ deadline: { kind: 'age', personId: 'nobody', age: 18 } }, calendar)).toBeNull();
  });
});

describe('chancesLeft', () => {
  it('counts your weeks with the boys and the summers for something with them years away', () => {
    const chances = chancesLeft({ who: ['j'], deadline: { kind: 'age', personId: 'j', age: 18 } }, calendar, today);
    expect(chances).toMatchObject({ past: false, summers: 4, weeksWithKids: 115 });
    expect(chances.text).toBe('115 of your weeks with them · 4 summers left');
  });

  it('counts weekends for something less than a year away, and nothing about the boys for something of your own', () => {
    const chances = chancesLeft({ who: ['me'], deadline: { kind: 'season', season: 'summer', year: 2027 } }, calendar, today);
    expect(chances).toMatchObject({ weekends: 40, weeksWithKids: null, text: '40 weekends left' });
  });

  it('says when the deadline has passed, and has nothing to count without one', () => {
    expect(chancesLeft({ who: ['me'], deadline: { kind: 'date', date: '2026-11-01' } }, calendar, today)).toMatchObject({ past: true, text: 'The deadline has passed' });
    expect(chancesLeft({ who: ['me'], deadline: null }, calendar, today)).toBeNull();
  });
});

describe('weeks with the kids', () => {
  it('counts the weeks with you up to a day, and lists your next stretches with them', () => {
    expect(countWeeksWithKids(calendar.custodySchedule, today, '2026-12-31')).toBe(3); // Nov 22, Dec 6, Dec 20
    expect(countWeeksWithKids({ enabled: false }, today, '2026-12-31')).toBeNull();
    expect(upcomingWeeksWithKids(calendar.custodySchedule, today, 3)).toEqual(['2026-11-22', '2026-12-06', '2026-12-20']);
    expect(upcomingWeeksWithKids(calendar.custodySchedule, '2026-11-30', 2)).toEqual(['2026-12-06', '2026-12-20']);
    expect(upcomingWeeksWithKids(null, today)).toEqual([]);
  });
});

describe('lists', () => {
  const plans = [
    { id: 'a', title: 'Cottage weekend', who: ['d', 'j'], deadline: { kind: 'season', season: 'summer', year: 2027 }, plannedWeekStart: '2026-12-06' },
    { id: 'b', title: 'Learn to drive stick', who: ['d'], deadline: { kind: 'age', personId: 'd', age: 18 } },
    { id: 'c', title: 'Iceland', who: ['me'], deadline: null },
    { id: 'd', title: 'Leafs game', who: ['j'], deadline: null, doneOn: '2026-10-02' },
    { id: 'e', title: 'Hike Bruce Trail', who: ['me'], deadline: null, doneOn: '2026-11-20' }
  ];

  it('puts the soonest deadline first, plans without one last, and the most recently done first', () => {
    const { open, done } = sortPlans(plans, calendar);
    expect(open.map((plan) => plan.id)).toEqual(['a', 'b', 'c']);
    expect(done.map((plan) => plan.id)).toEqual(['e', 'd']);
  });

  it('finds the plans for a person and for one of your weeks with the boys', () => {
    expect(plansFor(plans, 'j').map((plan) => plan.id)).toEqual(['a', 'd']);
    expect(plansForWeek(plans, '2026-12-06').map((plan) => plan.id)).toEqual(['a']);
  });
});

describe('buildPlan and planForm', () => {
  it('saves a clean, private plan, defaulting to you', () => {
    expect(buildPlan({ ...planForm(null, today), title: '  Iceland  ' }, calendar)).toEqual({
      title: 'Iceland', notes: '', who: ['me'], deadline: null, plannedWeekStart: '', doneOn: '', visibility: 'ownerOnly'
    });
  });

  it('keeps only real people and a complete deadline, and round-trips through the form', () => {
    const saved = buildPlan({
      ...planForm(null, today),
      title: 'Cottage weekend', who: ['d', 'j', 'ghost'], deadlineKind: 'age', deadlinePersonId: 'j', deadlineAge: '18',
      plannedWeekStart: '2026-12-06', shareWithViewers: true
    }, calendar);
    expect(saved).toMatchObject({ who: ['d', 'j'], deadline: { kind: 'age', personId: 'j', age: 18 }, plannedWeekStart: '2026-12-06', visibility: 'viewers' });
    expect(buildPlan({ ...planForm(saved, today), title: saved.title }, calendar)).toEqual(saved);
    expect(buildPlan({ ...planForm(null, today), title: 'x', deadlineKind: 'date', deadlineDate: 'soon' }, calendar).deadline).toBeNull();
  });
});

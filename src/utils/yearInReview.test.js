import { describe, expect, it } from 'vitest';
import { buildYearInReview, lifeYearWeeks, summarizeYearActivity, yearHeadline } from './yearInReview.js';

const calendar = {
  birthDate: '1985-02-24',
  children: [{ id: 'ben', name: 'Ben' }, { id: 'charlie', name: 'Charlie' }],
  custodySchedule: { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, since: '2026-11-01' }
};

const reviews = {
  '2026-11-17': { weekStart: '2026-11-17', rating: 5, moment: 'Leafs game with the boys', intentionKept: 'yes' },
  '2026-11-10': { weekStart: '2026-11-10', rating: 4, mattered: 'Quiet week', intentionKept: 'partly' },
  '2026-03-03': { weekStart: '2026-03-03', rating: 2, moment: '' },
  '2025-11-18': { weekStart: '2025-11-18', rating: 5, moment: 'Last year' }
};

const review = buildYearInReview({
  calendar,
  age: 41,
  today: '2026-11-27',
  reviews,
  events: [
    { title: 'Cottage', startDate: '2026-05-01', endDate: '2026-05-03' },
    { title: 'Living in Toronto', startDate: '2019-06-01', endDate: '2026-11-27', ongoing: true },
    { title: 'Christmas', startDate: '2026-12-25', endDate: '2026-12-25' }
  ],
  entries: [
    { dateId: '2026-03-01', notes: '7:24 PM: Pancakes' },
    { dateId: '2026-03-02', notes: '  ' },
    { dateId: '2025-01-01', notes: 'Last year' }
  ],
  plans: [
    { title: 'See the northern lights', doneOn: '2026-06-01' },
    { title: 'Last year', doneOn: '2025-12-01' },
    { title: 'Not yet', doneOn: '' }
  ],
  measurements: [
    { childId: 'ben', kind: 'height', measuredOn: '2026-03-01', valueMm: 1200 },
    { childId: 'ben', kind: 'height', measuredOn: '2026-11-01', valueMm: 1250.8 },
    { childId: 'charlie', kind: 'height', measuredOn: '2025-03-01', valueMm: 1000 }
  ]
});

describe('the year in squares', () => {
  it('is the 52 squares from one birthday to the day before the next', () => {
    const weeks = lifeYearWeeks('1985-02-24', 41);
    expect(weeks).toHaveLength(52);
    expect(weeks[0]).toMatchObject({ start: '2026-02-24', end: '2026-03-02', weekIndex: 0 });
    expect(weeks[51]).toMatchObject({ start: '2027-02-16', end: '2027-02-23', weekIndex: 51 });
  });

  it('counts only the weeks lived so far in a year still under way', () => {
    expect(review).toMatchObject({ title: 'Age 41', range: 'Feb 24, 2026 to Feb 23, 2027', soFar: true, future: false, livedWeekCount: 40 });
    expect(review.weeks[39]).toMatchObject({ start: '2026-11-24', lived: true, daysWithKids: 4 });
    expect(review.weeks[40].lived).toBe(false);
    expect(review.weeks[38]).toMatchObject({ start: '2026-11-17', reviewed: true, rating: 5, daysWithKids: 2 });
  });
});

describe('what the year held', () => {
  it('sums up the ratings and intentions of that year only', () => {
    expect(review.ratings).toEqual({
      reviewed: 3,
      rated: 3,
      average: 3.7,
      counts: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 },
      intentions: { set: 2, yes: 1, partly: 1, no: 0 }
    });
  });

  it('picks the best weeks that have something written, best first', () => {
    expect(review.bestWeeks).toEqual([
      { start: '2026-11-17', rating: 5, text: 'Leafs game with the boys', label: 'Great · week of Nov 17' },
      { start: '2026-11-10', rating: 4, text: 'Quiet week', label: 'Good · week of Nov 10' }
    ]);
  });

  it('counts the days with the boys since the schedule began, up to today', () => {
    // Nov 8 to 14, and Nov 22 to 27 so far.
    expect(review.kids).toEqual({ days: 13, of: 27, scheduleBegan: true, weeks: 4 });
    expect(buildYearInReview({ calendar: { ...calendar, custodySchedule: { ...calendar.custodySchedule, since: '' } }, age: 41, today: '2026-11-27' }).kids).toBeNull();
  });

  it('lists what was done, what began, the days written about and how the kids grew', () => {
    expect(review.done).toEqual([{ title: 'See the northern lights', doneOn: '2026-06-01', when: 'Jun 1' }]);
    expect(review.events).toEqual({ count: 1, named: [{ title: 'Cottage', startDate: '2026-05-01', when: 'May 1' }] });
    expect(review.writtenDays).toBe(1);
    expect(review.heights).toEqual([{ childId: 'ben', name: 'Ben', latest: `4' 1 1/4"`, latestOn: 'Nov 1', change: '+2"', since: 'Mar 1' }]);
  });

  it('says it in one line', () => {
    expect(yearHeadline(review)).toBe('40 weeks so far · 3 reviewed · 13 days with the boys · 1 thing done.');
    const past = buildYearInReview({ calendar: { birthDate: '1985-02-24' }, age: 40, today: '2026-11-27' });
    expect(past).toMatchObject({ soFar: false, livedWeekCount: 52, kids: null, heights: [] });
    expect(yearHeadline(past)).toBe('52 weeks.');
    expect(yearHeadline(buildYearInReview({ calendar, age: 42, today: '2026-11-27' }))).toBe('This year hasn’t started yet.');
  });
});

describe('the year in activity', () => {
  it('totals the biggest categories, with sessions and days', () => {
    const analysis = {
      categories: [
        { label: 'Work', color: '#4f8fdc', seconds: 3600 * 1000, sessions: [
          { startAt: new Date('2026-03-02T14:00:00Z') },
          { startAt: new Date('2026-03-02T20:00:00Z') },
          { startAt: new Date('2026-03-03T14:00:00Z') }
        ] },
        { label: 'Blip', seconds: 30, sessions: [] }
      ]
    };
    expect(summarizeYearActivity(analysis)).toEqual({
      trackedSeconds: 3600 * 1000,
      categories: [{ label: 'Work', color: '#4f8fdc', seconds: 3600 * 1000, sessions: 3, days: 2 }]
    });
    expect(summarizeYearActivity({ categories: [] })).toBeNull();
  });
});

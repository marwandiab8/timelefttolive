import { describe, expect, it } from 'vitest';
import { buildOnThisDay, describeActivity, eventsOnDay, noteLines, onThisDayDates, onThisDayHeadline } from './onThisDay.js';

describe('the days looked back on', () => {
  it('is the same day 1, 2, 5 and 10 years ago', () => {
    expect(onThisDayDates('2026-11-27')).toEqual([
      { yearsAgo: 1, dateId: '2025-11-27' },
      { yearsAgo: 2, dateId: '2024-11-27' },
      { yearsAgo: 5, dateId: '2021-11-27' },
      { yearsAgo: 10, dateId: '2016-11-27' }
    ]);
  });

  it('uses Feb 28 for a Feb 29 in a year without one, and skips days before birth', () => {
    expect(onThisDayDates('2028-02-29').map((day) => day.dateId)).toEqual(['2027-02-28', '2026-02-28', '2023-02-28', '2018-02-28']);
    expect(onThisDayDates('2024-02-29', { years: [4] })[0].dateId).toBe('2020-02-29');
    expect(onThisDayDates('2026-11-27', { birthDate: '2020-01-01' }).map((day) => day.yearsAgo)).toEqual([1, 2, 5]);
  });
});

describe('what was on a day', () => {
  it('reads the notes without the quick-capture times', () => {
    expect(noteLines({ notes: '9:02 AM: Hockey at 7\n\n7:24 PM: Pancakes' })).toEqual(['Hockey at 7', 'Pancakes']);
    expect(noteLines({ notes: '  ', journalText: 'Old journal' })).toEqual(['Old journal']);
    expect(noteLines(null)).toEqual([]);
  });

  it('names events on the day, a longer one as what was under way, and an ongoing one only on the day it started', () => {
    const events = [
      { title: 'Cottage', startDate: '2025-11-26', endDate: '2025-11-29' },
      { title: 'Living in Toronto', startDate: '2019-06-01', endDate: '2026-11-27', ongoing: true, everyDay: true },
      { title: 'Started at Matheson', startDate: '2025-11-27', endDate: '2026-11-27', ongoing: true, everyDay: true },
      { title: 'Recital', startDate: '2025-11-27', endDate: '2025-11-27' },
      { title: 'With Allison', startDate: '2016-08-25', endDate: '2017-10-19' }
    ];
    expect(eventsOnDay(events, '2025-11-27')).toEqual([
      { kind: 'period', text: 'Cottage, Nov 26 to Nov 29' },
      { kind: 'event', text: 'Started at Matheson began' },
      { kind: 'event', text: 'Recital' }
    ]);
    expect(eventsOnDay(events, '2016-11-27')).toEqual([{ kind: 'period', text: 'With Allison, Aug 25 to Oct 19, 2017' }]);
  });

  it('describes the biggest few activities of the day', () => {
    expect(describeActivity([
      { label: 'Sleep', seconds: 8 * 3600 },
      { label: 'Work', seconds: 7 * 3600 + 52 * 60 },
      { label: 'Gym/Fitness', seconds: 70 * 60 },
      { label: 'Driving', seconds: 30 * 60 },
      { label: 'Blip', seconds: 20 }
    ])).toBe('Sleep 8h · Work 7h 52m · Gym/Fitness 1h 10m');
  });
});

describe('on this day', () => {
  const groups = buildOnThisDay({
    todayId: '2026-11-27',
    birthDate: '1975-02-24',
    events: [{ title: 'Recital', startDate: '2021-11-27', endDate: '2021-11-27' }],
    entries: {
      '2025-11-27': { notes: '7:24 PM: Playing darts with David' },
      '2024-11-27': { notes: '' }
    },
    attachments: {
      '2025-11-27': [{ type: 'image' }, { type: 'image' }, { type: 'pdf' }],
      '2016-11-27': [{ type: 'image' }]
    },
    reviews: { '2025-11-24': { weekStart: '2025-11-24', rating: 4, moment: 'Skating at the Bentway' } },
    activity: { '2025-11-27': [{ label: 'Work', seconds: 8 * 3600 }] }
  });

  it('groups each year that has something, most recent first', () => {
    expect(groups.map((group) => group.yearsAgo)).toEqual([1, 5, 10]);
    expect(groups[0]).toEqual({
      yearsAgo: 1,
      dateId: '2025-11-27',
      heading: '1 year ago · Thu, Nov 27, 2025',
      items: [
        { kind: 'note', text: 'Playing darts with David' },
        { kind: 'attachments', text: '2 photos and 1 file saved' },
        { kind: 'review', text: 'That week: Good week: Skating at the Bentway' },
        { kind: 'activity', text: 'Work 8h' }
      ]
    });
    expect(groups[1].items).toEqual([{ kind: 'event', text: 'Recital' }]);
    expect(groups[2].items).toEqual([{ kind: 'attachments', text: '1 photo saved' }]);
  });

  it('sums it up in one line, preferring words over counts, and what happened over what was under way', () => {
    const under = [{ yearsAgo: 10, items: [{ kind: 'period', text: 'With Allison, Aug 25 to Oct 19, 2017' }, { kind: 'attachments', text: '1 photo saved' }] }];
    expect(onThisDayHeadline(under)).toBe('On this day 10 years ago: 1 photo saved');
    expect(onThisDayHeadline([{ ...under[0], items: under[0].items.slice(0, 1) }])).toBe('On this day 10 years ago: With Allison, Aug 25 to Oct 19, 2017');
    expect(onThisDayHeadline(groups)).toBe('On this day 1 year ago: Playing darts with David · and 2 more years');
    expect(onThisDayHeadline([groups[2]])).toBe('On this day 10 years ago: 1 photo saved');
    expect(onThisDayHeadline([])).toBe('');
    const sentence = [{ yearsAgo: 1, items: [{ kind: 'note', text: 'Three bagels in a row.' }] }, groups[2]];
    expect(onThisDayHeadline(sentence)).toBe('On this day 1 year ago: Three bagels in a row · and 1 more year');
    expect(onThisDayHeadline(sentence.slice(0, 1))).toBe('On this day 1 year ago: Three bagels in a row.');
  });

  it('is empty when nothing happened on those days', () => {
    expect(buildOnThisDay({ todayId: '2026-11-27', birthDate: '1975-02-24' })).toEqual([]);
  });
});

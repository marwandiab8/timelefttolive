import { describe, expect, it } from 'vitest';
import { buildSearchRecords, highlight, parseQuery, searchRecords, snippet } from './search.js';

const records = buildSearchRecords({
  entries: [
    { dateId: '2025-11-27', notes: '7:24 PM: Playing darts with David\n9:10 PM: Ben won a game' },
    { dateId: '2024-03-02', notes: '', journalText: 'Skating at the Bentway with the boys' },
    { dateId: '2024-03-03', notes: '   ' }
  ],
  events: [
    { id: 'e1', title: 'Cottage weekend', description: 'Muskoka with the boys', startDate: '2025-08-01', endDate: '2025-08-03' },
    { id: 'e2', title: 'Living in Toronto', startDate: '2019-06-01', endDate: '2026-11-27', ongoing: true },
    { id: 'e3', title: 'Café opening', startDate: '2023-05-05', endDate: '2023-05-05' }
  ],
  reviews: {
    '2025-11-24': { weekStart: '2025-11-24', rating: 4, moment: 'Darts night', mattered: '', intention: 'Call Mom' },
    '2025-11-17': { weekStart: '2025-11-17', rating: 3 }
  },
  plans: [
    { id: 'p1', title: 'Take the boys to a Leafs game', notes: 'Before Ben turns 12', doneOn: '', plannedWeekStart: '' },
    { id: 'p2', title: 'Teach Ben to skate', doneOn: '2024-02-10', who: ['me', 'charlie'] }
  ],
  measurements: [{ id: 'm1', childId: 'ben', measuredOn: '2026-11-23', valueMm: 1219.2, asWritten: "4'", note: 'Growth spurt' }],
  children: [{ id: 'ben', name: 'Ben' }, { id: 'charlie', name: 'Charlie' }]
});

describe('what can be searched', () => {
  it('has one record per note day, event, written review, plan and measurement', () => {
    expect(records.map((record) => record.id)).toEqual([
      'note-2025-11-27', 'note-2024-03-02',
      'event-e1', 'event-e2', 'event-e3',
      'review-2025-11-24',
      'plan-p1', 'plan-p2',
      'measurement-m1'
    ]);
  });

  it('describes each in words, without the quick-capture times', () => {
    const byId = Object.fromEntries(records.map((record) => [record.id, record]));
    expect(byId['note-2025-11-27']).toMatchObject({ kind: 'note', title: 'Thu, Nov 27, 2025', text: 'Playing darts with David\nBen won a game', ref: { dateId: '2025-11-27' } });
    expect(byId['event-e1']).toMatchObject({ when: 'Aug 1, 2025 to Aug 3, 2025', text: 'Muskoka with the boys' });
    expect(byId['event-e2'].when).toBe('Jun 1, 2019 to now');
    expect(byId['event-e3'].when).toBe('May 5, 2023');
    expect(byId['review-2025-11-24']).toMatchObject({ title: 'Week of Nov 24, 2025', when: 'Good week', text: 'Darts night\nIntention: Call Mom', ref: { weekStart: '2025-11-24' } });
    expect(byId['plan-p1']).toMatchObject({ dateId: '', when: 'Not done yet', ref: { planId: 'p1' } });
    expect(byId['plan-p2']).toMatchObject({ dateId: '2024-02-10', when: 'Done Feb 10, 2024' });
    expect(byId['measurement-m1']).toMatchObject({ title: `Ben, 4' 0"`, text: "4' · Growth spurt", ref: { childId: 'ben', dateId: '2026-11-23' } });
  });
});

describe('searching', () => {
  const ids = (query) => searchRecords(records, query).results.map((result) => result.id);

  it('needs every word, in any order, ignoring case and accents', () => {
    expect(ids('darts')).toEqual(['note-2025-11-27', 'review-2025-11-24']);
    expect(ids('BOYS skat')).toEqual(['note-2024-03-02']);
    expect(ids('boys')).toEqual(['event-e1', 'note-2024-03-02', 'plan-p1']);
    expect(ids('cafe')).toEqual(['event-e3']);
    expect(ids('"won a game"')).toEqual(['note-2025-11-27']);
    expect(ids('"game won"')).toEqual([]);
  });

  it('finds titles, dates and ratings as well as what was written', () => {
    expect(ids('growth')).toEqual(['measurement-m1']);
    expect(ids('good week')).toEqual(['review-2025-11-24']);
    expect(ids('not done')).toEqual(['plan-p1']);
    expect(ids('charlie')).toEqual(['plan-p2']);
    expect(ids('height')).toEqual(['measurement-m1']);
  });

  it('lists the newest first, undated plans last, and only so many', () => {
    // Bentway has a ben in it too.
    expect(ids('ben')).toEqual(['measurement-m1', 'note-2025-11-27', 'note-2024-03-02', 'plan-p2', 'plan-p1']);
    const limited = searchRecords(records, 'ben', { limit: 2 });
    expect(limited.total).toBe(5);
    expect(limited.results).toHaveLength(2);
  });

  it("doesn't search one letter or nothing", () => {
    expect(searchRecords(records, 'b')).toEqual({ results: [], total: 0, terms: ['b'] });
    expect(searchRecords(records, '   ').total).toBe(0);
    expect(parseQuery('Ben "Leafs game" ben')).toEqual(['leafs game', 'ben']);
  });
});

describe('showing a match', () => {
  it('marks every match', () => {
    expect(highlight('Café with Ben and ben', ['cafe', 'ben'])).toEqual([
      { text: 'Café', match: true },
      { text: ' with ', match: false },
      { text: 'Ben', match: true },
      { text: ' and ', match: false },
      { text: 'ben', match: true }
    ]);
    expect(highlight('Leafs game', ['leafs game', 'game'])).toEqual([{ text: 'Leafs game', match: true }]);
  });

  it('cuts a long text down to the words around the first match', () => {
    const long = `${'Morning routine and school drop off. '.repeat(6)}Then pancakes with Ben at the diner. ${'Work all afternoon. '.repeat(8)}`;
    const cut = snippet(long, ['pancakes'], 30);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toContain('pancakes with Ben');
    expect(cut.length).toBeLessThan(80);
    expect(snippet('Line one\nLine two', ['two'])).toBe('Line one · Line two');
  });
});

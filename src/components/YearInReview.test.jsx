import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildYearInReview } from '../utils/yearInReview.js';

const hookCalls = [];
vi.mock('../hooks/useCalendar.js', () => ({
  useRangeEntries: (calendarId, start, end, role) => {
    hookCalls.push({ hook: 'entries', start, end, role });
    return { entries: [{ dateId: '2026-03-01', notes: 'Pancakes' }], error: '' };
  },
  useLifeEvents: (calendarId, start, end, enabled) => {
    hookCalls.push({ hook: 'activity', enabled });
    return { lifeEvents: [], loading: false, error: '' };
  }
}));

const { default: YearInReview, YearInReviewPage } = await import('./YearInReview.jsx');

const calendar = {
  id: 'c1',
  birthDate: '1985-02-24',
  children: [{ id: 'ben', name: 'Ben' }],
  custodySchedule: { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, since: '2026-11-01' }
};
const reviews = { '2026-11-17': { weekStart: '2026-11-17', rating: 5, moment: 'Leafs game with the boys' } };

describe('year in review', () => {
  it('shows the weeks, the best of them, the boys, what was done and what happened', () => {
    const review = buildYearInReview({
      calendar,
      age: 41,
      today: '2026-11-27',
      reviews,
      plans: [{ title: 'See the northern lights', doneOn: '2026-06-01' }],
      events: [{ title: 'Cottage', startDate: '2026-05-01', endDate: '2026-05-03' }],
      entries: [{ dateId: '2026-03-01', notes: 'Pancakes' }],
      activity: { trackedSeconds: 7200, categories: [{ label: 'Gym/Fitness', color: '#f00', seconds: 7200, sessions: 2, days: 2 }] }
    });
    const html = renderToStaticMarkup(<YearInReviewPage review={review} onOpenWeek={() => {}} onPrint={() => {}} />);
    expect(html).toContain('<h2>Age 41</h2>');
    expect(html).toContain('Feb 24, 2026 to Feb 23, 2027 · so far');
    expect(html).toContain('40 weeks so far · 1 reviewed · 13 days with the boys · 1 thing done.');
    expect(html.match(/<rect/g).length).toBe(52 + 4 + 5);
    expect(html).toContain('<button type="button" class="year-review-link">Great · week of Nov 17</button><span>Leafs game with the boys</span>');
    expect(html).toContain('13 of 27 days since the schedule began so far.');
    expect(html).toContain('<span class="year-review-when">Jun 1</span><span>See the northern lights</span>');
    expect(html).toContain('Something written down on 1 day.');
    expect(html).toContain('<strong>Gym/Fitness</strong><span>2h</span>');
    expect(html).toContain('>Print</button>');
  });

  it('leaves out what it has nothing for, and has nothing to show before the year starts', () => {
    const empty = renderToStaticMarkup(<YearInReviewPage review={buildYearInReview({ calendar: { birthDate: '1985-02-24' }, age: 40, today: '2026-11-27' })} />);
    expect(empty).toContain('No weeks rated this year.');
    expect(empty).not.toContain('Best weeks');
    expect(empty).not.toContain('With the boys');
    expect(empty).not.toContain('Tracked time');
    expect(empty).not.toContain('Print');
    const ahead = renderToStaticMarkup(<YearInReviewPage review={buildYearInReview({ calendar, age: 42, today: '2026-11-27' })} onPrint={() => {}} />);
    expect(ahead).toContain('This year hasn’t started yet.');
    expect(ahead).not.toContain('<svg');
  });

  it('reads the year’s notes for whoever is reading, and tracked time only for the owner', () => {
    hookCalls.length = 0;
    renderToStaticMarkup(<YearInReview calendar={calendar} age={41} today="2026-11-27" role="viewer" events={[]} reviews={{}} plans={[]} measurements={[]} />);
    expect(hookCalls).toEqual([
      { hook: 'entries', start: '2026-02-24', end: '2026-11-27', role: 'viewer' },
      { hook: 'activity', enabled: false }
    ]);
    hookCalls.length = 0;
    const html = renderToStaticMarkup(<YearInReview calendar={calendar} age={41} today="2026-11-27" role="owner" events={[]} reviews={{}} plans={[]} measurements={[]} />);
    expect(hookCalls).toContainEqual({ hook: 'activity', enabled: true });
    expect(html).toContain('Something written down on 1 day.');
  });
});

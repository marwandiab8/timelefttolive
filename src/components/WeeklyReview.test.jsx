import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeeklyReviewCard, describeReviewCard } from './WeeklyReview.jsx';
import { WeekReviewSummary } from './CalendarDrilldown.jsx';

// Squares start on Thursdays in 2026 for this birthday: Nov 19 to 25 is last week on Nov 26, Nov 26 to Dec 2 this week.
const birthDate = '1985-03-12';
const calendar = { id: 'c1', birthDate };

describe('describeReviewCard', () => {
  it('asks about last week, reminding you of the intention you set for it', () => {
    const card = describeReviewCard({ birthDate, today: '2026-11-26', reviews: { '2026-11-12': { intention: 'Call Mom on Sunday' } }, skipped: [] });
    expect(card).toMatchObject({ state: 'due', headline: 'How was last week?', week: { start: '2026-11-19', end: '2026-11-25' } });
    expect(card.lines).toEqual([expect.stringContaining('Nov'), 'You meant to: Call Mom on Sunday']);
  });

  it('carries last week’s intention into this week once it is reviewed', () => {
    const reviews = {
      '2026-11-12': { weekStart: '2026-11-12', rating: 3 },
      '2026-11-19': { weekStart: '2026-11-19', weekEnd: '2026-11-25', rating: 4, intention: 'Gym three times' }
    };
    const card = describeReviewCard({ birthDate, today: '2026-11-28', reviews, skipped: [] });
    expect(card).toMatchObject({ state: 'done', headline: 'This week: Gym three times', week: { start: '2026-11-19' } });
    expect(card.lines).toEqual([expect.stringMatching(/^Last week, .* was good$/), '2 weeks reviewed in a row']);
  });

  it('asks about this week on its last day, then points to the next one', () => {
    const reviews = { '2026-11-19': { rating: 4 } };
    expect(describeReviewCard({ birthDate, today: '2026-12-02', reviews, skipped: [] })).toMatchObject({ state: 'due', headline: 'This week ends today. How was it?' });
    const done = describeReviewCard({ birthDate, today: '2026-12-02', reviews: { ...reviews, '2026-11-26': { rating: 5, intention: 'Cottage plans' } }, skipped: [] });
    expect(done).toMatchObject({ state: 'done', headline: 'Next week: Cottage plans', lines: ['2 weeks reviewed in a row'] });
  });

  it('stays quiet after a skip, and says the rating when there is no intention', () => {
    expect(describeReviewCard({ birthDate, today: '2026-11-26', reviews: {}, skipped: ['2026-11-19'] })).toBeNull();
    expect(describeReviewCard({ birthDate, today: '2026-11-26', reviews: { '2026-11-19': { rating: 2 } }, skipped: [] }))
      .toMatchObject({ headline: 'Last week was meh', lines: ['1 week reviewed in a row'] });
  });
});

describe('WeeklyReviewCard', () => {
  it('offers to review or skip the week', () => {
    const html = renderToStaticMarkup(<WeeklyReviewCard calendar={calendar} today="2026-11-26" reviews={{}} onOpen={() => {}} />);
    expect(html).toContain('How was last week?');
    expect(html).toContain('Review the week');
    expect(html).toContain('Skip');
  });

  it('offers to edit once the week is reviewed', () => {
    const html = renderToStaticMarkup(<WeeklyReviewCard calendar={calendar} today="2026-11-26" reviews={{ '2026-11-19': { rating: 4, intention: 'Sleep by 11' } }} onOpen={() => {}} />);
    expect(html).toContain('This week: Sleep by 11');
    expect(html).toContain('Edit the review');
    expect(html).not.toContain('Skip');
  });
});

describe('WeekReviewSummary', () => {
  it('shows the rating, the words, the intention and the numbers', () => {
    const html = renderToStaticMarkup(<WeekReviewSummary review={{
      rating: 5,
      mattered: 'Wings with the boys',
      moment: 'Charlie talked the whole way home',
      intention: 'Gym three times',
      numbers: { trackedSeconds: 3600, categories: [{ label: 'Sleep', seconds: 3600 }], targets: [], daysWithKids: 4, journalDays: 2, dayCount: 7 }
    }} />);
    expect(html).toContain('The week was great');
    expect(html).toContain('Wings with the boys');
    expect(html).toContain('Charlie talked the whole way home');
    expect(html).toContain('Intention for the next week: Gym three times');
    expect(html).toContain('4 days with the boys');
  });
});

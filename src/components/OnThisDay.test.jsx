import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const hookCalls = [];
vi.mock('../hooks/useCalendar.js', () => ({
  useWeekEntries: (calendarId, dateIds, role) => {
    hookCalls.push({ hook: 'entries', dateIds, role });
    return { entries: { '2025-11-27': { notes: '7:24 PM: Playing darts with David', visibility: 'viewers' } } };
  },
  useWeekAttachments: () => ({ attachments: { '2016-11-27': [{ type: 'image' }] } }),
  useLifeEventsOnDays: (calendarId, dateIds, enabled) => {
    hookCalls.push({ hook: 'activity', enabled });
    return { byDay: {} };
  }
}));

const { default: OnThisDay, OnThisDayList } = await import('./OnThisDay.jsx');

const calendar = { id: 'c1', birthDate: '1975-02-24' };

describe('on this day on the calendar', () => {
  it('is one line that opens into each year, with a way into that day', () => {
    const html = renderToStaticMarkup(
      <OnThisDay calendar={calendar} today="2026-11-27" role="owner" events={[]} reviews={{}} onOpenDay={() => {}} />
    );
    expect(html).toContain('<details class="on-this-day"><summary>On this day 1 year ago: Playing darts with David · and 1 more year</summary>');
    expect(html).toContain('>1 year ago · Thu, Nov 27, 2025</button>');
    expect(html).toContain('<li class="on-this-day-attachments">1 photo saved</li>');
    expect(hookCalls).toContainEqual({ hook: 'entries', dateIds: ['2025-11-27', '2024-11-27', '2021-11-27', '2016-11-27'], role: 'owner' });
    expect(hookCalls).toContainEqual({ hook: 'activity', enabled: true });
  });

  it("doesn't ask for activity for a viewer", () => {
    hookCalls.length = 0;
    renderToStaticMarkup(<OnThisDay calendar={calendar} today="2026-11-27" role="viewer" events={[]} reviews={{}} />);
    expect(hookCalls).toContainEqual({ hook: 'activity', enabled: false });
  });

  it('shows nothing when nothing happened on those days, and plain headings without a way in', () => {
    expect(renderToStaticMarkup(<OnThisDayList groups={[]} />)).toBe('');
    const html = renderToStaticMarkup(<OnThisDayList groups={[{ yearsAgo: 2, dateId: '2024-11-27', heading: '2 years ago · Wed, Nov 27, 2024', items: [{ kind: 'event', text: 'Recital' }] }]} />);
    expect(html).toContain('<h3>2 years ago · Wed, Nov 27, 2024</h3>');
    expect(html).not.toContain('<button');
  });
});

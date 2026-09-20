import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useCalendar.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useRangeEntries: () => ({ entries: [], error: '' })
}));
vi.mock('../services/externalSources/externalDailyItems.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useRangeExternalItems: () => ({ items: [], error: '' })
}));

const { WeekDetailView } = await import('./CalendarDrilldown.jsx');

const calendar = { id: 'cal-1', ownerUid: 'owner-1', birthDate: '1988-06-15', targetAge: 80 };
const event = (id, title, startDate, endDate, color) => ({ id, title, startDate, endDate, color, visibility: 'viewers' });

function renderWeek(props) {
  return renderToStaticMarkup(
    <WeekDetailView calendar={calendar} age={38} events={[]} role="owner" onNavigate={vi.fn()} {...props} />
  );
}

describe('WeekDetailView', () => {
  it('shows exactly the days of the week that was opened, so today stays in it', () => {
    // The heatmap cell runs Monday 2026-09-14 to Sunday 2026-09-20. The view used to
    // snap back to Sunday 2026-09-13 and end on Saturday 2026-09-19, dropping today.
    const markup = renderWeek({ weekStart: '2026-09-14', weekEnd: '2026-09-20' });
    expect(markup).toContain('2026-09-14 to 2026-09-20');
    expect(markup).not.toContain('2026-09-13');
    expect(markup.match(/day-nav-card/g)).toHaveLength(7);
    expect(markup).toContain('Sunday');
    expect(markup).toContain('2026-09-20');
  });

  it('shows all nine days of the longer last week of a life year', () => {
    const markup = renderWeek({ weekStart: '2026-09-15', weekEnd: '2026-09-23' });
    expect(markup.match(/day-nav-card/g)).toHaveLength(9);
    expect(markup).toContain('2026-09-15 to 2026-09-23');
  });

  it('still opens a plain calendar week when no end date is given', () => {
    const markup = renderWeek({ weekStart: '2026-09-15' });
    expect(markup).toContain('2026-09-13 to 2026-09-19');
    expect(markup.match(/day-nav-card/g)).toHaveLength(7);
  });

  it('passes the week\'s end on when a day is opened, so the breadcrumb can come back to the same week', () => {
    const onNavigate = vi.fn();
    const tree = WeekDetailView({ calendar, age: 38, monthId: '2026-09-15', weekStart: '2026-09-14', weekEnd: '2026-09-20', events: [], role: 'owner', onNavigate });
    const cards = [];
    (function collect(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(collect);
      if (String(node.props?.className || '').includes('day-nav-card')) cards.push(node);
      collect(node.props?.children);
    }(tree));
    expect(cards).toHaveLength(7);
    cards.at(-1).props.onClick();
    expect(onNavigate).toHaveBeenCalledWith({
      view: 'day', age: 38, monthId: '2026-09-15', weekStart: '2026-09-14', weekEnd: '2026-09-20', dateId: '2026-09-20'
    });
  });
});

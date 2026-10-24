import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useCalendar.js', () => ({ saveEvent: vi.fn(), deleteEvent: vi.fn() }));
const { default: EventManager } = await import('./EventManager.jsx');

describe('EventManager', () => {
  const calendar = { id: 'cal-1', settings: {} };
  const events = [
    { id: 'ash', title: 'With Ashley', startDate: '2021-04-17', endDate: '2026-10-24', ongoing: true, everyDay: true, color: '#ff6699', visibility: 'ownerOnly' },
    { id: 'trip', title: 'Montreal trip', startDate: '2026-10-30', endDate: '2026-11-02', color: '#4f8cff', visibility: 'viewers' }
  ];
  const markup = renderToStaticMarkup(<EventManager calendar={calendar} events={events} role="owner" onClose={vi.fn()} />);

  it('offers to carry an event every day until it is stopped', () => {
    expect(markup).toContain('Ongoing: carry it every day until I stop it');
  });

  it('lists an ongoing event as running now, with a Stop today button for it only', () => {
    expect(markup).toContain('2021-04-17 to now · ongoing');
    expect(markup).toContain('2026-10-30 to 2026-11-02');
    expect(markup.match(/Stop today/g)).toHaveLength(1);
  });

  it('shows nothing to viewers', () => {
    expect(renderToStaticMarkup(<EventManager calendar={calendar} events={events} role="viewer" onClose={vi.fn()} />)).toBe('');
  });
});

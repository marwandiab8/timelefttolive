import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LifeHeatmap from './LifeHeatmap.jsx';

const calendar = {
  birthDate: '1988-06-15',
  targetAge: 80,
  settings: {
    pastColor: '#46505c',
    currentWeekColor: '#f4c542',
    futureColor: '#17222c',
    weekendColor: '#65d6ad',
    defaultEventColor: '#7c9cff'
  }
};

const event = (id, title, startDate, endDate, color) => ({ id, title, startDate, endDate, color });

function render(events) {
  return renderToStaticMarkup(
    <LifeHeatmap
      calendar={calendar}
      events={events}
      fitMode="fit"
      zoom={1}
      onAgeClick={vi.fn()}
      onFitModeChange={vi.fn()}
      onSelectWeek={vi.fn()}
      onZoomChange={vi.fn()}
    />
  );
}

// Weeks run from the birth date's weekday (Tuesday to Monday for this calendar).
// The buttons for the weeks that carry a given title fragment.
const cellsWith = (markup, fragment) => (markup.match(/<button[^>]*class="week-cell[^"]*"[^>]*>/g) || []).filter((tag) => tag.includes(fragment));

describe('LifeHeatmap events', () => {
  it('draws no wedge layer on a week without events', () => {
    const markup = render([]);
    expect(markup).not.toContain('event-wedges');
    expect(markup).toContain('week-cell past');
  });

  it('fills the square with the event colour when one event covers the week', () => {
    const markup = render([event('a', 'Moved abroad', '2010-03-01', '2010-03-07', '#ef7a85')]);
    expect(markup).toContain('background:linear-gradient(#ef7a85, #ef7a85)');
    expect(markup).not.toContain('conic-gradient(from 0deg, #ef7a85');
  });

  it('splits the square into wedges when several events share a week', () => {
    const markup = render([
      event('a', 'Course', '2012-05-07', '2012-05-11', '#111111'),
      event('b', 'Trip', '2012-05-08', '2012-05-12', '#222222')
    ]);
    expect(markup).toContain('conic-gradient(from 0deg, #111111 0% 50%, #222222 50% 100%)');
  });

  it('names the events in the hover text of their week', () => {
    const markup = render([
      event('a', 'Course', '2012-05-07', '2012-05-11', '#111111'),
      event('b', 'Trip', '2012-05-08', '2012-05-12', '#222222')
    ]);
    const cell = cellsWith(markup, '2 events')[0];
    expect(cell).toContain('2 events: Course, Trip');
  });

  it('says "1 event" in the singular', () => {
    const markup = render([event('a', 'Wedding', '2015-08-10', '2015-08-10', '#f4c542')]);
    expect(cellsWith(markup, '1 event: Wedding')).toHaveLength(1);
  });

  it('shows at most four wedges, with a count badge and the rest named as "more"', () => {
    const many = Array.from({ length: 6 }, (_, index) => event(`e${index}`, `Event ${index}`, `2018-09-0${index + 1}`, '2018-09-10', `#00000${index}`));
    const markup = render(many);
    const cell = cellsWith(markup, '6 events')[0];
    expect(cell).toContain('and 2 more');
    expect(markup).toContain('<span class="event-count">6</span>');
    const gradient = markup.match(/conic-gradient\(from 0deg, [^)]*\)/g).find((value) => value.includes('#000000'));
    expect(gradient.match(/#00000\d/g)).toHaveLength(4);
  });

  it('uses the calendar\'s default event colour when an event has none or an unusable one', () => {
    const markup = render([event('a', 'No colour', '2011-04-06', '2011-04-06', undefined), event('b', 'Odd', '2011-04-07', '2011-04-07', 'url(https://example.com/x)')]);
    expect(markup).toContain('conic-gradient(from 0deg, #7c9cff 0% 50%, #7c9cff 50% 100%)');
    expect(markup).not.toContain('example.com');
  });

  it('adds an Events entry to the legend', () => {
    expect(render([])).toContain('swatch-events');
  });
});

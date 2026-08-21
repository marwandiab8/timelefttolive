import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TotalsView } from './ActivityDashboard.jsx';

const allTimeRange = {
  id: 'all',
  label: 'All Time',
  start: null,
  end: null
};

describe('ActivityDashboard totals view', () => {
  it('renders All Time as the selected cumulative range and hides empty cards', () => {
    const markup = renderToStaticMarkup(
      <TotalsView
        loading={false}
        onInspect={vi.fn()}
        onRangeChange={vi.fn()}
        range={allTimeRange}
        rangeId="all"
        tallies={[]}
      />
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Your complete authorized activity history');
    expect(markup).toContain('No qualifying activities or Moments were recorded for all time.');
    expect(markup).not.toContain('cycle-total-grid');
  });

  it('shows valid timed totals and zero-duration Moments without inventing time', () => {
    const markup = renderToStaticMarkup(
      <TotalsView
        loading={false}
        onInspect={vi.fn()}
        onRangeChange={vi.fn()}
        range={allTimeRange}
        rangeId="all"
        tallies={[
          {
            label: 'Work', detailLabel: 'Work', timed: true, totalSeconds: 28800,
            sessionCount: 1, entryCount: 0, dayCount: 1, averageSeconds: 28800,
            incompleteCount: 0, activeCount: 0, firstDateId: '2026-08-10', latestDateId: '2026-08-10',
            color: '#4f8cff', icon: 'work'
          },
          {
            label: 'Spotify', detailLabel: 'Spotify', timed: false, totalSeconds: 0,
            sessionCount: 0, entryCount: 3, dayCount: 2, averageSeconds: 0,
            incompleteCount: 0, activeCount: 0, firstDateId: '2026-08-10', latestDateId: '2026-08-11',
            color: '#db75a6', icon: 'music'
          }
        ]}
      />
    );

    expect(markup).toContain('8h');
    expect(markup).toContain('Valid sessions');
    expect(markup).toContain('3 entries');
    expect(markup).toContain('Recorded as Moments · no duration added');
    expect(markup).not.toContain('0m');
  });
});

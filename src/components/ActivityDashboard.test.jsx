import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityEntryDialog, TotalsView, buildDeleteRequest, buildLocationPatch } from './ActivityDashboard.jsx';

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

describe('Activity entry management', () => {
  const entry = {
    eventId: 'canonical-1',
    label: 'Leave Home',
    dateLabel: 'Monday, August 31, 2026',
    event: {
      id: 'canonical-1', eventType: 'leave_home', activityFamily: 'Home', title: 'Leave Home',
      occurredAt: new Date('2026-08-31T14:00:00Z'), startAt: new Date('2026-08-31T14:00:00Z'),
      endAt: null, durationSeconds: null, metadata: { source: 'shortcut', workoutDetails: { sets: 2 } }
    }
  };

  it('prepopulates active entries and provides the full edit surface', () => {
    const markup = renderToStaticMarkup(<ActivityEntryDialog entry={entry} onCancel={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
    expect(markup).toContain('Activity/category');
    expect(markup).toContain('Start date and time');
    expect(markup).toContain('End date and time');
    expect(markup).toContain('Workout details');
    expect(markup).toContain('Leave Home');
  });

  it('requires explicit delete confirmation and identifies the entry', () => {
    const markup = renderToStaticMarkup(<ActivityEntryDialog entry={{ ...entry, confirmDelete: true }} onCancel={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
    expect(markup).toContain('Delete this activity?');
    expect(markup).toContain('timeline and all activity totals');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('Leave Home');
  });
});

describe('buildLocationPatch', () => {
  it('leaves the location out when it is unchanged, including an empty box on an entry with no location', () => {
    expect(buildLocationPatch(undefined, '')).toBeUndefined();
    expect(buildLocationPatch(null, '')).toBeUndefined();
    expect(buildLocationPatch({ label: 'Home' }, 'Home')).toBeUndefined();
    expect(buildLocationPatch({ label: 'Home' }, '  Home  ')).toBeUndefined();
    expect(buildLocationPatch({ latitude: 43.7, longitude: -79.4 }, '')).toBeUndefined();
  });

  it('sets the label while keeping the stored coordinates', () => {
    expect(buildLocationPatch({ latitude: 43.7, longitude: -79.4 }, 'Gym'))
      .toEqual({ latitude: 43.7, longitude: -79.4, label: 'Gym' });
    expect(buildLocationPatch(undefined, 'Gym')).toEqual({ label: 'Gym' });
  });

  it('clears a location whose label was erased, keeping any coordinates', () => {
    expect(buildLocationPatch({ label: 'Home' }, '')).toBeNull();
    expect(buildLocationPatch({ label: 'Home', latitude: 43.7, longitude: -79.4 }, ''))
      .toEqual({ latitude: 43.7, longitude: -79.4 });
  });
});

describe('buildDeleteRequest', () => {
  it('includes the departure event for a paired session', () => {
    expect(buildDeleteRequest('cal-1', { eventId: 'arrive-1', linkedEventId: 'leave-1' }))
      .toEqual({ calendarId: 'cal-1', eventId: 'arrive-1', linkedEventId: 'leave-1' });
  });

  it('omits the key entirely for an unpaired entry, since undefined is encoded as null', () => {
    for (const linkedEventId of ['', undefined, null]) {
      const request = buildDeleteRequest('cal-1', { eventId: 'moment-1', linkedEventId });
      expect(request).toEqual({ calendarId: 'cal-1', eventId: 'moment-1' });
      expect(Object.keys(request)).not.toContain('linkedEventId');
    }
  });
});

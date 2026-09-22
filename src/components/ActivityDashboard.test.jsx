import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getCategoryDefinition } from '../utils/lifeEventUtils.js';
import { ActivityEntryDialog, LifeWheel, TotalsView, buildDeleteRequest, buildLocationPatch } from './ActivityDashboard.jsx';

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

describe('LifeWheel', () => {
  const H = 3600;
  const categories = [['Home', 57 * H], ['Work', 45 * H], ['Sleep', 44 * H], ['Places', 11 * 60]]
    .map(([label, seconds]) => ({ ...getCategoryDefinition(label), label, seconds, sessions: [] }));
  const analysis = { categories, timedSeconds: categories.reduce((total, category) => total + category.seconds, 0), activeCount: 0 };
  const render = (props = {}) => renderToStaticMarkup(
    <LifeWheel analysis={analysis} categoryAnalysis={null} now={new Date('2026-09-19T12:00:00Z')} onSelect={vi.fn()} period="week" pointAnalysis={null} selectedLabel={null} title="Last week" {...props} />
  );

  it('draws one rounded path per category in that category\'s colour, and no dashed circles', () => {
    const markup = render();
    expect(markup.match(/<path /g)).toHaveLength(categories.length);
    expect(markup).not.toContain('<circle');
    expect(markup).not.toContain('stroke-dasharray');
    categories.forEach((category) => expect(markup).toContain(`fill="${category.color}"`));
    expect(markup).not.toMatch(/NaN|undefined/);
  });

  it('keeps an 11 minute slice visible next to a 57 hour one', () => {
    const markup = render();
    const places = markup.match(/<path[^>]*aria-label="Places, 11m"[^>]*>/)[0];
    expect(places).toMatch(/ d="M [\d.]+ [\d.]+ L/);
  });

  it('prints the icon on every slice and the duration where it fits', () => {
    const markup = render();
    const labels = markup.match(/<div class="life-wheel-labels"[\s\S]*?<\/div>/)[0];
    expect(labels.match(/<button/g)).toHaveLength(categories.length);
    expect(labels).toContain('57h');
    expect(labels).toContain('45h');
    expect(labels).not.toContain('11m');
  });

  it('does not repeat the category names on the ring, since the legend has them', () => {
    const labels = render().match(/<div class="life-wheel-labels"[\s\S]*?<\/div>/)[0];
    expect(labels).not.toContain('Home');
    expect(labels).not.toContain('Work');
  });

  it('fades the other slices and shows the selected activity in the centre', () => {
    const work = { ...categories[1], sessionCount: 3, totalSeconds: categories[1].seconds, sessions: [], activeSession: null };
    const markup = render({ categoryAnalysis: work, selectedLabel: 'Work' });
    expect(markup.match(/life-wheel-segment faded/g)).toHaveLength(categories.length - 1);
    expect(markup).toContain('life-wheel-segment  selected');
    expect(markup).toContain('<h2>Work</h2>');
  });

  it('shows total tracked time in the centre when nothing is selected', () => {
    expect(render()).toContain('tracked time');
  });

  it('shows that one session\'s own start/end time in the centre on a day with a single session', () => {
    const session = { startAt: new Date('2026-09-19T07:04:00Z'), endAt: new Date('2026-09-19T12:19:00Z'), durationSeconds: 5 * H + 15 * 60, active: false };
    const work = { ...categories[1], sessionCount: 1, totalSeconds: session.durationSeconds, sessions: [session], activeSession: null };
    const markup = render({ categoryAnalysis: work, period: 'day', selectedLabel: 'Work' });
    expect(markup).toContain('5h 15m');
    expect(markup).not.toContain('1 sessions');
    expect(markup).not.toContain('2 sessions');
  });

  it('shows the session count and the full total, not just the first session\'s window, on a day with two sessions in the same category', () => {
    // e.g. arrived at 7:04, left for lunch at 12:19, came back at 1:53, left at 6:23: two Work sessions that day.
    const morning = { startAt: new Date('2026-09-19T07:04:00Z'), endAt: new Date('2026-09-19T12:19:00Z'), durationSeconds: 5 * H + 15 * 60, active: false };
    const afternoon = { startAt: new Date('2026-09-19T13:53:00Z'), endAt: new Date('2026-09-19T18:23:00Z'), durationSeconds: 4 * H + 30 * 60, active: false };
    const totalSeconds = morning.durationSeconds + afternoon.durationSeconds;
    const work = { ...categories[1], sessionCount: 2, totalSeconds, sessions: [morning, afternoon], activeSession: null };
    const markup = render({ categoryAnalysis: work, period: 'day', selectedLabel: 'Work' });
    expect(markup).toContain('2 sessions');
    expect(markup).toContain('9h 45m');
    // must not show the first session's own 5h15m window as if it were the whole day
    expect(markup).not.toContain('5h 15m');
    expect(markup).not.toMatch(/7:04.*12:19/);
  });

  it('still centres on the live session when one is in progress, even with earlier sessions the same day', () => {
    const morning = { startAt: new Date('2026-09-19T07:04:00Z'), endAt: new Date('2026-09-19T12:19:00Z'), durationSeconds: 5 * H + 15 * 60, active: false };
    const live = { startAt: new Date('2026-09-19T13:53:00Z'), endAt: null, durationSeconds: null, active: true };
    const work = { ...categories[1], sessionCount: 2, totalSeconds: morning.durationSeconds, sessions: [morning, live], activeSession: live };
    const markup = render({ categoryAnalysis: work, period: 'day', selectedLabel: 'Work' });
    expect(markup).toContain('In progress');
  });

  it('renders without React warnings, such as an array of children inside a tooltip title', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

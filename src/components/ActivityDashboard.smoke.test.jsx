// Renders the whole Activity dashboard (not just the wheel) with the Firestore hooks replaced, so a
// broken prop or an undefined reference in the wheel view shows up before a deploy.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const base = { sourceApp: 'gridlineai', timeLeftUserId: 'u1', eventClass: 'activity_boundary', location: null };
const events = [
  { ...base, id: 'd1-start', sourceRecordId: 'd1-start', eventType: 'start_drive', occurredAt: '2026-11-03T12:40:00Z' },
  { ...base, id: 'd1-finish', sourceRecordId: 'd1-finish', eventType: 'finish_drive', occurredAt: '2026-11-03T13:10:00Z' },
  {
    id: 'night', sourceRecordId: 'night', sourceApp: 'gridlineai', eventType: 'sleep_session', eventClass: 'activity_boundary', activityFamily: 'sleep', categoryId: 'sleep',
    title: 'Slept', occurredAt: '2026-11-03T03:51:00Z', startAt: '2026-11-03T03:51:00Z', endAt: '2026-11-03T11:30:00Z', metrics: { totalSleepHours: 7.65 }
  },
  {
    id: 'darts', sourceRecordId: 'sessions/s1', sourceApp: 'DartstRacker2026', eventType: 'darts_practice', activityFamily: 'darts', categoryId: 'dartsRecord',
    eventClass: 'completed_activity', title: 'Darts practice', startAt: '2026-11-03T23:00:00Z', endAt: '2026-11-03T23:40:00Z', durationSeconds: 2400, occurredAt: '2026-11-03T23:00:00Z'
  }
];
let lifeEvents = events;

vi.mock('../hooks/useCalendar.js', () => ({
  useLifeEvents: () => ({ lifeEvents, loading: false, error: '' }),
  useAllLifeEvents: () => ({ lifeEvents: [], loading: false, error: '' }),
  useConnectedSources: () => ({ connections: [{ status: 'active' }], loading: false, error: '' }),
  useActivityJournalDetails: () => ({ details: {}, media: [], unavailable: false, partial: false, loading: false, error: '' }),
  saveActivityTargets: vi.fn()
}));

const { default: ActivityDashboard } = await import('./ActivityDashboard.jsx');
const calendar = { id: 'cal-1', ownerUid: 'u1', activityTargets: { Sleep: { minSeconds: 7 * 3600 }, Work: { maxSeconds: 9 * 3600 } } };

describe('ActivityDashboard (whole view, hooks replaced)', () => {
  it('renders today with the wheel, tools, legend, facts area, timeline and tracking status', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T22:00:00Z'));
    try {
      const markup = renderToStaticMarkup(<ActivityDashboard active calendar={calendar} onBack={vi.fn()} />);
      expect(markup).toContain('data-testid="life-wheel"');
      expect(markup).toContain('class="cycle-wheel-tools"');
      expect(markup).toContain('>Clock</button>');
      expect(markup).toContain('>Save as image</button>');
      expect(markup).toContain('class="cycle-tool-toggle selected" aria-pressed="true">Untracked time</button>');
      expect(markup).toContain('aria-label="Untracked time, 15h 11m"');
      expect(markup).toContain('class="life-wheel-targets"');
      expect(markup).toContain('Sleep');
      expect(markup).toContain('Transportation');
      expect(markup).toContain('Darts');
      expect(markup).toContain('What happened');
      expect(markup).toContain('Tracking status');
      expect(markup).not.toMatch(/NaN|undefined/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders an empty day without a wheel, and never throws', () => {
    lifeEvents = [];
    try {
      const markup = renderToStaticMarkup(<ActivityDashboard active calendar={{ id: 'cal-1', ownerUid: 'u1' }} onBack={vi.fn()} />);
      expect(markup).toContain('No timed activity');
      expect(markup).toContain('class="cycle-wheel-tools"');
      expect(markup).not.toMatch(/NaN|undefined/);
    } finally {
      lifeEvents = events;
    }
  });
});

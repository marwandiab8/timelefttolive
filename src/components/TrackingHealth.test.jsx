import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildPeriodAnalysis, getPeriodBounds } from '../utils/lifeEventUtils.js';
import { NeedsAttention, defaultTimes, entryForSession } from './TrackingHealth.jsx';

describe('NeedsAttention', () => {
  const bounds = getPeriodBounds('week', '2026-11-16');
  const now = new Date('2026-11-26T17:00:00Z');
  const drive = { id: 'd', sourceRecordId: 'd', sourceApp: 'gridlineai', eventClass: 'activity_boundary', location: null, eventType: 'start_drive', occurredAt: '2026-11-17T23:40:00Z' };
  const analysis = buildPeriodAnalysis([drive], bounds, { now });

  it('lists each gap with what can be done about it', () => {
    const html = renderToStaticMarkup(<NeedsAttention analysis={analysis} bounds={bounds} now={now} onOpenDay={() => {}} onEditSession={() => {}} onAdd={() => {}} />);
    expect(html).toContain('Needs attention');
    expect(html).toContain('Fix the times');
    expect(html).toContain('Add what&#x27;s missing');
    expect(html).toContain('This is fine');
    expect((html.match(/<li/g) || []).length).toBe(8); // the drive, and the seven days of a week with nothing else tracked
  });

  it('says nothing when there is nothing to fix', () => {
    expect(renderToStaticMarkup(<NeedsAttention analysis={buildPeriodAnalysis([], getPeriodBounds('day', '2026-11-26'), { now })} bounds={getPeriodBounds('day', '2026-11-26')} now={now} />)).toBe('');
  });

  it('hands the edit dialog the event that has only one end', () => {
    const session = analysis.sessions.find((item) => item.kind === 'incomplete');
    expect(entryForSession(session)).toMatchObject({ eventId: 'd', linkedEventId: null, event: { id: 'd' } });
  });
});

describe('defaultTimes', () => {
  it('opens on an hour of the day asked for, or on the last hour', () => {
    expect(defaultTimes('2026-11-22')).toEqual({ startAt: '2026-11-22T09:00', endAt: '2026-11-22T10:00' });
    const { startAt, endAt } = defaultTimes('', new Date(2026, 10, 26, 14, 37, 12));
    expect([startAt, endAt]).toEqual(['2026-11-26T13:37', '2026-11-26T14:37']);
  });
});

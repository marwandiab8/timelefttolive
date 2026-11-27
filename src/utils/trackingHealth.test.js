import { describe, expect, it } from 'vitest';
import { buildPeriodAnalysis, getPeriodBounds } from './lifeEventUtils.js';
import { buildTrackingIssues, openIssues } from './trackingHealth.js';

const night = (id, startAt, endAt, hours) => ({
  id, sourceRecordId: id, sourceApp: 'gridlineai', eventType: 'sleep_session', eventClass: 'activity_boundary', activityFamily: 'sleep', categoryId: 'sleep',
  title: 'Slept', occurredAt: startAt, startAt, endAt, metrics: { totalSleepHours: hours }
});
const visit = (id, activity, start, end) => {
  const base = { sourceApp: 'gridlineai', eventClass: 'location', activityFamily: 'location', categoryId: 'other_location', title: activity, location: { label: activity }, metadata: { placeActivity: activity } };
  return [
    { ...base, id: `${id}-in`, sourceRecordId: `${id}-in`, eventType: 'arrive_location', occurredAt: start },
    ...(end ? [{ ...base, id: `${id}-out`, sourceRecordId: `${id}-out`, eventType: 'leave_location', occurredAt: end, startAt: start, endAt: end }] : [])
  ];
};

describe('buildTrackingIssues', () => {
  // The week of Mon Nov 23 to Sun Nov 29, 2026, looked at on Thu Nov 26 at noon.
  const bounds = getPeriodBounds('week', '2026-11-23');
  const now = new Date('2026-11-26T17:00:00Z');
  const events = [
    night('mon', '2026-11-23T04:00:00Z', '2026-11-23T11:00:00Z', 7),
    ...visit('work-mon', 'work', '2026-11-23T13:00:00Z', '2026-11-23T22:00:00Z'),
    // Monday's arrival home has nothing after it, long enough ago to be incomplete rather than in progress.
    { id: 'home-mon', sourceRecordId: 'home-mon', sourceApp: 'gridlineai', eventClass: 'activity_boundary', location: null, eventType: 'arrive_home', occurredAt: '2026-11-23T22:30:00Z' },
    // Tuesday's night arrived three times.
    night('tue-a', '2026-11-24T02:04:00Z', '2026-11-24T07:45:00Z', 5.68),
    night('tue-b', '2026-11-24T04:53:00Z', '2026-11-24T07:56:00Z', 2.12),
    night('tue-c', '2026-11-24T06:34:00Z', '2026-11-24T07:56:00Z', 1.3),
    ...visit('work-tue', 'work', '2026-11-24T13:00:00Z', '2026-11-24T22:00:00Z')
    // Wednesday: nothing tracked at all.
  ];
  const analysis = buildPeriodAnalysis(events, bounds, { now });
  const same = (dateId) => dateId;

  it('lists the missing finish, the repeated night and the thinly tracked days, newest first', () => {
    const issues = buildTrackingIssues({ analysis, bounds, now, dayText: same });
    expect(issues.map((issue) => [issue.kind, issue.dateId])).toEqual([
      ['low-coverage', '2026-11-25'],
      ['repeated-sleep', '2026-11-24'],
      ['missing-finish', '2026-11-23']
    ]);
    expect(issues[0]).toMatchObject({ action: 'add', text: '2026-11-25: 0% of the day tracked' });
    expect(issues[1].text).toBe('The night ending 2026-11-24 arrived 3 times; it counts once, as the report with the most sleep.');
    expect(issues[2]).toMatchObject({ action: 'edit' });
    expect(issues[2].text).toMatch(/^Home/);
  });

  it('never calls today or the days still to come thinly tracked, and drops what was dismissed', () => {
    const issues = buildTrackingIssues({ analysis, bounds, now, dayText: same });
    expect(issues.some((issue) => issue.dateId >= '2026-11-26' && issue.kind === 'low-coverage')).toBe(false);
    expect(openIssues(issues, ['low-coverage:2026-11-23']).map((issue) => issue.key)).not.toContain('low-coverage:2026-11-23');
    expect(buildTrackingIssues({ analysis: null })).toEqual([]);
  });
});

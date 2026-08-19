import { describe, expect, it } from 'vitest';
import {
  APP_TIMEZONE,
  applyActivityEventPrecedence,
  buildCategoryAnalysis,
  buildActivitySessions,
  buildActivityEntries,
  buildActivityTallies,
  buildComparison,
  buildJournalEntries,
  buildJournalMetrics,
  buildPeriodAnalysis,
  buildPointCategoryAnalysis,
  buildWorkAttendance,
  buildWorkoutRecords,
  deriveJournalTitle,
  enrichLifeEventsWithJournalDetails,
  filterLifeEventsByRange,
  formatDuration,
  getActivityTallyRange,
  getDateIdInTimezone,
  getLocationLabel,
  getIncompleteSessionMessage,
  getMeaningfulEventDetails,
  getPeriodBounds,
  getTallyActivityLabel,
  groupMoments,
  groupPhotosByDate,
  isPointEvent,
  shiftPeriodDate,
  selectActivityPreviewEntries,
  toJsDate,
  toggleActivitySelection
} from './lifeEventUtils.js';

describe('activity analysis utilities', () => {
  it('normalizes Firestore timestamps safely', () => {
    expect(toJsDate({ seconds: 1_700_000_000, nanoseconds: 0 }).toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(toJsDate({ toDate: () => new Date('2026-08-11T10:00:00Z') }).toISOString()).toBe('2026-08-11T10:00:00.000Z');
    expect(toJsDate('not-a-date')).toBeNull();
  });

  it('uses Toronto period boundaries across winter, summer, and DST', () => {
    expect(getPeriodBounds('day', '2026-01-15').start.toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(getPeriodBounds('day', '2026-08-11').start.toISOString()).toBe('2026-08-11T04:00:00.000Z');
    expect(getPeriodBounds('day', '2026-03-08').start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(getPeriodBounds('day', '2026-03-08').end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(getPeriodBounds('day', '2026-11-01').start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(getPeriodBounds('day', '2026-11-01').end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(getDateIdInTimezone(new Date('2026-08-12T03:59:59Z'))).toBe('2026-08-11');
  });

  it('creates Day, Monday Week, Month, and Year periods and navigates each', () => {
    expect(getPeriodBounds('day', '2026-08-12')).toMatchObject({ startDateId: '2026-08-12', endDateId: '2026-08-12' });
    expect(getPeriodBounds('week', '2026-08-12')).toMatchObject({ startDateId: '2026-08-10', endDateId: '2026-08-16' });
    expect(getPeriodBounds('month', '2026-08-12')).toMatchObject({ startDateId: '2026-08-01', endDateId: '2026-08-31' });
    expect(getPeriodBounds('year', '2026-08-12')).toMatchObject({ startDateId: '2026-01-01', endDateId: '2026-12-31' });
    expect(shiftPeriodDate('2026-08-12', 'day', -1)).toBe('2026-08-11');
    expect(shiftPeriodDate('2026-08-12', 'week', -1)).toBe('2026-08-03');
    expect(shiftPeriodDate('2026-08-12', 'month', 1)).toBe('2026-09-01');
    expect(shiftPeriodDate('2026-08-12', 'year', -1)).toBe('2025-01-01');
    expect(APP_TIMEZONE).toBe('America/Toronto');
  });

  it('pairs boundaries by activity and location and preserves unrelated starts', () => {
    const bounds = getPeriodBounds('day', '2026-08-11');
    const sessions = buildActivitySessions([
      { id: 'arrive', eventType: 'arrive_gym', activityFamily: 'gym', occurredAt: '2026-08-11T13:00:00Z', location: { label: 'Gym A' } },
      { id: 'unrelated', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-11T13:30:00Z', location: { label: 'Gym B' } },
      { id: 'leave', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-11T14:30:00Z', location: { label: 'Gym A' } }
    ], bounds);
    expect(sessions.some((session) => session.kind === 'paired' && session.durationSeconds === 5400)).toBe(true);
  });

  it.each([
    ['Work', 'start_work', 'work'],
    ['Gym/Fitness', 'arrive_gym', 'gym'],
    ['Home', 'arrive_home', 'home']
  ])('includes an active %s session through the current Toronto time', (category, eventType, activityFamily) => {
    const bounds = getPeriodBounds('day', '2026-08-17');
    const analysis = buildPeriodAnalysis([
      { id: `active-${activityFamily}`, eventType, activityFamily, occurredAt: '2026-08-17T10:57:00Z' }
    ], bounds, { includeActive: true, now: new Date('2026-08-17T16:00:00Z') });
    expect(analysis.activeCount).toBe(1);
    expect(analysis.moments).toHaveLength(0);
    expect(analysis.categories[0]).toMatchObject({ label: category, seconds: 18180 });
    expect(analysis.timedSeconds).toBe(18180);
    expect(analysis.sessions[0]).toMatchObject({ kind: 'active', active: true, durationSeconds: 18180 });
  });

  it('keeps a historical unmatched start incomplete without inventing duration', () => {
    const bounds = getPeriodBounds('day', '2026-08-11');
    const analysis = buildPeriodAnalysis([
      { id: 'old-start', eventType: 'start_work', activityFamily: 'work', occurredAt: '2026-08-11T10:57:00Z' }
    ], bounds, { includeActive: true, now: new Date('2026-08-17T16:00:00Z') });
    expect(analysis.timedSeconds).toBe(0);
    expect(analysis.activeCount).toBe(0);
    expect(analysis.incompleteCount).toBe(1);
    expect(analysis.sessions[0]).toMatchObject({ kind: 'incomplete', endAt: null, durationSeconds: null });
  });

  it('keeps only the latest valid unmatched boundary active and treats Spotify starts as moments', () => {
    const bounds = getPeriodBounds('day', '2026-08-17');
    const analysis = buildPeriodAnalysis([
      { id: 'work-old', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-17T09:00:00Z' },
      { id: 'work-current', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-17T10:57:00Z' },
      { id: 'track-1', eventType: 'start_spotify', activityFamily: 'spotify', occurredAt: '2026-08-17T11:00:00Z' },
      { id: 'track-2', eventType: 'start_spotify', activityFamily: 'spotify', occurredAt: '2026-08-17T11:04:00Z' }
    ], bounds, { includeActive: true, now: new Date('2026-08-17T16:00:00Z') });
    expect(analysis.activeCount).toBe(1);
    expect(analysis.incompleteCount).toBe(1);
    expect(analysis.categories).toHaveLength(1);
    expect(analysis.categories[0]).toMatchObject({ label: 'Work', seconds: 18180 });
    expect(analysis.moments).toHaveLength(2);
    expect(analysis.momentGroups).toHaveLength(2);
    expect(analysis.momentGroups.every((group) => group.category === 'Music' && group.count === 1)).toBe(true);
    expect(analysis.pointCategories[0]).toMatchObject({ label: 'Spotify', count: 2, seconds: 0 });
  });

  it('treats a generic CarPlay destination as a point moment that supersedes an unmatched Gym start', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'gym-in', eventType: 'arrive_gym', eventClass: 'activity_boundary', activityFamily: 'gym', occurredAt: '2026-08-19T09:00:00Z' },
      { id: 'coffee', eventType: 'arrive_location', eventClass: 'location', activityFamily: 'location', occurredAt: '2026-08-19T10:00:00Z', location: { label: 'Coffee shop' } }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T12:00:00Z') });

    const gym = analysis.sessions.find((session) => session.category === 'Gym/Fitness');
    expect(analysis.activeCount).toBe(0);
    expect(analysis.timedSeconds).toBe(0);
    expect(gym).toMatchObject({
      kind: 'incomplete', active: false, endAt: null, durationSeconds: null,
      incompleteReason: 'superseded_by_arrival', supersededByLocation: 'Coffee shop'
    });
    expect(getIncompleteSessionMessage(gym)).toBe('Departure was not recorded. A later arrival at Coffee shop confirms this visit ended.');
    expect(analysis.pointCategories.find((category) => category.label === 'Places')).toMatchObject({ count: 1, seconds: 0 });
    expect(analysis.activityEntries.some((entry) => entry.title === 'Arrived at Coffee shop')).toBe(true);
  });

  it('associates a near matching CarPlay Gym arrival with the authoritative specific boundary', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'gym-specific', eventType: 'arrive_gym', eventClass: 'activity_boundary', activityFamily: 'gym', occurredAt: '2026-08-19T09:00:00Z' },
      { id: 'gym-carplay', eventType: 'arrive_location', eventClass: 'location', activityFamily: 'location', occurredAt: '2026-08-19T09:04:00Z', location: { label: 'GoodLife Fitness' } }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T11:00:00Z') });

    expect(analysis.suppressedEvents).toHaveLength(1);
    expect(analysis.suppressedEvents[0].reason).toBe('associated_with_specific_arrival');
    expect(analysis.sessions).toHaveLength(1);
    expect(analysis.sessions[0]).toMatchObject({ category: 'Gym/Fitness', active: true, location: 'GoodLife Fitness' });
    expect(analysis.activityEntries).toHaveLength(1);
    expect(analysis.activityEntries[0].title).toBe('Arrived at GoodLife Fitness');
    expect(analysis.pointCategories.some((category) => category.label === 'Places')).toBe(false);
  });

  it('deduplicates a specific Home arrival and a near generic Home destination', () => {
    const resolution = applyActivityEventPrecedence([
      { id: 'home-specific', eventType: 'arrive_home', activityFamily: 'home', occurredAt: '2026-08-19T21:00:00Z' },
      { id: 'home-carplay', eventType: 'arrive_location', activityFamily: 'location', occurredAt: '2026-08-19T21:02:00Z', location: { label: ' Home ' } }
    ]);
    expect(resolution.events).toHaveLength(1);
    expect(resolution.events[0]).toMatchObject({
      id: 'home-specific',
      eventType: 'arrive_home',
      _activityPrecedence: { associatedLocation: 'Home' }
    });
    expect(resolution.suppressed[0].reason).toBe('associated_with_specific_arrival');
  });

  it('keeps a valid specific Gym departure paired after associating a duplicate CarPlay arrival', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'gym-specific', eventType: 'arrive_gym', activityFamily: 'gym', occurredAt: '2026-08-19T09:00:00Z' },
      { id: 'gym-carplay', eventType: 'arrive_location', activityFamily: 'location', occurredAt: '2026-08-19T09:04:00Z', location: { label: 'GoodLife Fitness' } },
      { id: 'gym-out', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-19T10:00:00Z' }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T12:00:00Z') });

    expect(analysis.suppressedEvents).toHaveLength(1);
    expect(analysis.sessions).toHaveLength(1);
    expect(analysis.sessions[0]).toMatchObject({
      kind: 'paired', active: false, durationSeconds: 3600, location: 'GoodLife Fitness'
    });
    expect(analysis.activityEntries.filter((entry) => entry.title.startsWith('Arrived'))).toHaveLength(1);
    expect(analysis.pointCategories.some((category) => category.label === 'Places')).toBe(false);
  });

  it('marks Gym incomplete when a later specific Work arrival proves the visit ended', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'gym-in', eventType: 'arrive_gym', activityFamily: 'gym', occurredAt: '2026-08-19T09:00:00Z' },
      { id: 'work-in', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-19T11:00:00Z', location: { label: 'Docksteader' } }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T13:00:00Z') });
    const gym = analysis.sessions.find((session) => session.category === 'Gym/Fitness');
    const work = analysis.sessions.find((session) => session.category === 'Work');
    expect(gym).toMatchObject({ active: false, durationSeconds: null, supersededByLocation: 'Docksteader' });
    expect(work).toMatchObject({ active: true, durationSeconds: 7200 });
    expect(analysis.timedSeconds).toBe(7200);
  });

  it('keeps an explicit Left Gym boundary authoritative even when a generic arrival occurs first', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'gym-in', eventType: 'arrive_gym', activityFamily: 'gym', occurredAt: '2026-08-19T09:00:00Z' },
      { id: 'coffee', eventType: 'arrive_location', activityFamily: 'location', occurredAt: '2026-08-19T09:30:00Z', location: { label: 'Coffee shop' } },
      { id: 'gym-out', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-19T10:00:00Z' }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T12:00:00Z') });
    expect(analysis.sessions.find((session) => session.category === 'Gym/Fitness')).toMatchObject({
      kind: 'paired', active: false, durationSeconds: 3600
    });
    expect(analysis.timedSeconds).toBe(3600);
    expect(analysis.activityEntries.some((entry) => entry.title === 'Arrived at Coffee shop')).toBe(true);
  });

  it('keeps unknown CarPlay destinations visible without adding duration', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'unknown-place', eventType: 'arrive_location', eventClass: 'location', activityFamily: 'location', occurredAt: '2026-08-19T14:30:00Z', location: { label: 'Community garden' } }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T15:00:00Z') });
    expect(analysis.sessions).toHaveLength(0);
    expect(analysis.timedSeconds).toBe(0);
    expect(analysis.activityEntries[0]).toMatchObject({ pointCategory: 'Places', title: 'Arrived at Community garden' });
  });

  it('suppresses historical empty generic destinations and never promotes them to sessions', () => {
    const analysis = buildPeriodAnalysis([
      { id: 'empty-place', eventType: 'arrive_location', eventClass: 'location', occurredAt: '2026-08-19T14:30:00Z', location: { label: '   ' } }
    ], getPeriodBounds('day', '2026-08-19'), { includeActive: true, now: new Date('2026-08-19T15:00:00Z') });
    expect(analysis.events).toHaveLength(0);
    expect(analysis.sessions).toHaveLength(0);
    expect(analysis.activityEntries).toHaveLength(0);
    expect(analysis.suppressedEvents[0].reason).toBe('empty_generic_location');
  });

  it('clips sessions crossing midnight to the selected period', () => {
    const sessions = buildActivitySessions([
      { id: 'sleep', activityFamily: 'sleep', startAt: '2026-08-11T03:00:00Z', endAt: '2026-08-11T07:00:00Z' }
    ], getPeriodBounds('day', '2026-08-11'));
    expect(sessions[0].durationSeconds).toBe(10800);
  });

  it('excludes point events and prevents nested gym/workout double counting', () => {
    const events = [
      { id: 'gym', activityFamily: 'gym', startAt: '2026-08-11T12:00:00Z', endAt: '2026-08-11T14:00:00Z' },
      { id: 'workout', activityFamily: 'workout', startAt: '2026-08-11T12:30:00Z', endAt: '2026-08-11T13:30:00Z', title: 'Chest workout' },
      { id: 'journal', eventType: 'journal', occurredAt: '2026-08-11T15:00:00Z' }
    ];
    expect(isPointEvent(events[2])).toBe(true);
    const analysis = buildPeriodAnalysis(events, getPeriodBounds('day', '2026-08-11'));
    expect(analysis.moments).toHaveLength(1);
    expect(analysis.timedSeconds).toBe(7200);
    expect(analysis.categories[0].label).toBe('Gym/Fitness');
    expect(analysis.categories[0].nestedSessions).toHaveLength(1);
  });

  it('deduplicates repeated canonical identities', () => {
    const event = { id: 'same', activityFamily: 'work', startAt: '2026-08-11T13:00:00Z', endAt: '2026-08-11T14:00:00Z' };
    expect(buildActivitySessions([event, event], getPeriodBounds('day', '2026-08-11'))).toHaveLength(1);
  });

  it.each([
    ['Projectreport', 'Work Reports'],
    ['Progressrecord', 'Work Reports'],
    ['Darterrecord', 'Work Reports'],
    ['Constructionreport', 'Work Reports'],
    ['Image', 'Attachments'],
    ['File', 'Attachments'],
    ['DartsRecord', 'Achievements'],
    ['journal_entry', 'Notes'],
    ['43.7412,-79.7624', 'Places']
  ])('normalizes raw %s records to %s', (raw, expected) => {
    expect(getTallyActivityLabel({ activityFamily: raw })).toBe(expected);
  });

  it('normalizes aliases and case variants while retaining future meaningful categories', () => {
    expect(getTallyActivityLabel({ eventType: 'COMPLETED_WORKOUT' })).toBe('Gym/Fitness');
    expect(getTallyActivityLabel({ eventType: 'arrive_work' })).toBe('Work');
    expect(getTallyActivityLabel({ activityFamily: 'SPOTIFY' })).toBe('Music');
    expect(getTallyActivityLabel({ activityFamily: 'gym_visit', location: { label: 'GoodLife Fitness Orangeville' } })).toBe('Gym/Fitness');
    expect(getTallyActivityLabel({ activityFamily: 'reading' })).toBe('Reading');
    expect(getLocationLabel({ location: { label: '43.7412,-79.7624' } })).toBe('');
    expect(getLocationLabel({ location: { label: 'work' } })).toBe('');
  });

  it('keeps coordinates, attachments, and reports out of primary all-time totals', () => {
    const tallies = buildActivityTallies([
      { id: 'work', activityFamily: 'work', startAt: '2026-08-10T13:00:00Z', endAt: '2026-08-10T21:00:00Z' },
      { id: 'coordinate', activityFamily: '43.7412,-79.7624', occurredAt: '2026-08-10T14:00:00Z' },
      { id: 'report', activityFamily: 'Projectreport', occurredAt: '2026-08-10T15:00:00Z' },
      { id: 'image', activityFamily: 'Image', occurredAt: '2026-08-10T16:00:00Z' }
    ]);
    expect(tallies.map((tally) => tally.label)).toEqual(['Work']);
    expect(tallies[0]).toMatchObject({ totalSeconds: 28800, dayCount: 1, sessionCount: 1 });
  });

  it('builds normalized all-time tallies from overlap-safe sessionization', () => {
    const tallies = buildActivityTallies([
      { id: 'work', activityFamily: 'work', startAt: '2026-08-10T13:00:00Z', endAt: '2026-08-10T21:00:00Z' },
      { id: 'gym', activityFamily: 'gym', startAt: '2026-08-11T12:00:00Z', endAt: '2026-08-11T14:00:00Z' },
      { id: 'workout', activityFamily: 'workout', startAt: '2026-08-11T12:30:00Z', endAt: '2026-08-11T13:30:00Z' },
      { id: 'journal', eventType: 'journal', occurredAt: '2026-08-11T15:00:00Z' }
    ]);
    expect(tallies.find((tally) => tally.label === 'Work')).toMatchObject({ totalSeconds: 28800, dayCount: 1, sessionCount: 1 });
    expect(tallies.find((tally) => tally.label === 'Gym/Fitness')).toMatchObject({ totalSeconds: 7200, dayCount: 1, sessionCount: 1 });
    expect(tallies.some((tally) => tally.label === 'Notes')).toBe(false);
  });

  it('prefers one richer canonical workout over an overlapping generic boundary session', () => {
    const bounds = getPeriodBounds('day', '2026-08-11');
    const analysis = buildPeriodAnalysis([
      { id: 'gym', activityFamily: 'gym', startAt: '2026-08-11T09:04:00Z', endAt: '2026-08-11T10:29:00Z' },
      { id: 'start-workout', eventType: 'start_workout', activityFamily: 'workout', occurredAt: '2026-08-11T09:08:00Z', location: { label: 'Orangeville' } },
      { id: 'finish-workout', eventType: 'finish_workout', activityFamily: 'workout', occurredAt: '2026-08-11T10:10:00Z', location: { label: 'Orangeville' } },
      { id: 'chest', activityFamily: 'workout', title: 'Chest', startAt: '2026-08-11T09:10:00Z', endAt: '2026-08-11T10:09:00Z', metadata: { exerciseSummaries: [{ name: 'redacted' }] } }
    ], bounds);
    const category = analysis.categories.find((item) => item.label === 'Gym/Fitness');
    const categoryAnalysis = buildCategoryAnalysis(category, analysis, buildPeriodAnalysis([], bounds), bounds);
    expect(categoryAnalysis.workoutCount).toBe(1);
    expect(categoryAnalysis.workouts[0].title).toBe('Chest Workout');
    expect(categoryAnalysis.sessions.map((session) => session.title)).toEqual(['Gym visit at Orangeville']);
    expect(categoryAnalysis.locations).toEqual([{ label: 'Orangeville', seconds: 5100, visits: 1 }]);
  });

  it('compares a category with the previous period and a recent active-period normal', () => {
    const currentBounds = getPeriodBounds('week', '2026-08-17');
    const previousBounds = getPeriodBounds('week', '2026-08-10');
    const olderBounds = getPeriodBounds('week', '2026-08-03');
    const event = (id, startAt, hours) => ({ id, activityFamily: 'work', startAt, endAt: new Date(new Date(startAt).getTime() + (hours * 3600 * 1000)).toISOString() });
    const current = buildPeriodAnalysis([event('current', '2026-08-17T13:00:00Z', 8)], currentBounds);
    const previous = buildPeriodAnalysis([event('previous', '2026-08-10T13:00:00Z', 7)], previousBounds);
    const older = buildPeriodAnalysis([event('older', '2026-08-03T13:00:00Z', 9)], olderBounds);
    const category = current.categories.find((item) => item.label === 'Work');
    expect(buildCategoryAnalysis(category, current, previous, currentBounds, [previous, older])).toMatchObject({
      totalSeconds: 28800,
      previousSeconds: 25200,
      deltaSeconds: 3600,
      recentAverageSeconds: 28800,
      recentPeriodCount: 2
    });
  });

  it('groups only genuine duplicate journals and keeps distinct occurrences separate', () => {
    const groups = groupMoments([
      { id: 'journal-copy-a', sourceApp: 'gridlineai', sourceRecordId: 'same-journal', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-11T13:00:00Z' },
      { id: 'journal-copy-b', sourceApp: 'gridlineai', sourceRecordId: 'same-journal', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-11T13:00:00Z' },
      { id: 'journal-distinct', sourceApp: 'gridlineai', sourceRecordId: 'another-journal', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-11T13:10:00Z' }
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ category: 'Notes', pointCategory: 'Journal', title: 'Journal entry', count: 2 });
    expect(groups[1]).toMatchObject({ count: 1 });
  });

  it('enriches journal notes with multiline text and the actual source timestamp', () => {
    const events = enrichLifeEventsWithJournalDetails([{
      id: 'journal-life-event', sourceApp: 'gridlineai', sourceRecordId: 'logEntries/note-1',
      eventType: 'other', activityFamily: 'other', title: 'Journal Entry',
      occurredAt: '2026-08-18T04:00:00Z', startAt: '2026-08-18T16:00:00Z', receivedAt: '2026-08-18T14:00:02Z'
    }], [{
      lifeEventId: 'journal-life-event', kind: 'journal', title: '',
      note: 'Morning site notes\nLevel 3 reinforcing continued.',
      occurredAt: '2026-08-18T12:42:00Z', sourceSentAt: '2026-08-18T12:42:03Z',
      dateId: '2026-08-18', projectId: 'home', mediaIds: ['photo-1']
    }]);
    const entries = buildJournalEntries(events, [{ id: 'photo-1', createdAt: '2026-08-18T12:43:00Z' }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Morning site notes',
      note: 'Morning site notes\nLevel 3 reinforcing continued.',
      timeRecorded: true,
      projectId: 'home',
      mediaIds: ['photo-1']
    });
    expect(entries[0].occurredAt.toISOString()).toBe('2026-08-18T12:42:00.000Z');
    expect(entries[0].sourceSentAt.toISOString()).toBe('2026-08-18T12:42:03.000Z');
    expect(getMeaningfulEventDetails(events[0]).note).toContain('Level 3 reinforcing');
  });

  it('does not display a date-only journal sentinel as noon', () => {
    const [event] = enrichLifeEventsWithJournalDetails([{
      id: 'date-only', sourceRecordId: 'logEntries/date-only', eventType: 'journal', title: 'Journal Entry',
      occurredAt: '2026-08-18T04:00:00Z', startAt: '2026-08-18T16:00:00Z'
    }], [{
      lifeEventId: 'date-only', kind: 'journal', note: 'Date-only note', occurredAt: null,
      sourceSentAt: null, dateId: '2026-08-18', mediaIds: []
    }]);
    const [entry] = buildJournalEntries([event]);
    expect(entry.occurredAt).toBeNull();
    expect(entry.timeRecorded).toBe(false);
    expect(entry.dateId).toBe('2026-08-18');
  });

  it('uses a meaningful journal title fallback while preserving distinct notes', () => {
    expect(deriveJournalTitle('First useful line\nSecond line', 'Journal Entry')).toBe('First useful line');
    const source = [
      { id: 'fragment-a', sourceRecordId: 'logEntries/shared', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-18T12:00:00Z' },
      { id: 'fragment-b', sourceRecordId: 'logEntries/shared', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-18T12:00:01Z' },
      { id: 'distinct', sourceRecordId: 'logEntries/distinct', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-18T13:00:00Z' }
    ];
    const details = [
      { lifeEventId: 'fragment-a', kind: 'journal', note: 'Combined note', occurredAt: '2026-08-18T12:00:00Z', mediaIds: ['p1'] },
      { lifeEventId: 'fragment-b', kind: 'journal', note: '', occurredAt: '2026-08-18T12:00:01Z', mediaIds: ['p2'] },
      { lifeEventId: 'distinct', kind: 'journal', note: 'Different note', occurredAt: '2026-08-18T13:00:00Z', mediaIds: [] }
    ];
    const entries = buildJournalEntries(enrichLifeEventsWithJournalDetails(source, details), [{ id: 'p1' }, { id: 'p2' }]);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.id === 'logEntries/shared').mediaIds).toEqual(['p1', 'p2']);
    expect(entries.map((entry) => entry.note)).toEqual(expect.arrayContaining(['Combined note', 'Different note']));
  });

  it('excludes exact Shortcut shadow journals while keeping genuine notes', () => {
    const events = enrichLifeEventsWithJournalDetails([
      { id: 'shadow', sourceRecordId: 'logEntries/shadow', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-18T12:00:00Z' },
      { id: 'real', sourceRecordId: 'logEntries/real', eventType: 'journal', title: 'Journal Entry', occurredAt: '2026-08-18T13:00:00Z' }
    ], [
      { lifeEventId: 'shadow', kind: 'journal', shortcutShadow: true, note: 'Generated boundary log', occurredAt: '2026-08-18T12:00:00Z' },
      { lifeEventId: 'real', kind: 'journal', shortcutShadow: false, note: 'A real note', occurredAt: '2026-08-18T13:00:00Z' }
    ]);
    const analysis = buildPeriodAnalysis(events, getPeriodBounds('day', '2026-08-18'));
    expect(analysis.activityEntries).toHaveLength(1);
    expect(buildJournalEntries(events).map((entry) => entry.note)).toEqual(['A real note']);
  });

  it('counts journal photos and groups standalone daily images without duplicating them', () => {
    const entries = [{
      id: 'note', occurredAt: new Date('2026-08-18T12:00:00Z'), dateId: '2026-08-18', mediaIds: ['p1', 'p2']
    }];
    expect(buildJournalMetrics(entries)).toMatchObject({ entryCount: 1, entriesWithPhotos: 1, photoCount: 2, activeDays: 1 });
    const groups = groupPhotosByDate([
      { id: 'p1', createdAt: '2026-08-18T12:01:00Z' },
      { id: 'p1', createdAt: '2026-08-18T12:01:00Z' },
      { id: 'standalone', createdAt: '2026-08-19T13:00:00Z' }
    ]);
    expect(groups).toEqual([
      { dateId: '2026-08-19', photos: [{ id: 'standalone', createdAt: '2026-08-19T13:00:00Z' }] },
      { dateId: '2026-08-18', photos: [{ id: 'p1', createdAt: '2026-08-18T12:01:00Z' }] }
    ]);
  });

  it('keeps Spotify visible and selectable without inventing listening time', () => {
    const bounds = getPeriodBounds('day', '2026-08-17');
    const analysis = buildPeriodAnalysis([
      { id: 'spotify-1', sourceRecordId: 'play-1', eventType: 'start_spotify', activityFamily: 'spotify', title: 'Started listening to Spotify', occurredAt: '2026-08-17T08:04:00Z' },
      { id: 'spotify-2', sourceRecordId: 'play-2', eventType: 'start_spotify', activityFamily: 'spotify', title: 'Started listening to Spotify', occurredAt: '2026-08-17T08:22:00Z' },
      { id: 'spotify-3', sourceRecordId: 'play-3', eventType: 'start_spotify', activityFamily: 'spotify', title: 'Started listening to Spotify', occurredAt: '2026-08-17T10:33:00Z' }
    ], bounds);
    const spotify = analysis.pointCategories.find((category) => category.label === 'Spotify');
    const focused = buildPointCategoryAnalysis(spotify);
    expect(analysis.categories).toHaveLength(0);
    expect(analysis.timedSeconds).toBe(0);
    expect(analysis.activityEntries).toHaveLength(3);
    expect(focused).toMatchObject({ count: 3, totalSeconds: 0, reliableDuration: false });
    expect(focused.entries.map((entry) => entry.firstAt.toISOString())).toEqual([
      '2026-08-17T10:33:00.000Z',
      '2026-08-17T08:22:00.000Z',
      '2026-08-17T08:04:00.000Z'
    ]);
  });

  it('keeps every meaningful category represented in the concise activity preview', () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, index) => ({ id: `journal-${index}`, pointCategory: 'Journal' })),
      { id: 'spotify', pointCategory: 'Spotify' },
      { id: 'spotify-2', pointCategory: 'Spotify' },
      { id: 'work', pointCategory: 'Work' }
    ];
    const preview = selectActivityPreviewEntries(entries, 8);
    expect(preview).toHaveLength(4);
    expect(preview.map((entry) => entry.pointCategory)).toEqual(expect.arrayContaining(['Journal', 'Spotify', 'Work']));
    expect(preview.filter((entry) => entry.pointCategory === 'Journal')).toHaveLength(1);
    expect(preview.filter((entry) => entry.pointCategory === 'Spotify')).toHaveLength(2);
  });

  it('exposes real Spotify track, artist, album, playlist, and source-sent details when supplied', () => {
    const event = {
      id: 'spotify-rich',
      sourceApp: 'music-source',
      eventType: 'start_spotify',
      activityFamily: 'spotify',
      occurredAt: '2026-08-17T08:04:00Z',
      metadata: {
        trackName: 'A real track',
        artistName: 'A real artist',
        albumName: 'A real album',
        playlistName: 'Morning mix',
        sentAtIso: '2026-08-17T08:04:02Z'
      }
    };
    expect(getMeaningfulEventDetails(event)).toMatchObject({
      track: 'A real track', artist: 'A real artist', album: 'A real album', playlist: 'Morning mix'
    });
    const [entry] = buildActivityEntries([event]);
    expect(entry.sentAt.toISOString()).toBe('2026-08-17T08:04:02.000Z');
  });

  it('correlates a rich Gym-K2 workout by workout ID and renders one detailed workout record', () => {
    const bounds = getPeriodBounds('day', '2026-08-17');
    const events = [
      { id: 'gym-in', eventType: 'arrive_gym', activityFamily: 'gym', occurredAt: '2026-08-17T09:10:00Z', location: { label: 'GoodLife Fitness Orangeville' } },
      { id: 'workout-in', eventType: 'start_workout', activityFamily: 'workout', occurredAt: '2026-08-17T09:19:00Z', location: { label: 'GoodLife Fitness Orangeville' }, metadata: { workoutId: 'workout-123' } },
      { id: 'legs', sourceApp: 'GYM-K2', eventType: 'workout', eventClass: 'completed_activity', activityFamily: 'workout', title: 'legs', startAt: '2026-08-17T09:20:00Z', occurredAt: '2026-08-17T04:00:00Z', metadata: {
        workoutId: 'workout-123', routineName: 'legs', exerciseCount: 1, allSetCount: 2,
        exerciseSummaries: [{ exerciseId: 'squat', name: 'Hack Squats', sets: [{ weight: '180', reps: '10', rpe: '8' }, { weight: '200', reps: '8', rpe: '9' }] }]
      } },
      { id: 'workout-out', eventType: 'finish_workout', activityFamily: 'workout', occurredAt: '2026-08-17T10:28:00Z', location: { label: 'GoodLife Fitness Orangeville' }, metadata: { workoutId: 'workout-123' } },
      { id: 'gym-out', eventType: 'leave_gym', activityFamily: 'gym', occurredAt: '2026-08-17T10:31:00Z', location: { label: 'GoodLife Fitness Orangeville' } }
    ];
    const analysis = buildPeriodAnalysis(events, bounds);
    const workouts = buildWorkoutRecords(analysis.events, analysis.sessions, APP_TIMEZONE);
    expect(workouts).toHaveLength(1);
    expect(workouts[0]).toMatchObject({
      identity: 'workout-123', title: 'Legs Workout', durationSeconds: 4140,
      exerciseCount: 1, setCount: 2, location: 'GoodLife Fitness Orangeville'
    });
    expect(workouts[0].exercises[0]).toMatchObject({
      name: 'Hack Squats',
      sets: [
        { number: 1, weight: '180', reps: '10', rpe: '8' },
        { number: 2, weight: '200', reps: '8', rpe: '9' }
      ]
    });
    const category = analysis.categories.find((item) => item.label === 'Gym/Fitness');
    const focused = buildCategoryAnalysis(category, analysis, buildPeriodAnalysis([], bounds), bounds);
    expect(focused).toMatchObject({ sessionCount: 1, workoutCount: 1, totalSeconds: 4860, totalWorkoutSeconds: 4140 });
  });

  it('builds explicit completed and active Work attendance from canonical boundaries', () => {
    const completedBounds = getPeriodBounds('day', '2026-08-16');
    const completed = buildPeriodAnalysis([
      { id: 'arrive', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-16T11:02:00Z', location: { label: 'Docksteader' }, metadata: { sentAtIso: '2026-08-16T11:02:03Z' }, receivedAt: '2026-08-16T11:02:04Z' },
      { id: 'leave', eventType: 'leave_work', activityFamily: 'work', occurredAt: '2026-08-16T20:18:00Z', location: { label: 'Docksteader' }, metadata: { sentAtIso: '2026-08-16T20:18:03Z' }, receivedAt: '2026-08-16T20:18:04Z' }
    ], completedBounds);
    const completedRows = buildWorkAttendance(completed.sessions);
    expect(completedRows[0]).toMatchObject({ status: 'Completed', totalSeconds: 33360, location: 'Docksteader' });
    expect(completedRows[0].arrivedAt.toISOString()).toBe('2026-08-16T11:02:00.000Z');
    expect(completedRows[0].leftAt.toISOString()).toBe('2026-08-16T20:18:00.000Z');
    expect(completedRows[0].arrivalSentAt.toISOString()).toBe('2026-08-16T11:02:03.000Z');

    const activeBounds = getPeriodBounds('day', '2026-08-17');
    const active = buildPeriodAnalysis([
      { id: 'arrive-active', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-17T10:57:00Z' }
    ], activeBounds, { includeActive: true, now: new Date('2026-08-17T18:28:00Z') });
    expect(buildWorkAttendance(active.sessions)[0]).toMatchObject({ status: 'In progress', leftAt: null, totalSeconds: 27060 });
  });

  it('labels missing Work arrivals and departures without fabricating a boundary', () => {
    const bounds = getPeriodBounds('day', '2026-08-11');
    const missingDeparture = buildPeriodAnalysis([
      { id: 'arrive-only', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-11T11:00:00Z' }
    ], bounds, { includeActive: false });
    expect(buildWorkAttendance(missingDeparture.sessions)[0]).toMatchObject({ status: 'Incomplete', missingBoundary: 'end', leftAt: null, totalSeconds: null });
    const missingArrival = buildPeriodAnalysis([
      { id: 'leave-only', eventType: 'leave_work', activityFamily: 'work', occurredAt: '2026-08-11T20:00:00Z' }
    ], bounds, { includeActive: false });
    expect(buildWorkAttendance(missingArrival.sessions)[0]).toMatchObject({ status: 'Incomplete', missingBoundary: 'start', arrivedAt: null, totalSeconds: null });
    expect(buildWorkAttendance(missingArrival.sessions)[0].leftAt.toISOString()).toBe('2026-08-11T20:00:00.000Z');
  });

  it('shows Work as ended elsewhere without inventing a departure or duration', () => {
    const bounds = getPeriodBounds('day', '2026-08-19');
    const analysis = buildPeriodAnalysis([
      { id: 'work-in', eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-19T11:00:00Z', location: { label: 'Docksteader' } },
      { id: 'elsewhere', eventType: 'arrive_location', eventClass: 'location', activityFamily: 'location', occurredAt: '2026-08-19T19:00:00Z', location: { label: 'Coffee shop' } }
    ], bounds, { includeActive: true, now: new Date('2026-08-19T20:00:00Z') });
    const attendance = buildWorkAttendance(analysis.sessions);
    expect(attendance[0]).toMatchObject({
      status: 'Ended elsewhere', leftAt: null, totalSeconds: null,
      supersededByLocation: 'Coffee shop',
      statusDetail: 'Departure was not recorded. A later arrival at Coffee shop confirms this visit ended.'
    });
  });

  it.each(['week', 'month', 'year'])('keeps Work attendance history available in %s analysis', (period) => {
    const bounds = getPeriodBounds(period, '2026-08-17');
    const analysis = buildPeriodAnalysis([
      { id: `${period}-arrive-1`, eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-17T11:00:00Z' },
      { id: `${period}-leave-1`, eventType: 'leave_work', activityFamily: 'work', occurredAt: '2026-08-17T19:00:00Z' },
      { id: `${period}-arrive-2`, eventType: 'arrive_work', activityFamily: 'work', occurredAt: '2026-08-18T11:15:00Z' },
      { id: `${period}-leave-2`, eventType: 'leave_work', activityFamily: 'work', occurredAt: '2026-08-18T20:00:00Z' }
    ], bounds);
    const category = analysis.sessionCategories.find((item) => item.label === 'Work');
    expect(buildCategoryAnalysis(category, analysis, buildPeriodAnalysis([], bounds), bounds).attendance).toHaveLength(2);
  });

  it('exposes timed and point categories together without putting moments into duration totals', () => {
    const bounds = getPeriodBounds('day', '2026-08-17');
    const analysis = buildPeriodAnalysis([
      { id: 'work', activityFamily: 'work', startAt: '2026-08-17T11:00:00Z', endAt: '2026-08-17T19:00:00Z' },
      { id: 'spotify', eventType: 'start_spotify', activityFamily: 'spotify', occurredAt: '2026-08-17T20:00:00Z' },
      { id: 'journal', eventType: 'journal_entry', activityFamily: 'journal', occurredAt: '2026-08-17T21:00:00Z', metadata: { note: 'A useful reflection' } }
    ], bounds);
    expect(analysis.sessionCategories.map((category) => category.label)).toContain('Work');
    expect(analysis.pointCategories.map((category) => category.label)).toEqual(expect.arrayContaining(['Spotify', 'Journal']));
    expect(analysis.activityEntries.map((entry) => entry.pointCategory)).toEqual(expect.arrayContaining(['Spotify', 'Journal']));
    expect(analysis.timedSeconds).toBe(28800);
  });

  it('filters seven-day, yearly, and all-time tally ranges', () => {
    const now = new Date('2026-08-17T16:00:00Z');
    const events = [
      { id: 'old', occurredAt: '2025-01-01T12:00:00Z' },
      { id: 'recent', occurredAt: '2026-08-11T12:00:00Z' },
      { id: 'today', occurredAt: '2026-08-17T12:00:00Z' }
    ];
    expect(filterLifeEventsByRange(events, getActivityTallyRange('7d', now)).map((event) => event.id)).toEqual(['recent', 'today']);
    expect(filterLifeEventsByRange(events, getActivityTallyRange('year', now)).map((event) => event.id)).toEqual(['recent', 'today']);
    expect(filterLifeEventsByRange(events, getActivityTallyRange('all', now))).toHaveLength(3);
  });

  it('builds comparisons and safe empty/partial states', () => {
    expect(formatDuration(2713)).toBe('45m');
    expect(buildComparison(
      { timedSeconds: 3600, events: [{}] },
      { timedSeconds: 1800, events: [{}] }
    )).toMatchObject({ deltaSeconds: 1800, hasPrevious: true });
    expect(buildPeriodAnalysis([], getPeriodBounds('day', '2026-08-11'))).toMatchObject({ timedSeconds: 0, activeCount: 0, incompleteCount: 0 });
  });

  it('toggles and clears donut selection deterministically', () => {
    expect(toggleActivitySelection(null, 'Work')).toBe('Work');
    expect(toggleActivitySelection('Work', 'Gym/Fitness')).toBe('Gym/Fitness');
    expect(toggleActivitySelection('Gym/Fitness', 'Gym/Fitness')).toBeNull();
  });
});

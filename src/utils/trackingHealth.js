import { APP_TIMEZONE, buildPeriodAnalysis, getDateIdInTimezone, getIncompleteSessionMessage, getLocalDayBounds, getSessionDisplayName } from './lifeEventUtils.js';

// "Needs attention": the gaps in the tracking for the period on screen, in one list, each with something to do about
// it. Built from a buildPeriodAnalysis result; pure, so the dashboard only draws it.

export const LOW_COVERAGE_SHARE = 0.5;
const DAY_SECONDS = 24 * 3600;

const dayLabel = (dateId) => new Date(`${dateId}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Issues for the period, newest day first: `{ key, kind, dateId, text, action }`.
 * - `missing-finish`: a session with only one boundary (action `edit`, with the session to correct);
 * - `repeated-sleep`: extra reports of a night that were set aside so it counts once (information only);
 * - `low-coverage`: a finished day with under half of its 24 hours tracked (action `add`, to add what's missing).
 * Today and days still to come are never "low": they aren't over.
 */
export function buildTrackingIssues({ analysis, bounds, now = new Date(), dayText = dayLabel }) {
  if (!analysis) return [];
  const timeZone = bounds?.timezone || APP_TIMEZONE;
  const todayId = getDateIdInTimezone(now, timeZone);
  const issues = [];

  (analysis.sessions || []).filter((session) => session.kind === 'incomplete').forEach((session) => {
    const at = session.startAt || session.endAt;
    const dateId = at ? getDateIdInTimezone(at, timeZone) : '';
    issues.push({
      key: `missing-finish:${session.id}`,
      kind: 'missing-finish',
      dateId,
      text: `${getSessionDisplayName(session)}${dateId ? `, ${dayText(dateId)}` : ''}: ${getIncompleteSessionMessage(session) || 'one end is missing'}`,
      action: 'edit',
      session
    });
  });

  const repeatedSleep = new Map();
  (analysis.suppressedEvents || []).filter((item) => item.reason === 'overlapping_sleep_report' || item.reason === 'superseded_sleep').forEach((item) => {
    const end = item.authoritativeEvent?.endAt || item.event?.endAt;
    const date = end?.toDate ? end.toDate() : end ? new Date(end) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    const dateId = getDateIdInTimezone(date, timeZone);
    if (bounds && (dateId < bounds.startDateId || dateId > bounds.endDateId)) return;
    repeatedSleep.set(dateId, (repeatedSleep.get(dateId) || 0) + 1);
  });
  repeatedSleep.forEach((count, dateId) => {
    issues.push({
      key: `repeated-sleep:${dateId}`,
      kind: 'repeated-sleep',
      dateId,
      text: `The night ending ${dayText(dateId)} arrived ${count + 1} times; it counts once, as the report with the most sleep.`,
      action: null
    });
  });

  // Each finished day measured the way its own day view measures it (a night counts on the day it ends), for up to
  // a month at a time; a year would mean hundreds of analyses for a list nobody reads that far down.
  const days = bounds?.startDateId && bounds?.endDateId ? datesBetween(bounds.startDateId, bounds.endDateId) : [];
  if (days.length && days.length <= 31) {
    for (const dateId of days) {
      if (dateId >= todayId) continue;
      const dayBounds = getLocalDayBounds(dateId, timeZone);
      const day = buildPeriodAnalysis(analysis.sourceEvents || [], dayBounds, { includeActive: false, now });
      const share = Math.min(1, (day.timedSeconds || 0) / ((dayBounds.end - dayBounds.start) / 1000 || DAY_SECONDS));
      if (share >= LOW_COVERAGE_SHARE) continue;
      issues.push({
        key: `low-coverage:${dateId}`,
        kind: 'low-coverage',
        dateId,
        text: `${dayText(dateId)}: ${Math.round(share * 100)}% of the day tracked`,
        action: 'add',
        share
      });
    }
  }

  const order = { 'missing-finish': 0, 'low-coverage': 1, 'repeated-sleep': 2 };
  return issues.sort((left, right) => right.dateId.localeCompare(left.dateId) || order[left.kind] - order[right.kind]);
}

/** The issues not dismissed with "This is fine". */
export const openIssues = (issues, dismissed = []) => issues.filter((issue) => !dismissed.includes(issue.key));

function datesBetween(startDateId, endDateId) {
  const dates = [];
  for (let day = new Date(`${startDateId}T12:00:00Z`); ; day = new Date(day.getTime() + 86400000)) {
    const id = day.toISOString().slice(0, 10);
    if (id > endDateId || dates.length > 400) break;
    dates.push(id);
  }
  return dates;
}

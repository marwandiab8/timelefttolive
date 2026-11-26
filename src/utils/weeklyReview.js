import { getCustodyWeekStatus } from './custodyUtils.js';
import { addDays, addYears, daysBetween, formatDateId, getAge, parseDateId, toLocalDate } from './dateUtils.js';
import { evaluateTarget, normalizeActivityTargets } from './activityTargets.js';
import { APP_TIMEZONE, getDateIdInTimezone, getLocalDayBounds } from './lifeEventUtils.js';

// A weekly review belongs to one square of the life calendar: the week that starts on your birthday's weekday, 52 to
// a year, with the last square of each year taking the year's leftover day or two. That is the cell it colours, so
// it is also the week it reviews.

export const RATINGS = Object.freeze([
  { value: 1, label: 'Rough' },
  { value: 2, label: 'Meh' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Great' }
]);

export const INTENTION_OUTCOMES = Object.freeze([
  { value: 'yes', label: 'It happened' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'Not this time' }
]);

export const ratingLabel = (value) => RATINGS.find((rating) => rating.value === Number(value))?.label || '';

/** The life-calendar square that holds `dateId`: `{ start, end, age, weekIndex }` as YYYY-MM-DD. */
export function lifeWeekFor(birthDate, dateId) {
  if (!birthDate || !dateId) return null;
  const day = parseDateId(dateId);
  const birth = toLocalDate(birthDate);
  if (day < birth) return null;
  const age = getAge(birthDate, day);
  const yearStart = addYears(birth, age);
  const weekIndex = Math.min(51, Math.floor(daysBetween(yearStart, day) / 7));
  const start = addDays(yearStart, weekIndex * 7);
  const end = weekIndex === 51 ? addDays(addYears(birth, age + 1), -1) : addDays(start, 6);
  return { start: formatDateId(start), end: formatDateId(end), age, weekIndex };
}

export function previousLifeWeek(birthDate, week) {
  return week ? lifeWeekFor(birthDate, formatDateId(addDays(parseDateId(week.start), -1))) : null;
}

export function nextLifeWeek(birthDate, week) {
  return week ? lifeWeekFor(birthDate, formatDateId(addDays(parseDateId(week.end), 1))) : null;
}

/** Bounds for the Activity analysis, from the first moment of `start` to the end of `end`, in the app's time zone. */
export function lifeWeekBounds(week, timeZone = APP_TIMEZONE) {
  if (!week) return null;
  const first = getLocalDayBounds(week.start, timeZone);
  const last = getLocalDayBounds(week.end, timeZone);
  if (!first || !last) return null;
  return { period: 'week', timezone: timeZone, start: first.start, end: last.end, startDateId: week.start, endDateId: week.end };
}

export function weekDayIds(week) {
  if (!week) return [];
  const total = daysBetween(parseDateId(week.start), parseDateId(week.end)) + 1;
  return Array.from({ length: total }, (_, index) => formatDateId(addDays(parseDateId(week.start), index)));
}

/** Days of the week the kids were with you, or null when there is no custody schedule. */
export function countDaysWithKids(custodySchedule, week) {
  if (!custodySchedule?.enabled || !custodySchedule?.nextStartDate || !week) return null;
  if (custodySchedule.since && week.end < custodySchedule.since) return 0;
  return weekDayIds(week).filter((dateId) => (
    (!custodySchedule.since || dateId >= custodySchedule.since)
    && getCustodyWeekStatus(custodySchedule, parseDateId(dateId))?.withYou
  )).length;
}

/**
 * The week in numbers, as saved with the review: tracked time by category (largest first), how each target did, days
 * with the kids, and days with something written down. `analysis` is a `buildPeriodAnalysis` result for the week's
 * bounds; `journalDateIds` the days that have a note, journal entry or photo.
 */
export function summarizeWeek({ analysis, bounds, targets, custodySchedule, week, journalDateIds = [] }) {
  const categories = (analysis?.categories || []).map((category) => ({ label: category.label, seconds: Math.round(category.seconds) }));
  const normalizedTargets = normalizeActivityTargets(targets);
  const targetResults = (analysis?.sessionCategories || []).map((category) => {
    const activeDays = new Set(category.sessions.map((session) => getDateIdInTimezone(session.startAt, bounds?.timezone || APP_TIMEZONE))).size;
    const evaluation = evaluateTarget(normalizedTargets, {
      label: category.label,
      totalSeconds: category.seconds,
      sessionCount: category.sessions.length,
      activeDays,
      averageActiveDaySeconds: activeDays ? category.seconds / activeDays : 0
    }, 'week', bounds);
    return evaluation ? { label: category.label, met: evaluation.met, text: evaluation.text } : null;
  }).filter(Boolean);
  // A visit target with no visits this week was missed (0 of 3). A time target with nothing tracked is left out: no
  // sleep logged is a tracking gap, not a week without sleep.
  Object.keys(normalizedTargets).forEach((label) => {
    if (!normalizedTargets[label].sessionsPerWeek || targetResults.some((result) => result.label === label)) return;
    const evaluation = evaluateTarget(normalizedTargets, { label, totalSeconds: 0, sessionCount: 0, activeDays: 0, averageActiveDaySeconds: 0 }, 'week', bounds);
    if (evaluation) targetResults.push({ label, met: evaluation.met, text: evaluation.text });
  });
  const days = new Set(weekDayIds(week));
  return {
    trackedSeconds: categories.reduce((sum, category) => sum + category.seconds, 0),
    categories: categories.slice(0, 8),
    targets: targetResults,
    daysWithKids: countDaysWithKids(custodySchedule, week),
    journalDays: new Set(journalDateIds.filter((dateId) => days.has(dateId))).size,
    dayCount: days.size
  };
}

/**
 * What the calendar should ask about today. Last week's square while it has no review (unless it was skipped);
 * otherwise this week's on its last day; otherwise nothing. `reviews` is keyed by week start.
 */
export function reviewDue({ birthDate, today, reviews = {}, skipped = [] }) {
  const current = lifeWeekFor(birthDate, today);
  if (!current) return null;
  const last = previousLifeWeek(birthDate, current);
  if (last && !reviews[last.start] && !skipped.includes(last.start)) return { week: last, when: 'last' };
  if (today === current.end && !reviews[current.start] && !skipped.includes(current.start)) return { week: current, when: 'endsToday' };
  return null;
}

/** The intention to carry into `week`: the one set in the review of the week before it. */
export function carriedIntention(birthDate, week, reviews = {}) {
  const before = previousLifeWeek(birthDate, week);
  const intention = before ? reviews[before.start]?.intention : '';
  return intention ? { week: before, text: intention } : null;
}

/** Reviewed weeks in a row, counting back from last week (this week counts too once it has its review). */
export function reviewStreak(birthDate, today, reviews = {}) {
  let week = lifeWeekFor(birthDate, today);
  if (!week) return 0;
  if (!reviews[week.start]) week = previousLifeWeek(birthDate, week);
  let count = 0;
  while (week && reviews[week.start]) {
    count += 1;
    week = previousLifeWeek(birthDate, week);
  }
  return count;
}

const clean = (value, max) => String(value || '').trim().slice(0, max);

/** The document saved at `weeklyReviews/{week.start}`. Owner-only unless `shareWithViewers`. */
export function buildReviewDocument(form, week, numbers) {
  const rating = Number(form.rating);
  const intentionKept = INTENTION_OUTCOMES.some((outcome) => outcome.value === form.intentionKept) ? form.intentionKept : null;
  return {
    weekStart: week.start,
    weekEnd: week.end,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    mattered: clean(form.mattered, 2000),
    moment: clean(form.moment, 2000),
    intention: clean(form.intention, 500),
    intentionKept,
    numbers: numbers || null,
    visibility: form.shareWithViewers ? 'viewers' : 'ownerOnly'
  };
}

export const isReviewEmpty = (form) => !Number(form.rating) && !clean(form.mattered, 1) && !clean(form.moment, 1) && !clean(form.intention, 1);

const hoursAndMinutes = (seconds) => {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
};

/** Short, plain lines for the week's numbers, in the panel's voice. */
export function describeWeekNumbers(numbers) {
  if (!numbers) return [];
  const lines = [];
  if (numbers.daysWithKids !== null && numbers.daysWithKids !== undefined) {
    lines.push(numbers.daysWithKids === 0
      ? 'The boys were with their other parent all week'
      : `${numbers.daysWithKids} ${numbers.daysWithKids === 1 ? 'day' : 'days'} with the boys`);
  }
  if (numbers.trackedSeconds > 0) {
    const top = numbers.categories.slice(0, 3).map((category) => `${category.label} ${hoursAndMinutes(category.seconds)}`).join(' · ');
    lines.push(`${hoursAndMinutes(numbers.trackedSeconds)} tracked: ${top}`);
  }
  if (numbers.targets?.length) {
    const met = numbers.targets.filter((target) => target.met).length;
    lines.push(`${met} of ${numbers.targets.length} ${numbers.targets.length === 1 ? 'target' : 'targets'} met`);
  }
  lines.push(numbers.journalDays
    ? `Something written down on ${numbers.journalDays} of ${numbers.dayCount} days`
    : 'Nothing written down this week');
  return lines;
}

/** "Nov 22 to Nov 28" (with the year when it isn't this year's). */
export function weekRangeLabel(week, now = new Date()) {
  if (!week) return '';
  const thisYear = toLocalDate(now).getFullYear();
  const format = (dateId) => {
    const date = parseDateId(dateId);
    return date.toLocaleDateString(undefined, date.getFullYear() === thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  };
  return `${format(week.start)} to ${format(week.end)}`;
}

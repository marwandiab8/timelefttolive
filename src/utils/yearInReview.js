import { addDays, daysBetween, formatDateId, getLifeYearRange, parseDateId } from './dateUtils.js';
import { formatHeight, formatHeightChange } from './childMeasurements.js';
import { getDateIdInTimezone, APP_TIMEZONE } from './lifeEventUtils.js';
import { noteLines } from './onThisDay.js';
import { RATINGS, countDaysWithKids, lifeWeekFor, ratingLabel } from './weeklyReview.js';

// One page per life year: birthday to the day before the next one, in the life calendar's 52 squares.

const BEST_WEEK_LIMIT = 5;
const EVENT_LIMIT = 12;
const ACTIVITY_LIMIT = 8;

const shortDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const inRange = (dateId, start, end) => Boolean(dateId) && dateId >= start && dateId <= end;

/** The year's 52 squares: { start, end, weekIndex }, the last taking the year's leftover day or two. */
export function lifeYearWeeks(birthDate, age) {
  const { start } = getLifeYearRange(birthDate, age);
  return Array.from({ length: 52 }, (_, index) => lifeWeekFor(birthDate, formatDateId(addDays(start, index * 7))));
}

/**
 * The year's activity from a buildPeriodAnalysis over it: total tracked time and the biggest categories, each with how
 * many sessions and on how many days. Null when nothing was tracked.
 */
export function summarizeYearActivity(analysis, timeZone = APP_TIMEZONE) {
  const categories = (analysis?.categories || []).filter((category) => category.seconds >= 60);
  if (!categories.length) return null;
  return {
    trackedSeconds: Math.round(categories.reduce((sum, category) => sum + category.seconds, 0)),
    categories: categories.slice(0, ACTIVITY_LIMIT).map((category) => ({
      label: category.label,
      color: category.color || '',
      seconds: Math.round(category.seconds),
      sessions: (category.sessions || []).length,
      days: new Set((category.sessions || []).map((session) => session.startAt && getDateIdInTimezone(session.startAt, timeZone)).filter(Boolean)).size
    }))
  };
}

/**
 * Everything the year-in-review page shows for life year `age`. Only what's passed in is used, so a viewer's page has
 * only what's shared with viewers. `today` cuts a year still under way short ("so far"); weeks after it aren't counted.
 *
 * `reviews` is keyed by week start; `entries` is that year's day entries; `activity` is from summarizeYearActivity.
 */
export function buildYearInReview({ calendar = {}, age, today, reviews = {}, events = [], entries = [], plans = [], measurements = [], activity = null }) {
  const { start: startDate, end: endDate } = getLifeYearRange(calendar.birthDate, age);
  const start = formatDateId(startDate);
  const end = formatDateId(endDate);
  const soFar = today >= start && today <= end;
  const lastDay = soFar ? today : end;
  const future = today < start;
  const custody = calendar.custodySchedule;
  const custodyReady = Boolean(custody?.enabled && custody?.nextStartDate && custody?.since);

  const weeks = lifeYearWeeks(calendar.birthDate, age).map((week) => {
    const lived = week.start <= lastDay && !future;
    const review = reviews[week.start] || null;
    const rating = Number(review?.rating) || null;
    // Only the days lived so far, so this week's count isn't a guess about the rest of it.
    const daysWithKids = lived && custodyReady ? countDaysWithKids(custody, { start: week.start, end: week.end < lastDay ? week.end : lastDay }) : 0;
    return { start: week.start, end: week.end, weekIndex: week.weekIndex, lived, reviewed: Boolean(review), rating, daysWithKids };
  });

  const livedWeeks = weeks.filter((week) => week.lived);
  const rated = livedWeeks.filter((week) => week.rating);
  const counts = Object.fromEntries(RATINGS.map((rating) => [rating.value, rated.filter((week) => week.rating === rating.value).length]));
  const yearReviews = livedWeeks.map((week) => reviews[week.start]).filter(Boolean);
  const intentions = { set: 0, yes: 0, partly: 0, no: 0 };
  yearReviews.forEach((review) => {
    if (['yes', 'partly', 'no'].includes(review.intentionKept)) {
      intentions.set += 1;
      intentions[review.intentionKept] += 1;
    }
  });

  const bestWeeks = yearReviews
    .map((review) => ({ start: review.weekStart, rating: Number(review.rating) || 0, text: String(review.moment || review.mattered || '').trim() }))
    .filter((week) => week.rating >= 4 && week.text)
    .sort((left, right) => right.rating - left.rating || left.start.localeCompare(right.start))
    .slice(0, BEST_WEEK_LIMIT)
    .map((week) => ({ ...week, label: `${ratingLabel(week.rating)} · week of ${shortDate(week.start)}` }));

  const kidsDays = weeks.reduce((sum, week) => sum + week.daysWithKids, 0);
  // Out of the days the schedule covered this year so far (from the day it began, if that was during the year).
  const kidsFrom = custodyReady && custody.since > start ? custody.since : start;
  const coveredDays = future || kidsFrom > lastDay ? 0 : daysBetween(parseDateId(kidsFrom), parseDateId(lastDay)) + 1;
  const kids = custodyReady ? { days: kidsDays, of: coveredDays, scheduleBegan: kidsFrom > start, weeks: weeks.filter((week) => week.daysWithKids > 0).length } : null;

  const done = plans
    .filter((plan) => plan?.title && inRange(plan.doneOn, start, lastDay))
    .sort((left, right) => left.doneOn.localeCompare(right.doneOn))
    .map((plan) => ({ title: plan.title, doneOn: plan.doneOn, when: shortDate(plan.doneOn) }));

  // Something that began this year; a place you lived or a job is named in the year it started.
  const yearEvents = events
    .filter((event) => event?.title && inRange(event.startDate, start, lastDay))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  const named = yearEvents.slice(0, EVENT_LIMIT).map((event) => ({ title: event.title, startDate: event.startDate, when: shortDate(event.startDate) }));

  const writtenDays = new Set(entries.filter((entry) => inRange(entry?.dateId, start, lastDay) && noteLines(entry).length).map((entry) => entry.dateId)).size;

  const names = new Map((calendar.children || []).map((child) => [child.id, child.name || 'Unnamed child']));
  const heights = [...names.keys()].map((childId) => {
    const points = measurements
      .filter((measurement) => measurement.childId === childId && (measurement.kind || 'height') === 'height' && Number.isFinite(measurement.valueMm) && inRange(measurement.measuredOn, start, lastDay))
      .sort((left, right) => left.measuredOn.localeCompare(right.measuredOn));
    if (!points.length) return null;
    const first = points[0];
    const last = points[points.length - 1];
    return {
      childId,
      name: names.get(childId),
      latest: formatHeight(last.valueMm),
      latestOn: shortDate(last.measuredOn),
      change: points.length > 1 ? formatHeightChange(last.valueMm - first.valueMm) : '',
      since: points.length > 1 ? shortDate(first.measuredOn) : ''
    };
  }).filter(Boolean);

  return {
    age,
    start,
    end,
    soFar,
    future,
    title: `Age ${age}`,
    range: `${longDate(start)} to ${longDate(end)}`,
    weeks,
    livedWeekCount: livedWeeks.length,
    ratings: {
      reviewed: yearReviews.length,
      rated: rated.length,
      average: rated.length ? Math.round((rated.reduce((sum, week) => sum + week.rating, 0) / rated.length) * 10) / 10 : null,
      counts,
      intentions
    },
    bestWeeks,
    kids,
    done,
    events: { count: yearEvents.length, named },
    writtenDays,
    heights,
    activity
  };
}

/** The year in one sentence, for the top of the page. */
export function yearHeadline(review) {
  if (review.future) return 'This year hasn’t started yet.';
  const parts = [];
  parts.push(`${review.livedWeekCount} ${review.livedWeekCount === 1 ? 'week' : 'weeks'}${review.soFar ? ' so far' : ''}`);
  if (review.ratings.reviewed) parts.push(`${review.ratings.reviewed} reviewed`);
  if (review.kids?.days) parts.push(`${review.kids.days} ${review.kids.days === 1 ? 'day' : 'days'} with the boys`);
  if (review.done.length) parts.push(`${review.done.length} ${review.done.length === 1 ? 'thing' : 'things'} done`);
  return `${parts.join(' · ')}.`;
}

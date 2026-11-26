import { countDaysWithKids, ratingLabel, RATINGS } from './weeklyReview.js';
import { formatDateId } from './dateUtils.js';

// The life calendar can colour the weeks already lived by something other than events: how the week went (its weekly
// review) or how many of its days the kids were with you. Everything here is pure; LifeHeatmap draws the result.

export const LIVED_WEEK_MODES = Object.freeze([
  { value: 'events', label: 'Events' },
  { value: 'rating', label: 'How the week went' },
  { value: 'kids', label: 'With the boys' }
]);

// One hue family getting lighter and warmer as the week gets better, so the order reads without a legend and without
// telling red from green. Every step stays lighter than the default lived-week grey (#46505c), so a rated week is
// always visible against an unrated one.
export const RATING_COLORS = Object.freeze({
  1: '#5d6f86',
  2: '#5f8f9c',
  3: '#69b0a3',
  4: '#9fd39a',
  5: '#f2d66b'
});

export const KIDS_COLOR = '#ef9a6b';

export const ratingLegend = () => RATINGS.map((rating) => ({ label: rating.label, color: RATING_COLORS[rating.value] }));

export function normalizeLivedMode(value, { hasCustody = false } = {}) {
  if (value === 'rating') return 'rating';
  if (value === 'kids' && hasCustody) return 'kids';
  return 'events';
}

/**
 * Marks for the lived weeks (`end` on or before today, plus the current week) in `mode`:
 * a Map of the week's first day to `{ fill, dot, label }`. `fill` replaces the lived-week colour (null leaves it),
 * `dot` marks a week with something written down, `label` is added to the cell's title.
 *
 * `weeks` are the heatmap's cells (`{ dateId, start, end }` with Date bounds), `reviews` are keyed by week start,
 * `writtenDateIds` is a Set of days with a note or journal entry.
 */
export function buildLivedWeekMarks({ mode, weeks, reviews = {}, custodySchedule = null, writtenDateIds = new Set(), today }) {
  const marks = new Map();
  if (mode !== 'rating' && mode !== 'kids') return marks;
  const todayId = typeof today === 'string' ? today : formatDateId(today);
  // The schedule repeats back forever, so without the day it began it would colour weeks before it existed.
  const custodyReady = Boolean(custodySchedule?.enabled && custodySchedule?.nextStartDate && custodySchedule?.since);
  for (const week of weeks) {
    const start = week.dateId;
    if (start > todayId) continue;
    const end = formatDateId(week.end);
    const days = dayIds(start, end);
    const dot = days.some((dateId) => writtenDateIds.has(dateId));
    if (mode === 'rating') {
      const review = reviews[start];
      const rating = Number(review?.rating);
      const fill = RATING_COLORS[rating] || null;
      const label = review ? (fill ? `Reviewed: ${ratingLabel(rating).toLowerCase()}` : 'Reviewed') : '';
      if (fill || dot || label) marks.set(start, { fill, dot, label });
      continue;
    }
    const withKids = custodyReady ? countDaysWithKids(custodySchedule, { start, end }) : 0;
    if (!withKids && !dot) continue;
    marks.set(start, {
      fill: withKids ? kidsFill(withKids, days.length) : null,
      dot,
      label: withKids ? `${withKids} ${withKids === 1 ? 'day' : 'days'} with the boys` : ''
    });
  }
  return marks;
}

/** Stronger the more of the week they were with you: a single day still shows, a whole week is the full colour. */
export function kidsFill(daysWithKids, daysInWeek = 7) {
  const share = Math.max(0, Math.min(1, daysWithKids / Math.max(1, daysInWeek)));
  const percent = Math.round(35 + share * 65);
  return `color-mix(in srgb, ${KIDS_COLOR} ${percent}%, var(--life-past, #46505c))`;
}

/** Whether the kids view can colour anything yet, and if not, what to say. */
export function kidsModeNote(custodySchedule) {
  if (!custodySchedule?.enabled || !custodySchedule?.nextStartDate) return 'Set up the every-other-week schedule to see your weeks with the boys.';
  if (!custodySchedule.since) return 'Add the day this schedule began (Edit kids and schedule) to colour your weeks with the boys.';
  return '';
}

function dayIds(start, end) {
  const ids = [];
  const [year, month, day] = start.split('-').map(Number);
  for (let offset = 0; offset < 10; offset += 1) {
    const id = formatDateId(new Date(year, month - 1, day + offset));
    if (id > end) break;
    ids.push(id);
  }
  return ids;
}

// Two or three one-line facts about the period, each carrying the numbers that prove it. Every
// fact is computed from the current analysis and the recent history already loaded for the wheel
// (`recentHistory[0]` is the previous period, `[1]` the one before, and so on). Nothing is guessed.

import { formatDuration, getLocalDateId, getPeriodBounds, shiftPeriodDate } from './lifeEventUtils.js';

const PERIOD_NOUN = { day: 'day', week: 'week', month: 'month', year: 'year' };
const STREAK_MIN = 3;
const BEST_MIN_HISTORY = 4;
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
// Streaks of things one chooses to do; working or sleeping several days running is not notable.
const STREAK_CATEGORIES = new Set(['Gym/Fitness', 'Darts', 'Reading']);
const VISIT_CATEGORIES = new Set(['Gym/Fitness', 'Darts', 'Reading']);

const shortDate = new Intl.DateTimeFormat(undefined, { timeZone: 'America/Toronto', month: 'short', day: 'numeric' });

const secondsOf = (analysis, label) => analysis?.categories?.find((category) => category.label === label)?.seconds || 0;
const ordinal = (n) => ORDINALS[n] || `${n}th`;
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Builds the facts. `history` is the dashboard's `recentHistory` ({ bounds, analysis }[]).
 * Returns at most `limit` facts, each `{ id, label, text, detail }`, strongest first.
 */
export function buildNotableFacts({ analysis, history = [], period = 'day', bounds = null, limit = 3 } = {}) {
  if (!analysis?.categories?.length) return [];
  const noun = PERIOD_NOUN[period] || 'period';
  const facts = [];

  analysis.categories.forEach((category) => {
    const { label, seconds } = category;
    if (!(seconds > 0)) return;

    // A streak: this period and every one before it, back through the loaded history.
    if (STREAK_CATEGORIES.has(label)) {
      let streak = 1;
      let streakSeconds = seconds;
      for (const item of history) {
        const past = secondsOf(item.analysis, label);
        if (!(past > 0)) break;
        streak += 1;
        streakSeconds += past;
      }
      if (streak >= STREAK_MIN) {
        const since = history[streak - 2]?.bounds?.start;
        facts.push({
          id: `streak:${label}`,
          label,
          score: 30 + streak,
          text: `${label} ${streak} ${noun}s in a row`,
          detail: `${since ? `Every ${noun} since ${shortDate.format(since)}` : `${streak} ${noun}s running`}, ${formatDuration(streakSeconds)} in all`
        });
      }
    }

    // The best period in the loaded history: more than any of the last N periods that had it.
    const pastSeconds = history.map((item) => secondsOf(item.analysis, label)).filter((value) => value > 0);
    if (pastSeconds.length >= BEST_MIN_HISTORY && seconds > Math.max(...pastSeconds)) {
      const best = Math.max(...pastSeconds);
      const bestItem = history.find((item) => secondsOf(item.analysis, label) === best);
      facts.push({
        id: `best:${label}`,
        label,
        score: 20 + Math.min(9, pastSeconds.length),
        text: `Most ${label === 'Work' ? 'work' : label === 'Sleep' ? 'sleep' : label} in ${history.length + 1} ${noun}s`,
        detail: `${formatDuration(seconds)} this ${noun}; the previous best was ${formatDuration(best)}${bestItem?.bounds?.start ? ` (${period === 'day' ? shortDate.format(bestItem.bounds.start) : `${noun} of ${shortDate.format(bestItem.bounds.start)}`})` : ''}`
      });
    }
  });

  // On a day: the nth visit of the week so far, from the days of this week already loaded.
  if (period === 'day' && bounds?.startDateId) {
    const weekStart = getPeriodBounds('week', bounds.startDateId).startDateId;
    const daysIntoWeek = Math.round((Date.parse(bounds.startDateId) - Date.parse(weekStart)) / 86_400_000);
    analysis.categories.forEach((category) => {
      if (!VISIT_CATEGORIES.has(category.label) || !(category.seconds > 0)) return;
      const earlierDays = history
        .slice(0, daysIntoWeek)
        .filter((item) => secondsOf(item.analysis, category.label) > 0)
        .map((item) => shortDate.format(item.bounds.start))
        .reverse();
      const nth = earlierDays.length + 1;
      if (nth < 2) return;
      const visits = category.label === 'Gym/Fitness' ? 'gym visit' : `${category.label} session`;
      facts.push({
        id: `nth:${category.label}`,
        label: category.label,
        score: 10 + nth,
        text: `${ordinal(nth)[0].toUpperCase()}${ordinal(nth).slice(1)} ${visits} this week`,
        detail: `Also on ${earlierDays.join(', ')}; ${formatDuration(category.seconds)} today`
      });
    });
  }

  const seen = new Set();
  return facts
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .filter((fact) => (seen.has(fact.label) ? false : seen.add(fact.label)))
    .slice(0, limit)
    .map(({ score, ...fact }) => fact);
}

/** How many days of this week, up to and including `dateId`, had any time in `label`. */
export function countWeekDays(label, analysis, history, dateId = getLocalDateId()) {
  const weekStart = getPeriodBounds('week', dateId).startDateId;
  let count = secondsOf(analysis, label) > 0 ? 1 : 0;
  let cursor = shiftPeriodDate(dateId, 'day', -1);
  for (const item of history) {
    if (cursor < weekStart) break;
    if (item.bounds?.startDateId !== cursor) break;
    if (secondsOf(item.analysis, label) > 0) count += 1;
    cursor = shiftPeriodDate(cursor, 'day', -1);
  }
  return count;
}

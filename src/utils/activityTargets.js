// Per-category targets on the owner's calendar profile (`activityTargets`), and how a period
// measures up to them. Pure; the dashboard draws the result and writes the profile.
//
//   activityTargets: {
//     Sleep:         { minSeconds: 25200 },      // at least 7h a night
//     Work:          { maxSeconds: 32400 },      // at most 9h a day
//     'Gym/Fitness': { sessionsPerWeek: 3 }      // at least 3 visits a week
//   }

import { formatDuration } from './lifeEventUtils.js';

export const TARGET_DEFINITIONS = Object.freeze({
  Sleep: { kind: 'minSeconds', noun: 'a night', verb: 'sleep' },
  Work: { kind: 'maxSeconds', noun: 'a day', verb: 'work' },
  'Gym/Fitness': { kind: 'sessionsPerWeek', noun: 'a week', verb: 'gym visits' },
  Reading: { kind: 'minSeconds', noun: 'a day', verb: 'read' },
  Darts: { kind: 'sessionsPerWeek', noun: 'a week', verb: 'darts sessions' },
  Home: { kind: 'minSeconds', noun: 'a day', verb: 'be home' },
  Meals: { kind: 'minSeconds', noun: 'a day', verb: 'eat' },
  Transportation: { kind: 'maxSeconds', noun: 'a day', verb: 'drive' },
  Music: { kind: 'minSeconds', noun: 'a day', verb: 'listen' }
});

export const TARGETABLE_LABELS = Object.freeze(Object.keys(TARGET_DEFINITIONS));

const MAX_SECONDS = 24 * 3600;
const MAX_SESSIONS = 50;

const cleanSeconds = (value) => {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_SECONDS ? seconds : null;
};
const cleanCount = (value) => {
  const count = Math.round(Number(value));
  return Number.isFinite(count) && count > 0 && count <= MAX_SESSIONS ? count : null;
};

/** Drops anything that is not a known category with one sensible positive number. */
export function normalizeActivityTargets(raw) {
  const targets = {};
  Object.entries(raw && typeof raw === 'object' ? raw : {}).forEach(([label, value]) => {
    const definition = TARGET_DEFINITIONS[label];
    if (!definition || !value || typeof value !== 'object') return;
    const amount = definition.kind === 'sessionsPerWeek' ? cleanCount(value[definition.kind]) : cleanSeconds(value[definition.kind]);
    if (amount) targets[label] = { [definition.kind]: amount };
  });
  return targets;
}

/** The number stored for a label, whatever its kind, or null. */
export function targetAmount(targets, label) {
  const definition = TARGET_DEFINITIONS[label];
  return definition ? targets?.[label]?.[definition.kind] ?? null : null;
}

/** Describes a target in words: "at least 7h a night", "at most 9h a day", "3 gym visits a week". */
export function describeTarget(label, amount) {
  const definition = TARGET_DEFINITIONS[label];
  if (!definition || !amount) return '';
  if (definition.kind === 'sessionsPerWeek') return `${amount} ${definition.verb} ${definition.noun}`;
  return `${definition.kind === 'minSeconds' ? 'at least' : 'at most'} ${formatDuration(amount)} ${definition.noun}`;
}

const daysInPeriod = (period, bounds) => {
  if (!bounds?.start || !bounds?.end) return 1;
  return Math.max(1, Math.round((bounds.end - bounds.start) / 86_400_000));
};

/**
 * How a category did against its target in this period.
 *
 * `category` is a `buildCategoryAnalysis` result (or anything with `totalSeconds`, `sessionCount`,
 * `activeDays`, `averageActiveDaySeconds`). Time targets are per day or night: a day is judged on
 * its total, a longer period on its average per active day. Visit targets are per week: a week
 * on its count, a month or year on the count against the weeks they hold, a day on the week so
 * far when `weekSessionCount` is given.
 *
 * Returns null without a target, else `{ kind, amount, measured, met, delta, text, ringSeconds }`
 * where `ringSeconds` is where the target falls on this period's slice (null when it has no
 * place on the ring).
 */
export function evaluateTarget(targets, category, period = 'day', bounds = null, options = {}) {
  const label = category?.label;
  const definition = TARGET_DEFINITIONS[label];
  const amount = targetAmount(targets, label);
  if (!definition || !amount) return null;

  if (definition.kind === 'sessionsPerWeek') {
    const days = daysInPeriod(period, bounds);
    const weeks = period === 'week' ? 1 : period === 'day' ? 1 : Math.max(1, Math.round(days / 7));
    const measured = period === 'day'
      ? (Number.isFinite(options.weekSessionCount) ? options.weekSessionCount : null)
      : Number(category.sessionCount) || 0;
    if (measured === null) return null;
    const goal = amount * weeks;
    const met = measured >= goal;
    const scope = period === 'day' || period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'this year';
    return {
      kind: definition.kind,
      amount,
      goal,
      measured,
      met,
      delta: measured - goal,
      text: `${measured} of ${goal} ${definition.verb} ${scope}`,
      ringSeconds: null
    };
  }

  const measured = period === 'day'
    ? Number(category.totalSeconds) || 0
    : Number(category.averageActiveDaySeconds) || (category.activeDays ? (Number(category.totalSeconds) || 0) / category.activeDays : 0);
  const delta = measured - amount;
  const met = definition.kind === 'minSeconds' ? delta >= -59 : delta <= 59;
  const goalWord = definition.kind === 'minSeconds' ? 'goal' : 'limit';
  const text = Math.abs(delta) < 60
    ? `At your ${formatDuration(amount)} ${goalWord}`
    : `${formatDuration(Math.abs(delta))} ${delta < 0 ? 'under' : 'over'} your ${formatDuration(amount)} ${goalWord}${period === 'day' ? '' : ' on average'}`;
  const activeDays = Math.max(1, Number(category.activeDays) || 1);
  return {
    kind: definition.kind,
    amount,
    goal: amount,
    measured,
    met,
    delta,
    text,
    ringSeconds: period === 'day' ? amount : amount * activeDays
  };
}

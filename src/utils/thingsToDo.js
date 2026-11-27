import { getCustodyWeekStatus } from './custodyUtils.js';
import { addDays, addYears, daysBetween, formatDateId, parseDateId, toLocalDate } from './dateUtils.js';
import { countSummers, countWeekends } from './whatsLeft.js';

// "Before it's too late": the things you want to do, for yourself or with the boys, each with an optional deadline
// (before an age, a season, a date) and, from that deadline, how many chances are left to do it. Kept at
// lifeCalendars/{id}/plans/{planId}. Pure; the panel draws it.

export const SEASONS = Object.freeze({
  summer: { label: 'summer', month: 8, day: 31 },
  christmas: { label: 'Christmas', month: 12, day: 25 }
});

const people = (calendar) => [
  { id: 'me', name: 'me', birthDate: calendar?.birthDate },
  ...(calendar?.children || []).map((child) => ({ id: child.id, name: child.name || 'your child', birthDate: child.birthDate }))
];
const person = (calendar, id) => people(calendar).find((item) => item.id === id) || null;

/** The last day the plan can still happen (YYYY-MM-DD), or null without a deadline. */
export function deadlineDate(plan, calendar) {
  const deadline = plan?.deadline;
  if (!deadline) return null;
  if (deadline.kind === 'date') return deadline.date || null;
  if (deadline.kind === 'season') {
    const season = SEASONS[deadline.season];
    return season && deadline.year ? formatDateId(new Date(Number(deadline.year), season.month - 1, season.day)) : null;
  }
  if (deadline.kind === 'age') {
    const who = person(calendar, deadline.personId);
    if (!who?.birthDate || !Number(deadline.age)) return null;
    return formatDateId(addDays(addYears(who.birthDate, Number(deadline.age)), -1));
  }
  return null;
}

/** "Before Joseph turns 18", "Before I turn 90", "This summer", "Christmas 2027", "By Mar 1, 2027". */
export function describeDeadline(plan, calendar, today, date = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) {
  const deadline = plan?.deadline;
  if (!deadline) return '';
  if (deadline.kind === 'date') return deadline.date ? `By ${date(deadline.date)}` : '';
  if (deadline.kind === 'season') {
    const season = SEASONS[deadline.season];
    if (!season) return '';
    const thisYear = toLocalDate(parseDateId(today)).getFullYear();
    if (Number(deadline.year) === thisYear) return deadline.season === 'summer' ? 'This summer' : 'This Christmas';
    if (Number(deadline.year) === thisYear + 1) return deadline.season === 'summer' ? 'Next summer' : 'Next Christmas';
    return `${deadline.season === 'summer' ? 'Summer' : 'Christmas'} ${deadline.year}`;
  }
  if (deadline.kind === 'age') {
    const who = person(calendar, deadline.personId);
    if (!who) return '';
    return deadline.personId === 'me' ? `Before I turn ${deadline.age}` : `Before ${who.name} turns ${deadline.age}`;
  }
  return '';
}

/** Weeks with you (any day of the week with you counts) from today until `until` (inclusive). */
export function countWeeksWithKids(custodySchedule, today, until) {
  if (!custodySchedule?.enabled || !custodySchedule?.nextStartDate) return null;
  let count = 0;
  for (let day = toLocalDate(parseDateId(today)); formatDateId(day) <= until; day = addDays(day, 7)) {
    const status = getCustodyWeekStatus(custodySchedule, day);
    if (status?.withYou) count += 1;
  }
  return count;
}

/**
 * How many chances are left before the deadline: `{ deadline, past, weeks, summers, weekends, weeksWithKids, text }`.
 * The text leads with what matters for the plan: your weeks with the boys when it's with them and they're on the
 * schedule, summers for anything a year or more away, weekends otherwise.
 */
export function chancesLeft(plan, calendar, today) {
  const deadline = deadlineDate(plan, calendar);
  if (!deadline) return null;
  const start = parseDateId(today);
  const end = parseDateId(deadline);
  if (deadline < today) return { deadline, past: true, text: 'The deadline has passed' };
  const untilExclusive = addDays(end, 1);
  const weeks = Math.floor(daysBetween(start, untilExclusive) / 7);
  const summers = countSummers(start, untilExclusive);
  const weekends = countWeekends(start, untilExclusive);
  const withKids = (plan.who || []).filter((id) => id !== 'me');
  const onSchedule = withKids.some((id) => (calendar?.custodySchedule?.childIds || []).includes(id));
  const weeksWithKids = onSchedule ? countWeeksWithKids(calendar.custodySchedule, today, deadline) : null;
  const plural = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  const parts = [];
  if (weeksWithKids !== null) parts.push(`${plural(weeksWithKids, 'of your weeks', 'of your weeks')} with them`);
  parts.push(weeks >= 52 ? plural(summers, 'summer', 'summers') : plural(weekends, 'weekend', 'weekends'));
  const text = `${parts.join(' · ')} left`;
  return { deadline, past: false, weeks, summers, weekends, weeksWithKids, text };
}

/** Open plans soonest deadline first (no deadline last, then newest), and done ones most recent first. */
export function sortPlans(plans = [], calendar) {
  const withDates = plans.map((plan) => ({ plan, deadline: deadlineDate(plan, calendar) }));
  const open = withDates.filter((item) => !item.plan.doneOn)
    .sort((left, right) => (left.deadline || '9999').localeCompare(right.deadline || '9999') || String(left.plan.title).localeCompare(String(right.plan.title)))
    .map((item) => item.plan);
  const done = plans.filter((plan) => plan.doneOn).sort((left, right) => right.doneOn.localeCompare(left.doneOn));
  return { open, done };
}

export const plansFor = (plans, personId) => plans.filter((plan) => (plan.who || []).includes(personId));

/** The start (YYYY-MM-DD) of each of your next `count` stretches with the kids, from today. */
export function upcomingWeeksWithKids(custodySchedule, today, count = 8) {
  if (!custodySchedule?.enabled || !custodySchedule?.nextStartDate) return [];
  const starts = [];
  const first = getCustodyWeekStatus(custodySchedule, parseDateId(today));
  if (!first) return [];
  let start = first.withYou ? first.start : first.changeDate;
  while (starts.length < count) {
    starts.push(start);
    const status = getCustodyWeekStatus(custodySchedule, parseDateId(start));
    start = status.nextStart;
  }
  return starts;
}

/** Open plans placed in the stretch with the kids that starts on `weekStart`. */
export const plansForWeek = (plans, weekStart) => plans.filter((plan) => !plan.doneOn && plan.plannedWeekStart === weekStart);

const clean = (value, max) => String(value || '').trim().slice(0, max);

/** The document saved at plans/{id}: owner-only unless shared. */
export function buildPlan(form, calendar) {
  const ids = new Set(people(calendar).map((item) => item.id));
  const who = (form.who || []).filter((id) => ids.has(id));
  let deadline = null;
  if (form.deadlineKind === 'age' && ids.has(form.deadlinePersonId) && Number(form.deadlineAge) > 0) {
    deadline = { kind: 'age', personId: form.deadlinePersonId, age: Math.round(Number(form.deadlineAge)) };
  } else if (form.deadlineKind === 'season' && SEASONS[form.deadlineSeason] && Number(form.deadlineYear) > 1900) {
    deadline = { kind: 'season', season: form.deadlineSeason, year: Math.round(Number(form.deadlineYear)) };
  } else if (form.deadlineKind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(form.deadlineDate || '')) {
    deadline = { kind: 'date', date: form.deadlineDate };
  }
  return {
    title: clean(form.title, 200),
    notes: clean(form.notes, 2000),
    who: who.length ? who : ['me'],
    deadline,
    plannedWeekStart: /^\d{4}-\d{2}-\d{2}$/.test(form.plannedWeekStart || '') ? form.plannedWeekStart : '',
    doneOn: /^\d{4}-\d{2}-\d{2}$/.test(form.doneOn || '') ? form.doneOn : '',
    visibility: form.shareWithViewers ? 'viewers' : 'ownerOnly'
  };
}

/** The form for a plan (blank, or an existing one to edit). */
export function planForm(plan = null, today = formatDateId(new Date())) {
  const deadline = plan?.deadline || null;
  return {
    title: plan?.title || '',
    notes: plan?.notes || '',
    who: plan?.who || ['me'],
    deadlineKind: deadline?.kind || '',
    deadlinePersonId: deadline?.personId || 'me',
    deadlineAge: deadline?.age || '',
    deadlineSeason: deadline?.season || 'summer',
    deadlineYear: deadline?.year || Number(today.slice(0, 4)),
    deadlineDate: deadline?.date || '',
    plannedWeekStart: plan?.plannedWeekStart || '',
    doneOn: plan?.doneOn || '',
    shareWithViewers: plan?.visibility === 'viewers'
  };
}

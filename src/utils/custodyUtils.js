import { addDays, addYears, daysBetween, formatDateId, toLocalDate } from './dateUtils.js';

// `nextStartDate` keeps its old name, but it is any day a stretch with you began or will begin: the schedule repeats
// from it both ways, so an old date still places this week correctly.
export const defaultCustodySchedule = {
  enabled: false,
  nextStartDate: '',
  cycleWeeks: 2,
  withParentWeeks: 1,
  childIds: [],
  countUntilChildAge: 18
};

function maxDate(a, b) {
  return toLocalDate(a) > toLocalDate(b) ? toLocalDate(a) : toLocalDate(b);
}

function minDate(a, b) {
  return toLocalDate(a) < toLocalDate(b) ? toLocalDate(a) : toLocalDate(b);
}

function scheduleLengths(custody) {
  const cycleDays = Math.max(1, Number(custody.cycleWeeks || 2)) * 7;
  const withDays = Math.min(cycleDays, Math.max(1, Number(custody.withParentWeeks || 1)) * 7);
  return { cycleDays, withDays };
}

// The day the stretch with you began in the cycle that holds `day`.
function cycleStart(anchor, day, cycleDays) {
  const offset = ((daysBetween(anchor, day) % cycleDays) + cycleDays) % cycleDays;
  return addDays(day, -offset);
}

// Who has the kids on `now`. With you: from `start` to `end`, to their other parent on `changeDate`, back on
// `nextStart`. With their other parent: until `end`, back with you on `changeDate`.
export function getCustodyWeekStatus(custodySchedule, now = new Date()) {
  const custody = { ...defaultCustodySchedule, ...(custodySchedule || {}) };
  if (!custody.enabled || !custody.nextStartDate) return null;
  const { cycleDays, withDays } = scheduleLengths(custody);
  if (withDays >= cycleDays) return { withYou: true, always: true };
  const today = toLocalDate(now);
  const cycle = cycleStart(custody.nextStartDate, today, cycleDays);
  const withYou = daysBetween(cycle, today) < withDays;
  return {
    withYou,
    always: false,
    start: formatDateId(withYou ? cycle : addDays(cycle, withDays)),
    end: formatDateId(addDays(cycle, (withYou ? withDays : cycleDays) - 1)),
    changeDate: formatDateId(addDays(cycle, withYou ? withDays : cycleDays)),
    nextStart: formatDateId(addDays(cycle, cycleDays))
  };
}

// Days with you from today up to, not including, `end`, and how many of your weeks with them they fall in. A week
// counts while any day of it is still to come, so the week you're in counts until it ends.
function countTimeWithYou(anchor, { cycleDays, withDays }, today, end) {
  const lastDay = addDays(end, -1);
  let weeks = 0;
  let days = 0;
  for (let cycle = cycleStart(anchor, today, cycleDays); cycle <= lastDay; cycle = addDays(cycle, cycleDays)) {
    for (let offset = 0; offset < withDays; offset += 7) {
      const from = maxDate(addDays(cycle, offset), today);
      const to = minDate(addDays(cycle, offset + 6), lastDay);
      if (from <= to) {
        weeks += 1;
        days += daysBetween(from, to) + 1;
      }
    }
  }
  return { weeks, days };
}

// The time left with each child on the schedule, counted until the day they turn `countUntilChildAge` (and never past
// your own target age), plus who has them now.
export function getCustodyStats(calendar, now = new Date()) {
  const custody = { ...defaultCustodySchedule, ...(calendar?.custodySchedule || {}) };
  const selectedChildren = (calendar?.children || []).filter((child) => custody.childIds.includes(child.id) && child.birthDate);
  if (!custody.enabled || !custody.nextStartDate || selectedChildren.length === 0) return null;

  const today = toLocalDate(now);
  const targetEnd = toLocalDate(calendar.targetEndDate || addYears(calendar.birthDate, calendar.targetAge));
  const untilAge = Number(custody.countUntilChildAge || 18);
  const lengths = scheduleLengths(custody);
  const children = selectedChildren.map((child) => {
    const untilDate = addYears(child.birthDate, untilAge);
    const { weeks, days } = countTimeWithYou(custody.nextStartDate, lengths, today, minDate(untilDate, targetEnd));
    return { id: child.id, name: child.name, untilDate: formatDateId(untilDate), weeksRemaining: weeks, daysRemaining: days };
  });

  return { status: getCustodyWeekStatus(custody, today), untilAge, children };
}

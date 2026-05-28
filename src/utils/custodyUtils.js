import { addDays, addYears, daysBetween, formatDateId, toLocalDate } from './dateUtils.js';

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

export function getCustodyStats(calendar, now = new Date()) {
  const custody = { ...defaultCustodySchedule, ...(calendar?.custodySchedule || {}) };
  const selectedChildren = (calendar?.children || []).filter((child) => custody.childIds.includes(child.id));

  if (!custody.enabled || !custody.nextStartDate || selectedChildren.length === 0) {
    return null;
  }

  const today = toLocalDate(now);
  const targetEnd = toLocalDate(calendar.targetEndDate || addYears(calendar.birthDate, calendar.targetAge));
  const childCutoffs = selectedChildren
    .filter((child) => child.birthDate)
    .map((child) => addYears(child.birthDate, Number(custody.countUntilChildAge || 18)));

  if (childCutoffs.length === 0) return null;

  const finalCutoff = minDate(targetEnd, childCutoffs.reduce((latest, cutoff) => maxDate(latest, cutoff)));
  const countStart = maxDate(today, custody.nextStartDate);
  if (countStart > finalCutoff) {
    return {
      childNames: selectedChildren.map((child) => child.name),
      daysRemaining: 0,
      weeksRemaining: 0,
      nextStartDate: custody.nextStartDate,
      throughDate: formatDateId(finalCutoff)
    };
  }

  const cycleDays = Math.max(1, Number(custody.cycleWeeks || 2)) * 7;
  const withDays = Math.max(1, Number(custody.withParentWeeks || 1)) * 7;
  let custodyStart = toLocalDate(custody.nextStartDate);

  while (addDays(custodyStart, cycleDays) <= countStart) {
    custodyStart = addDays(custodyStart, cycleDays);
  }

  let daysRemaining = 0;
  for (let periodStart = custodyStart; periodStart <= finalCutoff; periodStart = addDays(periodStart, cycleDays)) {
    const periodEnd = addDays(periodStart, withDays - 1);
    const overlapStart = maxDate(periodStart, countStart);
    const overlapEnd = minDate(periodEnd, finalCutoff);
    if (overlapStart <= overlapEnd) {
      daysRemaining += daysBetween(overlapStart, overlapEnd) + 1;
    }
  }

  return {
    childNames: selectedChildren.map((child) => child.name),
    daysRemaining,
    weeksRemaining: Math.floor(daysRemaining / 7),
    nextStartDate: custody.nextStartDate,
    throughDate: formatDateId(finalCutoff)
  };
}

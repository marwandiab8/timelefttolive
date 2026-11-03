import { addDays, addYears, daysBetween, formatDateId, toLocalDate } from './dateUtils.js';

// What is still ahead, counted in the things a life is lived in rather than in weeks: weekends, summers,
// Christmases and birthdays. Every count runs from today up to, not including, `until`.

// How many times a yearly date (month 1 to 12, day) falls in [from, until).
export function countYearly(month, day, from, until) {
  const start = toLocalDate(from);
  const end = toLocalDate(until);
  let count = 0;
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    const date = new Date(year, month - 1, day);
    if (date >= start && date < end) count += 1;
  }
  return count;
}

// Saturdays in [from, until).
export function countWeekends(from, until) {
  const start = toLocalDate(from);
  const end = toLocalDate(until);
  const firstSaturday = addDays(start, (6 - start.getDay() + 7) % 7);
  if (firstSaturday >= end) return 0;
  return Math.floor((daysBetween(firstSaturday, end) - 1) / 7) + 1;
}

// Summer holidays (July and August) not over yet and begun before `until`, so the one under way counts.
export function countSummers(from, until) {
  const start = toLocalDate(from);
  const end = toLocalDate(until);
  let count = 0;
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    if (new Date(year, 7, 31) >= start && new Date(year, 6, 1) < end) count += 1;
  }
  return count;
}

// The next birthday on or after today, and the age it brings.
export function getNextBirthday(birthDate, now = new Date()) {
  const birth = toLocalDate(birthDate);
  const today = toLocalDate(now);
  let age = today.getFullYear() - birth.getFullYear();
  if (addYears(birth, age) < today) age += 1;
  return { dateId: formatDateId(addYears(birth, age)), age };
}

export function getLifeAhead(calendar, now = new Date()) {
  const today = toLocalDate(now);
  const targetEnd = toLocalDate(calendar.targetEndDate || addYears(calendar.birthDate, calendar.targetAge));
  const birth = toLocalDate(calendar.birthDate);
  return {
    targetAge: Number(calendar.targetAge),
    weekends: countWeekends(today, targetEnd),
    summers: countSummers(today, targetEnd),
    christmases: countYearly(12, 25, today, targetEnd),
    // Birthdays run through the one you are aiming for.
    birthdays: countYearly(birth.getMonth() + 1, birth.getDate(), today, addDays(targetEnd, 1))
  };
}

export function getChildAhead(child, untilAge, now = new Date()) {
  const today = toLocalDate(now);
  const untilDate = addYears(child.birthDate, untilAge);
  const birth = toLocalDate(child.birthDate);
  return {
    summers: countSummers(today, untilDate),
    christmases: countYearly(12, 25, today, untilDate),
    birthdays: countYearly(birth.getMonth() + 1, birth.getDate(), today, untilDate)
  };
}

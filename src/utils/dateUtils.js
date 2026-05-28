const DAY_MS = 24 * 60 * 60 * 1000;

export function toLocalDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string') {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function formatDateId(date) {
  const local = toLocalDate(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateId(dateId) {
  return toLocalDate(dateId);
}

export function addDays(date, days) {
  const local = toLocalDate(date);
  local.setDate(local.getDate() + days);
  return local;
}

export function addYears(date, years) {
  const local = toLocalDate(date);
  local.setFullYear(local.getFullYear() + Number(years));
  return local;
}

export function addMonths(date, months) {
  const local = toLocalDate(date);
  const day = local.getDate();
  const target = new Date(local.getFullYear(), local.getMonth() + Number(months), 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function utcDayNumber(date) {
  const local = toLocalDate(date);
  return Math.floor(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()) / DAY_MS);
}

export function getWeekStart(date) {
  const local = toLocalDate(date);
  const day = local.getDay();
  return addDays(local, -day);
}

export function getWeekEnd(date) {
  return addDays(getWeekStart(date), 6);
}

export function getDaysInWeek(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function getDaysInRange(start, end) {
  const total = Math.max(1, daysBetween(start, end) + 1);
  return Array.from({ length: total }, (_, index) => addDays(start, index));
}

export function daysBetween(start, end) {
  return utcDayNumber(end) - utcDayNumber(start);
}

export function getWeeksBetween(birthDate, targetEndDate) {
  const start = toLocalDate(birthDate);
  const end = toLocalDate(targetEndDate);
  const weeks = [];
  for (let current = new Date(start); current < end; current = addDays(current, 7)) {
    weeks.push({
      start: new Date(current),
      end: addDays(current, 6),
      dateId: formatDateId(current)
    });
  }
  return weeks;
}

export function getLifeYearsWeeks(birthDate, targetAge) {
  const birth = toLocalDate(birthDate);
  const rows = [];

  for (let age = 0; age < Number(targetAge); age += 1) {
    const yearStart = addYears(birth, age);
    const nextYearStart = addYears(birth, age + 1);
    const weeks = Array.from({ length: 52 }, (_, weekIndex) => {
      const start = addDays(yearStart, weekIndex * 7);
      // Calendar years are 365/366 days, but the visual contract is 52 cells per age row.
      // The final cell absorbs the year tail so every date remains clickable.
      const end = weekIndex === 51 ? addDays(nextYearStart, -1) : addDays(start, 6);
      return {
        age,
        weekIndex,
        start,
        end,
        dateId: formatDateId(start)
      };
    });
    rows.push({ age, label: `Age ${age}`, weeks });
  }

  return rows;
}

export function getLifeYearRange(birthDate, age) {
  const start = addYears(birthDate, Number(age));
  const end = addDays(addYears(birthDate, Number(age) + 1), -1);
  return { start, end };
}

export function getMonthStart(date) {
  const local = toLocalDate(date);
  return new Date(local.getFullYear(), local.getMonth(), 1);
}

export function getMonthEnd(date) {
  const local = toLocalDate(date);
  return new Date(local.getFullYear(), local.getMonth() + 1, 0);
}

export function getMonthsForLifeYear(birthDate, age) {
  const lifeYear = getLifeYearRange(birthDate, age);
  return Array.from({ length: 12 }, (_, index) => {
    const rangeStart = addMonths(lifeYear.start, index);
    const rangeEnd = index === 11 ? lifeYear.end : addDays(addMonths(lifeYear.start, index + 1), -1);
    const name = rangeStart.getMonth() === rangeEnd.getMonth()
      ? rangeStart.toLocaleString(undefined, { month: 'long', year: 'numeric' })
      : `${rangeStart.toLocaleString(undefined, { month: 'short' })} ${rangeStart.getDate()} - ${rangeEnd.toLocaleString(undefined, { month: 'short' })} ${rangeEnd.getDate()}, ${rangeEnd.getFullYear()}`;
    return {
      id: formatDateId(rangeStart),
      monthStart: getMonthStart(rangeStart),
      monthEnd: getMonthEnd(rangeStart),
      rangeStart,
      rangeEnd,
      name
    };
  });
}

export function getWeeksForMonth(monthStartDate) {
  const monthStart = getMonthStart(monthStartDate);
  const monthEnd = getMonthEnd(monthStartDate);
  return getWeeksForRange(monthStart, monthEnd);
}

export function getWeeksForRange(startDate, endDate) {
  const rangeStart = toLocalDate(startDate);
  const rangeEnd = toLocalDate(endDate);
  const weeks = [];
  for (let cursor = getWeekStart(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 7)) {
    const start = new Date(cursor);
    const end = addDays(start, 6);
    weeks.push({
      start,
      end,
      dateId: formatDateId(start),
      days: getDaysInRange(start, end)
    });
  }
  return weeks;
}

export function getDaysForWeek(weekStartDate) {
  return getDaysInWeek(getWeekStart(weekStartDate));
}

export function eventIntersectsWeek(event, week) {
  if (!event?.startDate || !event?.endDate) return false;
  const eventStart = toLocalDate(event.startDate);
  const eventEnd = toLocalDate(event.endDate);
  return eventStart <= week.end && eventEnd >= week.start;
}

export function eventIntersectsDate(event, dateId) {
  return event?.startDate && event?.endDate && isDateInRange(dateId, event.startDate, event.endDate);
}

export function eventIntersectsMonth(event, monthStart, monthEnd) {
  if (!event?.startDate || !event?.endDate) return false;
  const eventStart = toLocalDate(event.startDate);
  const eventEnd = toLocalDate(event.endDate);
  return eventStart <= toLocalDate(monthEnd) && eventEnd >= toLocalDate(monthStart);
}

export function getEventsForDate(events, dateId) {
  return events.filter((event) => eventIntersectsDate(event, dateId));
}

export function isDateInRange(date, start, end) {
  const local = toLocalDate(date);
  return local >= toLocalDate(start) && local <= toLocalDate(end);
}

export function getLifeStats(birthDate, targetAge, now = new Date()) {
  const birth = toLocalDate(birthDate);
  const today = toLocalDate(now);
  const targetEndDate = addYears(birth, targetAge);
  const totalDays = Math.max(1, daysBetween(birth, targetEndDate));
  const livedDays = Math.min(Math.max(daysBetween(birth, today), 0), totalDays);
  const remainingDays = Math.max(daysBetween(today, targetEndDate), 0);
  const currentAge = Math.max(0, today.getFullYear() - birth.getFullYear() - (
    today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0
  ));

  return {
    targetEndDate: formatDateId(targetEndDate),
    currentAge,
    targetAge: Number(targetAge),
    weeksLived: Math.floor(livedDays / 7),
    weeksRemaining: Math.ceil(remainingDays / 7),
    daysRemaining: remainingDays,
    percentageUsed: Math.min(100, (livedDays / totalDays) * 100),
    percentageRemaining: Math.max(0, (remainingDays / totalDays) * 100),
    remainingText: `${Math.floor(remainingDays / 365)}y ${Math.floor((remainingDays % 365) / 30)}m ${Math.floor((remainingDays % 30) / 7)}w ${remainingDays % 7}d`
  };
}

export function isCurrentWeek(week, now = new Date()) {
  const today = toLocalDate(now);
  return today >= week.start && today <= week.end;
}

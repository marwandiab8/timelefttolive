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

export function eventIntersectsWeek(event, week) {
  if (!event?.startDate || !event?.endDate) return false;
  const eventStart = toLocalDate(event.startDate);
  const eventEnd = toLocalDate(event.endDate);
  return eventStart <= week.end && eventEnd >= week.start;
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

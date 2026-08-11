const ACTIVITY_COLORS = [
  '#4f8cff',
  '#58c6a6',
  '#f2b84b',
  '#a979e8',
  '#ef7d6c',
  '#50b8d8',
  '#db75a6',
  '#8cad55'
];

export function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (Number.isFinite(value.seconds)) {
    return new Date((value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getLocalDateId(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalDayBounds(dateId) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateId || '');
  if (!match) return null;
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (getLocalDateId(start) !== dateId) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function getEventTime(event) {
  return toJsDate(event?.occurredAt) || toJsDate(event?.startAt);
}

export function getActivityLabel(event) {
  const raw = event?.activityFamily || event?.categoryId || event?.eventClass || event?.eventType || 'Other';
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getDailySummary(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const sources = new Set(safeEvents.map((event) => event.sourceApp).filter(Boolean));
  const activeSeconds = safeEvents.reduce((total, event) => {
    const duration = Number(event.durationSeconds);
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  const completed = safeEvents.filter((event) => (
    event.eventClass === 'completed_activity'
    || /(^|[_-])completed?([_-]|$)/i.test(event.eventType || '')
  )).length;

  return {
    eventCount: safeEvents.length,
    activeSeconds,
    sourceCount: sources.size,
    completedCount: completed
  };
}

export function buildActivityBreakdown(events) {
  const groups = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const label = getActivityLabel(event);
    const duration = Number(event.durationSeconds);
    const current = groups.get(label) || { label, seconds: 0, count: 0, timedCount: 0 };
    current.count += 1;
    if (Number.isFinite(duration) && duration > 0) {
      current.seconds += duration;
      current.timedCount += 1;
    }
    groups.set(label, current);
  });

  const usesDuration = groups.size > 0 && [...groups.values()].every((group) => group.timedCount === group.count);
  return [...groups.values()]
    .map((group, index) => ({
      ...group,
      value: usesDuration ? group.seconds : group.count,
      usesDuration,
      color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

export function getDonutBackground(breakdown) {
  const total = breakdown.reduce((sum, item) => sum + item.value, 0);
  if (!total) return 'conic-gradient(var(--activity-track) 0 100%)';
  let cursor = 0;
  const stops = breakdown.map((item) => {
    const start = cursor;
    cursor += (item.value / total) * 100;
    return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function sortLifeEvents(events) {
  return [...(Array.isArray(events) ? events : [])].sort((left, right) => {
    const leftTime = getEventTime(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightTime = getEventTime(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

export function formatDuration(seconds) {
  const totalMinutes = Math.round(Math.max(0, Number(seconds) || 0) / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function buildDailyInsight(events) {
  const summary = getDailySummary(events);
  if (summary.eventCount === 0) {
    return 'No life events were recorded for this day. Connected sources will appear here as they send activity.';
  }

  const breakdown = buildActivityBreakdown(events);
  const leading = breakdown[0];
  const sourceText = summary.sourceCount === 1 ? '1 connected source' : `${summary.sourceCount} connected sources`;
  const durationText = summary.activeSeconds > 0 ? ` with ${formatDuration(summary.activeSeconds)} of tracked time` : '';
  return `${summary.eventCount} life ${summary.eventCount === 1 ? 'event' : 'events'} arrived from ${sourceText}${durationText}. ${leading.label} was the leading activity.`;
}

export { ACTIVITY_COLORS };

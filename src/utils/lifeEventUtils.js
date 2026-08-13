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

export function getDateIdInTimeZone(date, timeZone) {
  const safeDate = toJsDate(date);
  if (!safeDate) return '';
  if (!timeZone) return getLocalDateId(safeDate);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(safeDate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch (_error) {
    return getLocalDateId(safeDate);
  }
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
  return toJsDate(event?.startAt) || toJsDate(event?.occurredAt);
}

export function getEventEndTime(event) {
  return toJsDate(event?.endAt);
}

export function getEventReceivedTime(event) {
  return toJsDate(event?.receivedAt);
}

export function getEventSentTime(event) {
  return toJsDate(event?.sentAt)
    || toJsDate(event?.metadata?.sentAt)
    || toJsDate(event?.metadata?.sentAtIso)
    || toJsDate(event?.metadata?.deliveryStartedAt);
}

export function getEventDurationSeconds(event) {
  const rawDuration = event?.durationSeconds;
  const reported = rawDuration === null || rawDuration === undefined || rawDuration === ''
    ? null
    : Number(rawDuration);
  if (Number.isFinite(reported) && reported >= 0) return reported;
  const start = getEventTime(event);
  const end = getEventEndTime(event);
  if (!start || !end || end < start) return null;
  return (end.getTime() - start.getTime()) / 1000;
}

export function getDeliveryLatencySeconds(event) {
  const delivery = getEventSentTime(event) || getEventReceivedTime(event);
  const reference = getEventEndTime(event) || getEventTime(event);
  if (!delivery || !reference) return null;
  const seconds = (delivery.getTime() - reference.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function getActivityLabel(event) {
  const raw = event?.activityFamily || event?.categoryId || event?.eventClass || event?.eventType || 'Other';
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getTallyActivityLabel(event) {
  const eventType = String(event?.eventType || '').trim().toLowerCase();
  const boundaryMatch = /^(?:arrive|leave|start|finish|stop)[_-](.+)$/.exec(eventType);
  const activityToken = String(boundaryMatch?.[1] || event?.activityFamily || getActivityLabel(event))
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (activityToken.includes('workout') || activityToken === 'gym' || eventType.includes('workout')) return 'Gym';
  if (activityToken === 'work' || activityToken === 'workplace' || /(?:^|_)work(?:_|$)/.test(eventType)) return 'Work';
  if (activityToken === 'home' || /(?:^|_)home(?:_|$)/.test(eventType)) return 'Home';
  if (activityToken.includes('spotify') || activityToken.includes('music') || activityToken.includes('listening')) return 'Music';
  if (activityToken === 'location') return 'Location';
  return activityToken
    .replace(/_+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function filterLifeEvents(events, selection) {
  const safeEvents = Array.isArray(events) ? events : [];
  if (!selection) return safeEvents;
  if (selection.kind === 'event') {
    return safeEvents.filter((event) => event.id === selection.value);
  }
  if (selection.kind === 'source') {
    const source = String(selection.value || '').toLowerCase();
    return safeEvents.filter((event) => String(event.sourceApp || '').toLowerCase() === source);
  }
  if (selection.kind === 'category') {
    const category = String(selection.value || '').toLowerCase();
    return safeEvents.filter((event) => {
      if (selection.tally) return getTallyActivityLabel(event).toLowerCase() === category;
      const label = getActivityLabel(event).toLowerCase();
      if (category === 'gym') return label === 'gym' || label === 'workout';
      return label === category;
    });
  }
  return safeEvents;
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

function boundaryDescriptor(event) {
  const eventType = String(event?.eventType || '').toLowerCase();
  let phase = '';
  let activity = '';
  if (eventType.startsWith('arrive_')) {
    phase = 'start';
    activity = eventType.slice('arrive_'.length);
  } else if (eventType.startsWith('leave_')) {
    phase = 'end';
    activity = eventType.slice('leave_'.length);
  } else if (eventType.startsWith('start_')) {
    phase = 'start';
    activity = eventType.slice('start_'.length);
  } else if (eventType.startsWith('finish_')) {
    phase = 'end';
    activity = eventType.slice('finish_'.length);
  } else if (eventType.startsWith('stop_')) {
    phase = 'end';
    activity = eventType.slice('stop_'.length);
  }
  if (!phase || !activity) return null;
  const location = String(event?.location?.label || '').trim().toLowerCase();
  const family = String(event?.activityFamily || activity).trim().toLowerCase();
  return {
    phase,
    activity,
    key: `${family}|${location}`
  };
}

export function buildActivitySessions(events) {
  const safeEvents = sortLifeEvents(events);
  const sessions = [];
  const seen = new Set();

  safeEvents.forEach((event) => {
    const start = toJsDate(event?.startAt);
    const end = getEventEndTime(event);
    if (!start || !end || end <= start) return;
    const signature = `${start.toISOString()}|${end.toISOString()}|${event.id || ''}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    sessions.push({
      id: `timed-${event.id || signature}`,
      title: event.title || getActivityLabel(event),
      sourceApp: event.sourceApp || '',
      timezone: event.timezone || '',
      startAt: start,
      endAt: end,
      durationSeconds: (end.getTime() - start.getTime()) / 1000,
      activityLabel: getTallyActivityLabel(event),
      kind: 'reported'
    });
  });

  const openBoundaries = new Map();
  safeEvents.forEach((event) => {
    const descriptor = boundaryDescriptor(event);
    const eventTime = getEventTime(event);
    if (!descriptor || !eventTime) return;
    if (descriptor.phase === 'start') {
      const starts = openBoundaries.get(descriptor.key) || [];
      starts.push({ event, eventTime, descriptor });
      openBoundaries.set(descriptor.key, starts);
      return;
    }

    const starts = openBoundaries.get(descriptor.key) || [];
    const start = starts.pop();
    if (!start || eventTime <= start.eventTime) return;
    openBoundaries.set(descriptor.key, starts);
    const activityLabel = getTallyActivityLabel(start.event);
    const title = `${activityLabel} session`;
    const signature = `${start.eventTime.toISOString()}|${eventTime.toISOString()}|${title}`;
    if (seen.has(signature)) return;
    const overlapsReportedSession = sessions.some((session) => {
      if (session.kind !== 'reported') return false;
      if (session.activityLabel !== activityLabel) return false;
      const overlapStart = Math.max(session.startAt.getTime(), start.eventTime.getTime());
      const overlapEnd = Math.min(session.endAt.getTime(), eventTime.getTime());
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const shorterDuration = Math.min(
        session.endAt.getTime() - session.startAt.getTime(),
        eventTime.getTime() - start.eventTime.getTime()
      );
      return shorterDuration > 0 && overlap / shorterDuration >= 0.8;
    });
    if (overlapsReportedSession) return;
    seen.add(signature);
    sessions.push({
      id: `paired-${start.event.id || start.eventTime.getTime()}-${event.id || eventTime.getTime()}`,
      title,
      sourceApp: start.event.sourceApp || event.sourceApp || '',
      timezone: start.event.timezone || event.timezone || '',
      startAt: start.eventTime,
      endAt: eventTime,
      durationSeconds: (eventTime.getTime() - start.eventTime.getTime()) / 1000,
      activityLabel,
      kind: 'paired'
    });
  });

  return sessions.sort((left, right) => left.startAt - right.startAt);
}

export function getActivityTallyRange(rangeId, now = new Date()) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);

  if (rangeId === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { id: 'year', label: `${now.getFullYear()}`, start, end };
  }
  if (rangeId === '30d' || rangeId === '7d') {
    const days = rangeId === '30d' ? 30 : 7;
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    return { id: rangeId, label: `Last ${days} days`, start, end };
  }
  return { id: 'all', label: 'All time', start: null, end: null };
}

export function filterLifeEventsByRange(events, range) {
  const safeEvents = Array.isArray(events) ? events : [];
  if (!range?.start && !range?.end) return safeEvents;
  const startMs = range?.start?.getTime?.() ?? Number.NEGATIVE_INFINITY;
  const endMs = range?.end?.getTime?.() ?? Number.POSITIVE_INFINITY;
  return safeEvents.filter((event) => {
    const time = getEventTime(event)?.getTime();
    return Number.isFinite(time) && time >= startMs && time < endMs;
  });
}

export function buildActivityTallies(events) {
  const safeEvents = sortLifeEvents(events);
  const sessions = buildActivitySessions(safeEvents);
  const groups = new Map();

  function getGroup(label) {
    if (!groups.has(label)) {
      groups.set(label, {
        label,
        eventCount: 0,
        sessionCount: 0,
        totalSeconds: 0,
        days: new Set(),
        sources: new Set(),
        firstAt: null,
        lastAt: null
      });
    }
    return groups.get(label);
  }

  safeEvents.forEach((event) => {
    const label = getTallyActivityLabel(event);
    const group = getGroup(label);
    const time = getEventTime(event);
    const end = getEventEndTime(event) || time;
    group.eventCount += 1;
    if (event.sourceApp) group.sources.add(event.sourceApp);
    if (time) {
      group.days.add(getDateIdInTimeZone(time, event.timezone));
      if (!group.firstAt || time < group.firstAt) group.firstAt = time;
    }
    if (end && (!group.lastAt || end > group.lastAt)) group.lastAt = end;
  });

  sessions.forEach((session) => {
    const group = getGroup(session.activityLabel || 'Other');
    group.sessionCount += 1;
    group.totalSeconds += session.durationSeconds;
    group.days.add(getDateIdInTimeZone(session.startAt, session.timezone));
    if (session.sourceApp) group.sources.add(session.sourceApp);
    if (!group.firstAt || session.startAt < group.firstAt) group.firstAt = session.startAt;
    if (!group.lastAt || session.endAt > group.lastAt) group.lastAt = session.endAt;
  });

  return [...groups.values()]
    .map((group) => ({
      label: group.label,
      eventCount: group.eventCount,
      sessionCount: group.sessionCount,
      totalSeconds: group.totalSeconds,
      averageSeconds: group.sessionCount > 0 ? group.totalSeconds / group.sessionCount : 0,
      dayCount: group.days.size,
      sourceCount: group.sources.size,
      firstAt: group.firstAt,
      lastAt: group.lastAt
    }))
    .sort((left, right) => (
      right.totalSeconds - left.totalSeconds
      || right.dayCount - left.dayCount
      || right.eventCount - left.eventCount
      || left.label.localeCompare(right.label)
    ))
    .map((group, index) => ({ ...group, color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length] }));
}

export function buildActivityAnalysis(events) {
  const safeEvents = sortLifeEvents(events);
  const sessions = buildActivitySessions(safeEvents);
  const sources = new Set(safeEvents.map((event) => event.sourceApp).filter(Boolean));
  const eventTypes = new Map();
  const deliveryLatencies = [];
  const activityDays = new Set();
  let firstAt = null;
  let lastAt = null;

  safeEvents.forEach((event) => {
    const start = getEventTime(event);
    const end = getEventEndTime(event) || start;
    const latency = getDeliveryLatencySeconds(event);
    const eventType = String(event.eventType || 'activity').replace(/[_-]+/g, ' ');
    eventTypes.set(eventType, (eventTypes.get(eventType) || 0) + 1);
    if (start && (!firstAt || start < firstAt)) firstAt = start;
    if (start) activityDays.add(getDateIdInTimeZone(start, event.timezone));
    if (end && (!lastAt || end > lastAt)) lastAt = end;
    if (Number.isFinite(latency)) deliveryLatencies.push(latency);
  });

  const averageDeliverySeconds = deliveryLatencies.length
    ? deliveryLatencies.reduce((sum, value) => sum + value, 0) / deliveryLatencies.length
    : null;
  const trackedSeconds = sessions.reduce((total, session) => total + session.durationSeconds, 0);

  return {
    eventCount: safeEvents.length,
    sourceCount: sources.size,
    sessionCount: sessions.length,
    activityDayCount: activityDays.size,
    trackedSeconds,
    averageSessionSeconds: sessions.length > 0 ? trackedSeconds / sessions.length : 0,
    firstAt,
    lastAt,
    spanSeconds: firstAt && lastAt && lastAt >= firstAt
      ? (lastAt.getTime() - firstAt.getTime()) / 1000
      : 0,
    averageDeliverySeconds,
    deliveredCount: deliveryLatencies.length,
    eventTypes: [...eventTypes.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    sessions
  };
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

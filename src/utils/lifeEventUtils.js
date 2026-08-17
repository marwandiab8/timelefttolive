const ACTIVITY_COLORS = [
  '#4f8cff', '#58c6a6', '#f2b84b', '#a979e8',
  '#ef7d6c', '#50b8d8', '#db75a6', '#8cad55'
];

export const APP_TIMEZONE = 'America/Toronto';

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

function zonedParts(value, timeZone = APP_TIMEZONE) {
  const date = toJsDate(value);
  if (!date) return null;
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

function zonedDateTimeToDate(parts, timeZone = APP_TIMEZONE) {
  const desired = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour || 0, parts.minute || 0, parts.second || 0
  );
  let instant = new Date(desired);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(instant, timeZone);
    const localAsUtc = Date.UTC(
      actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second
    );
    const next = new Date(desired - (localAsUtc - (Math.floor(instant.getTime() / 1000) * 1000)));
    if (next.getTime() === instant.getTime()) break;
    instant = next;
  }
  return instant;
}

function dateIdFromParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getDateIdInTimezone(value, timeZone = APP_TIMEZONE) {
  const parts = zonedParts(value, timeZone);
  return parts ? dateIdFromParts(parts) : '';
}

export const getDateIdInTimeZone = getDateIdInTimezone;

export function getLocalDateId(date = new Date(), timeZone = APP_TIMEZONE) {
  return getDateIdInTimezone(date, timeZone);
}

export function getPeriodBounds(period = 'day', dateId = getLocalDateId(), timeZone = APP_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateId || '');
  if (!match) return null;
  let parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const candidate = zonedDateTimeToDate(parts, timeZone);
  if (getDateIdInTimezone(candidate, timeZone) !== dateId) return null;

  if (period === 'week') {
    const dayName = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(candidate);
    const sundayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);
    const mondayOffset = (sundayIndex + 6) % 7;
    const localNoon = zonedDateTimeToDate({ ...parts, hour: 12 }, timeZone);
    localNoon.setUTCDate(localNoon.getUTCDate() - mondayOffset);
    const monday = zonedParts(localNoon, timeZone);
    parts = { year: monday.year, month: monday.month, day: monday.day };
  } else if (period === 'month') {
    parts.day = 1;
  } else if (period === 'year') {
    parts.month = 1;
    parts.day = 1;
  }

  const start = zonedDateTimeToDate(parts, timeZone);
  const next = { ...parts };
  if (period === 'year') next.year += 1;
  else if (period === 'month') next.month += 1;
  else next.day += period === 'week' ? 7 : 1;
  const end = zonedDateTimeToDate(next, timeZone);

  return {
    period,
    timezone: timeZone,
    start,
    end,
    startDateId: dateIdFromParts(parts),
    endDateId: getDateIdInTimezone(new Date(end.getTime() - 1), timeZone)
  };
}

export function shiftPeriodDate(dateId, period, amount, timeZone = APP_TIMEZONE) {
  const bounds = getPeriodBounds(period, dateId, timeZone);
  if (!bounds) return dateId;
  const parts = zonedParts(bounds.start, timeZone);
  if (period === 'year') parts.year += amount;
  else if (period === 'month') parts.month += amount;
  else parts.day += amount * (period === 'week' ? 7 : 1);
  return getDateIdInTimezone(zonedDateTimeToDate(parts, timeZone), timeZone);
}

export function getLocalDayBounds(dateId, timeZone = APP_TIMEZONE) {
  return getPeriodBounds('day', dateId, timeZone);
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
  const raw = event?.durationSeconds;
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
    return Number(raw);
  }
  const start = getEventTime(event);
  const end = getEventEndTime(event);
  return start && end && end >= start ? (end.getTime() - start.getTime()) / 1000 : null;
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
  return String(raw).replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getTallyActivityLabel(event) {
  const eventType = String(event?.eventType || '').trim().toLowerCase();
  const boundary = /^(?:arrive|leave|start|finish|stop)[_-](.+)$/.exec(eventType);
  const token = String(boundary?.[1] || event?.activityFamily || event?.categoryId || getActivityLabel(event))
    .trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (token.includes('workout') || token === 'gym' || eventType.includes('workout')) return 'Gym';
  if (token === 'work' || token === 'workplace' || /(?:^|_)work(?:_|$)/.test(eventType)) return 'Work';
  if (token === 'home' || /(?:^|_)home(?:_|$)/.test(eventType)) return 'Home';
  if (token.includes('spotify') || token.includes('music') || token.includes('listening')) return 'Music';
  if (token === 'location') return event?.location?.label || 'Location';
  return token.replace(/_+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function sortLifeEvents(events) {
  return [...(Array.isArray(events) ? events : [])].sort((left, right) => (
    (getEventTime(left)?.getTime() ?? Number.MAX_SAFE_INTEGER)
    - (getEventTime(right)?.getTime() ?? Number.MAX_SAFE_INTEGER)
  ));
}

export function isPointEvent(event) {
  const duration = getEventDurationSeconds(event);
  return !getEventEndTime(event) && !(Number.isFinite(duration) && duration > 0);
}

function boundaryDescriptor(event) {
  const eventType = String(event?.eventType || '').toLowerCase();
  let phase = '';
  let activity = '';
  if (/^(arrive|start)_/.test(eventType)) {
    phase = 'start';
    activity = eventType.replace(/^(arrive|start)_/, '');
  } else if (/^(leave|finish|stop)_/.test(eventType)) {
    phase = 'end';
    activity = eventType.replace(/^(leave|finish|stop)_/, '');
  }
  if (!phase) return null;
  const family = String(event?.activityFamily || activity).trim().toLowerCase();
  const location = String(event?.location?.placeId || event?.location?.label || '').trim().toLowerCase();
  const subject = String(event?.sourceUserId || event?.timeLeftUserId || '').trim().toLowerCase();
  return { phase, key: `${subject}|${family}|${location}` };
}

function intervalForEvent(event, bounds) {
  const start = getEventTime(event);
  if (!start) return null;
  const explicitEnd = getEventEndTime(event);
  const duration = getEventDurationSeconds(event);
  const finish = explicitEnd || (Number.isFinite(duration) && duration > 0
    ? new Date(start.getTime() + (duration * 1000))
    : null);
  if (!finish || finish <= start) return null;
  if (!bounds) {
    return { startAt: start, endAt: finish, durationSeconds: (finish.getTime() - start.getTime()) / 1000 };
  }
  const clippedStart = new Date(Math.max(start.getTime(), bounds.start.getTime()));
  const clippedEnd = new Date(Math.min(finish.getTime(), bounds.end.getTime()));
  if (clippedEnd <= clippedStart) return null;
  return {
    startAt: clippedStart,
    endAt: clippedEnd,
    durationSeconds: (clippedEnd.getTime() - clippedStart.getTime()) / 1000
  };
}

export function buildActivitySessions(events, bounds = null) {
  const safeEvents = sortLifeEvents(events);
  const sessions = [];
  const seen = new Set();
  const openBoundaries = new Map();

  safeEvents.forEach((event) => {
    const interval = intervalForEvent(event, bounds);
    if (interval) {
      const identity = event.id || `${interval.startAt.toISOString()}|${interval.endAt.toISOString()}|${getTallyActivityLabel(event)}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        sessions.push({
          id: `timed-${identity}`,
          event,
          title: event.title || getTallyActivityLabel(event),
          sourceApp: event.sourceApp || '',
          timezone: event.timezone || APP_TIMEZONE,
          category: getTallyActivityLabel(event),
          rawCategory: getActivityLabel(event),
          activityLabel: getTallyActivityLabel(event),
          ...interval,
          kind: 'reported',
          active: false
        });
      }
    }

    const descriptor = boundaryDescriptor(event);
    const eventTime = getEventTime(event);
    if (!descriptor || !eventTime) return;
    if (descriptor.phase === 'start') {
      const starts = openBoundaries.get(descriptor.key) || [];
      starts.push({ event, eventTime });
      openBoundaries.set(descriptor.key, starts);
      return;
    }

    const starts = openBoundaries.get(descriptor.key) || [];
    const start = starts.pop();
    openBoundaries.set(descriptor.key, starts);
    if (!start || eventTime <= start.eventTime) return;
    const identity = `${start.event.id || start.eventTime.getTime()}|${event.id || eventTime.getTime()}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const raw = {
      id: `paired-${identity}`,
      event: start.event,
      title: `${getTallyActivityLabel(start.event)} session`,
      sourceApp: start.event.sourceApp || event.sourceApp || '',
      timezone: start.event.timezone || event.timezone || APP_TIMEZONE,
      category: getTallyActivityLabel(start.event),
      rawCategory: getActivityLabel(start.event),
      activityLabel: getTallyActivityLabel(start.event),
      startAt: start.eventTime,
      endAt: eventTime,
      kind: 'paired',
      active: false
    };
    const clipped = intervalForEvent(raw, bounds);
    if (!clipped) return;
    const duplicate = sessions.some((session) => (
      session.category === raw.category
      && session.startAt.getTime() === clipped.startAt.getTime()
      && session.endAt.getTime() === clipped.endAt.getTime()
    ));
    if (!duplicate) sessions.push({ ...raw, ...clipped });
  });

  openBoundaries.forEach((starts) => starts.forEach(({ event, eventTime }) => {
    if (bounds && (eventTime >= bounds.end || eventTime < new Date(bounds.start.getTime() - (36 * 3600 * 1000)))) return;
    sessions.push({
      id: `active-${event.id || eventTime.getTime()}`,
      event,
      title: event.title || `${getTallyActivityLabel(event)} in progress`,
      sourceApp: event.sourceApp || '',
      timezone: event.timezone || APP_TIMEZONE,
      category: getTallyActivityLabel(event),
      rawCategory: getActivityLabel(event),
      activityLabel: getTallyActivityLabel(event),
      startAt: eventTime,
      endAt: null,
      durationSeconds: null,
      kind: 'active',
      active: true
    });
  }));

  return sessions.sort((left, right) => left.startAt - right.startAt);
}

function allocateIntervals(sessions) {
  const complete = [...sessions]
    .filter((session) => session.endAt)
    .sort((left, right) => left.startAt - right.startAt || right.endAt - left.endAt);
  const accepted = [];
  complete.forEach((session) => {
    let fragments = [{ start: session.startAt.getTime(), end: session.endAt.getTime() }];
    accepted.forEach((prior) => {
      prior.fragments.forEach((occupied) => {
        fragments = fragments.flatMap((fragment) => {
          const overlapStart = Math.max(fragment.start, occupied.start);
          const overlapEnd = Math.min(fragment.end, occupied.end);
          if (overlapEnd <= overlapStart) return [fragment];
          return [
            { start: fragment.start, end: overlapStart },
            { start: overlapEnd, end: fragment.end }
          ].filter((part) => part.end > part.start);
        });
      });
    });
    const allocatedSeconds = fragments.reduce((sum, part) => sum + ((part.end - part.start) / 1000), 0);
    if (allocatedSeconds > 0) accepted.push({ ...session, allocatedSeconds, fragments });
  });
  return accepted;
}

export function buildPeriodAnalysis(events, bounds = null) {
  const source = Array.isArray(events) ? events : [];
  const sessions = buildActivitySessions(source, bounds);
  const allocatedSessions = allocateIntervals(sessions);
  const periodEvents = source.filter((event) => {
    if (!bounds) return true;
    const start = getEventTime(event);
    const end = getEventEndTime(event) || start;
    return start && end && end >= bounds.start && start < bounds.end;
  });
  const moments = periodEvents.filter(isPointEvent);
  const groups = new Map();

  allocatedSessions.forEach((session) => {
    const label = session.category;
    const group = groups.get(label) || {
      label,
      seconds: 0,
      sessions: [],
      nestedSessions: [],
      color: ACTIVITY_COLORS[groups.size % ACTIVITY_COLORS.length]
    };
    group.seconds += session.allocatedSeconds;
    group.sessions.push(session);
    groups.set(label, group);
  });

  sessions.filter((session) => session.endAt).forEach((nested) => {
    const parent = sessions.find((candidate) => (
      candidate !== nested
      && candidate.endAt
      && candidate.rawCategory !== nested.rawCategory
      && candidate.startAt <= nested.startAt
      && candidate.endAt >= nested.endAt
    ));
    const parentGroup = parent && groups.get(parent.category);
    if (parentGroup && !parentGroup.nestedSessions.some((session) => session.id === nested.id)) {
      parentGroup.nestedSessions.push(nested);
    }
  });

  const categories = [...groups.values()].sort((left, right) => (
    right.seconds - left.seconds || left.label.localeCompare(right.label)
  ));
  const timedSeconds = categories.reduce((sum, category) => sum + category.seconds, 0);
  return {
    events: sortLifeEvents(periodEvents),
    sessions,
    allocatedSessions,
    moments: sortLifeEvents(moments),
    categories,
    timedSeconds,
    incompleteCount: sessions.filter((session) => session.kind === 'active').length,
    coveredDays: new Set(allocatedSessions.map((session) => (
      getDateIdInTimezone(session.startAt, bounds?.timezone || session.timezone || APP_TIMEZONE)
    ))).size
  };
}

export function getActivityTallyRange(rangeId, now = new Date(), timeZone = APP_TIMEZONE) {
  const today = getLocalDateId(now, timeZone);
  const end = getPeriodBounds('day', shiftPeriodDate(today, 'day', 1, timeZone), timeZone).start;
  if (rangeId === 'year') {
    const start = getPeriodBounds('year', today, timeZone).start;
    return { id: 'year', label: String(zonedParts(now, timeZone).year), start, end };
  }
  if (rangeId === '30d' || rangeId === '7d') {
    const days = rangeId === '30d' ? 30 : 7;
    const startDateId = shiftPeriodDate(today, 'day', -(days - 1), timeZone);
    return { id: rangeId, label: `Last ${days} days`, start: getPeriodBounds('day', startDateId, timeZone).start, end };
  }
  return { id: 'all', label: 'All time', start: null, end: null };
}

export function filterLifeEventsByRange(events, range) {
  const safeEvents = Array.isArray(events) ? events : [];
  if (!range?.start && !range?.end) return safeEvents;
  const start = range?.start?.getTime?.() ?? Number.NEGATIVE_INFINITY;
  const end = range?.end?.getTime?.() ?? Number.POSITIVE_INFINITY;
  return safeEvents.filter((event) => {
    const eventTime = getEventTime(event)?.getTime();
    return Number.isFinite(eventTime) && eventTime >= start && eventTime < end;
  });
}

export function buildActivityTallies(events) {
  const safeEvents = sortLifeEvents(events);
  const analysis = buildPeriodAnalysis(safeEvents);
  const groups = new Map();
  function groupFor(label) {
    if (!groups.has(label)) {
      groups.set(label, { label, eventCount: 0, sessions: [], seconds: 0, days: new Set(), sources: new Set() });
    }
    return groups.get(label);
  }
  safeEvents.forEach((event) => {
    const group = groupFor(getTallyActivityLabel(event));
    group.eventCount += 1;
    if (event.sourceApp) group.sources.add(event.sourceApp);
    const time = getEventTime(event);
    if (time) group.days.add(getDateIdInTimezone(time, event.timezone || APP_TIMEZONE));
  });
  analysis.allocatedSessions.forEach((session) => {
    const group = groupFor(session.category);
    group.sessions.push(session);
    group.seconds += session.allocatedSeconds;
    group.days.add(getDateIdInTimezone(session.startAt, session.timezone || APP_TIMEZONE));
    if (session.sourceApp) group.sources.add(session.sourceApp);
  });
  return [...groups.values()]
    .map((group, index) => ({
      label: group.label,
      eventCount: group.eventCount,
      sessionCount: group.sessions.length,
      totalSeconds: group.seconds,
      averageSeconds: group.sessions.length ? group.seconds / group.sessions.length : 0,
      dayCount: group.days.size,
      sourceCount: group.sources.size,
      sessions: group.sessions,
      color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]
    }))
    .sort((left, right) => (
      right.totalSeconds - left.totalSeconds
      || right.dayCount - left.dayCount
      || right.eventCount - left.eventCount
      || left.label.localeCompare(right.label)
    ));
}

export function filterLifeEvents(events, selection) {
  const safeEvents = Array.isArray(events) ? events : [];
  if (!selection) return safeEvents;
  if (selection.kind === 'event') return safeEvents.filter((event) => event.id === selection.value);
  if (selection.kind === 'source') {
    return safeEvents.filter((event) => String(event.sourceApp || '').toLowerCase() === String(selection.value || '').toLowerCase());
  }
  if (selection.kind === 'category') {
    const category = String(selection.value || '').toLowerCase();
    return safeEvents.filter((event) => getTallyActivityLabel(event).toLowerCase() === category);
  }
  return safeEvents;
}

export function getDailySummary(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const analysis = buildPeriodAnalysis(safeEvents);
  return {
    eventCount: safeEvents.length,
    activeSeconds: analysis.timedSeconds,
    sourceCount: new Set(safeEvents.map((event) => event.sourceApp).filter(Boolean)).size,
    completedCount: analysis.allocatedSessions.length
  };
}

export function buildActivityBreakdown(events) {
  return buildPeriodAnalysis(events).categories.map((category) => ({
    ...category,
    value: category.seconds,
    usesDuration: true,
    count: category.sessions.length
  }));
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

export function formatDuration(seconds) {
  const minutes = Math.round(Math.max(0, Number(seconds) || 0) / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

export function buildComparison(current, previous) {
  const currentSeconds = current?.timedSeconds || 0;
  const previousSeconds = previous?.timedSeconds || 0;
  return {
    currentSeconds,
    previousSeconds,
    deltaSeconds: currentSeconds - previousSeconds,
    hasPrevious: Boolean(previous && (previous.events?.length || previous.timedSeconds))
  };
}

export function buildDailyInsight(events, bounds = null) {
  const analysis = buildPeriodAnalysis(events, bounds);
  if (!analysis.events.length) {
    return 'No activities were recorded for this period. That may mean a quiet period or incomplete source coverage.';
  }
  if (!analysis.timedSeconds) {
    return `${analysis.moments.length} ${analysis.moments.length === 1 ? 'moment was' : 'moments were'} recorded, but no complete timed sessions are available yet.`;
  }
  const leading = analysis.categories[0];
  const coverage = bounds?.period === 'day'
    ? ` ${formatDuration(analysis.timedSeconds)} of the day is classified.`
    : '';
  const incomplete = analysis.incompleteCount
    ? ` ${analysis.incompleteCount} session${analysis.incompleteCount === 1 ? ' is' : 's are'} still in progress or incomplete.`
    : '';
  return `${leading.label} was your largest time category at ${formatDuration(leading.seconds)}.${coverage}${incomplete}`;
}

export function buildActivityAnalysis(events, bounds = null) {
  const analysis = buildPeriodAnalysis(events, bounds);
  const sources = new Set(analysis.events.map((event) => event.sourceApp).filter(Boolean));
  const firstAt = analysis.sessions[0]?.startAt || getEventTime(analysis.events[0]);
  const lastAt = analysis.sessions.at(-1)?.endAt || getEventTime(analysis.events.at(-1));
  return {
    eventCount: analysis.events.length,
    sourceCount: sources.size,
    sessionCount: analysis.allocatedSessions.length,
    activityDayCount: analysis.coveredDays,
    trackedSeconds: analysis.timedSeconds,
    averageSessionSeconds: analysis.allocatedSessions.length
      ? analysis.timedSeconds / analysis.allocatedSessions.length
      : 0,
    firstAt,
    lastAt,
    spanSeconds: firstAt && lastAt ? Math.max(0, (lastAt.getTime() - firstAt.getTime()) / 1000) : 0,
    averageDeliverySeconds: null,
    deliveredCount: 0,
    eventTypes: [],
    sessions: analysis.sessions,
    moments: analysis.moments
  };
}

export { ACTIVITY_COLORS };

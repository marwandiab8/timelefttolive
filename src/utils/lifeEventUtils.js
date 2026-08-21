export const APP_TIMEZONE = 'America/Toronto';

// Allocation hierarchy, highest first: Sleep, Work, Gym/Fitness,
// Transportation, Meals, Reading, Home, Music, Places, then Other.
// A parent gym visit therefore owns its minutes while nested workouts remain
// available in the drill-down without increasing total tracked time.
const CATEGORY_DEFINITIONS = {
  Work: { color: '#4f8cff', icon: '💼', priority: 90 },
  'Gym/Fitness': { color: '#f47c61', icon: '🏋', priority: 80 },
  Sleep: { color: '#8178e8', icon: '☾', priority: 100 },
  Home: { color: '#58c6a6', icon: '⌂', priority: 40 },
  Transportation: { color: '#f2b84b', icon: '◉', priority: 70 },
  Music: { color: '#db75a6', icon: '♫', priority: 30 },
  Meals: { color: '#ef996c', icon: '◒', priority: 60 },
  Places: { color: '#50b8d8', icon: '⌖', priority: 20 },
  Reading: { color: '#8cad55', icon: '▤', priority: 50 },
  Other: { color: '#8b98a1', icon: '•', priority: 10 }
};

const POINT_CATEGORY_DEFINITIONS = {
  Spotify: { color: CATEGORY_DEFINITIONS.Music.color, icon: '♫' },
  Journal: { color: '#9a88d4', icon: '✎' },
  'Work Reports': { color: CATEGORY_DEFINITIONS.Work.color, icon: '▤' },
  Achievements: { color: '#efb84e', icon: '★' },
  Moments: { color: '#8b98a1', icon: '•' }
};

const MOMENT_CATEGORIES = new Set(['Notes', 'Work Reports', 'Attachments', 'Achievements', 'Moments']);
const ACTIVE_SESSION_CATEGORIES = new Set(['Work', 'Gym/Fitness', 'Sleep', 'Home', 'Transportation', 'Meals', 'Reading']);
const GENERIC_TITLES = /^(life event|journal entry|work session|home session|gym session|location session|activity|event|report|file|image)$/i;
const COORDINATE_VALUE = /^\s*-?\d{1,3}(?:\.\d+)?\s*[,/]\s*-?\d{1,3}(?:\.\d+)?\s*$/;
const HIDDEN_POINT_CATEGORIES = new Set(['Attachments']);
const GENERIC_LOCATION_EVENT_TYPES = new Set(['arrive_location', 'leave_location']);
const MUTUALLY_EXCLUSIVE_LOCATION_CATEGORIES = new Set(['Work', 'Gym/Fitness', 'Home', 'Sleep', 'Transportation', 'Places']);
export const GENERIC_LOCATION_DEDUP_WINDOW_MS = 10 * 60 * 1000;

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
  return toJsDate(event?._journal?.occurredAt)
    || toJsDate(event?.displayAt)
    || toJsDate(event?.startAt)
    || toJsDate(event?.occurredAt);
}

function eventDateOnlyId(event) {
  const candidates = [
    event?._journal?.dateId,
    event?.dateId,
    event?.metadata?.dateId,
    event?.metadata?.dateKey,
    event?.metadata?.reportDateKey
  ];
  return candidates.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) || '';
}

function timestampOnDate(value, dateId, timeZone) {
  const date = toJsDate(value);
  if (!date) return null;
  return !dateId || getDateIdInTimezone(date, timeZone) === dateId ? date : null;
}

// The timeline must not turn a date-only journal/report sentinel into a
// user-facing clock time. When the source resolver supplies a real occurrence,
// sent, or received timestamp on that same local day, use it in that order.
export function getActivityDisplayTime(event, timeZone = APP_TIMEZONE) {
  const dateId = eventDateOnlyId(event);
  if (event?._journal && !toJsDate(event._journal.occurredAt) && event._journal.dateId) {
    return timestampOnDate(getEventSentTime(event), dateId, timeZone)
      || timestampOnDate(getEventReceivedTime(event), dateId, timeZone)
      || null;
  }
  if (event?.timeRecorded === false || event?.metadata?.timeRecorded === false || event?.metadata?.dateOnly === true) {
    return timestampOnDate(getEventSentTime(event), dateId, timeZone)
      || timestampOnDate(getEventReceivedTime(event), dateId, timeZone)
      || null;
  }
  const occurredAt = getEventTime(event);
  const local = occurredAt ? zonedParts(occurredAt, timeZone) : null;
  const pointCategory = getPointCategoryLabel(event);
  const isDateOnlyPoint = dateId
    && ['Journal', 'Work Reports', 'Attachments'].includes(pointCategory)
    && getDateIdInTimezone(occurredAt, timeZone) === dateId
    && local?.hour === 0
    && local?.minute === 0
    && local?.second === 0;
  if (!isDateOnlyPoint) return occurredAt;
  return timestampOnDate(getEventSentTime(event), dateId, timeZone)
    || timestampOnDate(getEventReceivedTime(event), dateId, timeZone)
    || null;
}

export function getEventEndTime(event) {
  return toJsDate(event?.endAt);
}

export function getEventReceivedTime(event) {
  return toJsDate(event?.receivedAt);
}

export function getEventSentTime(event) {
  return toJsDate(event?._journal?.sourceSentAt)
    || toJsDate(event?.sentAt)
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

function cleanToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function humanize(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getRawLocationLabel(event) {
  const candidates = [
    event?.location?.label,
    event?.metadata?.locationName,
    event?.metadata?.placeName,
    event?.metadata?.destinationName,
    event?.metrics?.locationName
  ];
  const label = candidates.find((candidate) => (
    typeof candidate === 'string'
    && candidate.trim()
    && !COORDINATE_VALUE.test(candidate)
  ));
  return label ? label.trim() : '';
}

export function getLocationLabel(event) {
  const label = getRawLocationLabel(event);
  return label && !/^(?:work|home|gym|fitness|location|place)$/i.test(label) ? label : '';
}

export function getActivityLabel(event) {
  const raw = event?.activityFamily || event?.categoryId || event?.eventClass || event?.eventType || 'Other';
  return humanize(raw);
}

export function getTallyActivityLabel(event) {
  const eventType = cleanToken(event?.eventType);
  const boundary = /^(?:arrive|leave|start|finish|stop)_(.+)$/.exec(eventType);
  const raw = boundary?.[1] || event?.activityFamily || event?.categoryId || event?.eventClass || eventType;
  const token = cleanToken(raw);
  const titleToken = cleanToken(event?.title);
  const locationToken = cleanToken(getLocationLabel(event));
  const combined = `${token}_${eventType}_${titleToken}`;

  if (/(project_?report|construction_?report|progress_?record|darter_?record|work_?report)/.test(combined)) return 'Work Reports';
  if (/(journal|note|memo|reflection)/.test(combined)) return 'Notes';
  if (/(image|file|attachment|media|photo|picture)/.test(combined)) return 'Attachments';
  if (/(achievement|milestone|personal_?best|darts?_?record|darter_?record)/.test(combined)) return 'Achievements';
  if (/(workout|gym|fitness)/.test(combined) || /(goodlife|fitness|gym)/.test(locationToken)) return 'Gym/Fitness';
  if (/(sleep|bedtime|asleep|wake|wakeup)/.test(combined)) return 'Sleep';
  if (/(drive|driving|transport|travel|commute|trip|vehicle|car)/.test(combined)) return 'Transportation';
  if (/(spotify|music|listen|track|album|playlist)/.test(combined)) return 'Music';
  if (/(meal|food|breakfast|lunch|dinner|snack)/.test(combined)) return 'Meals';
  if (/(home|house)/.test(combined)) return 'Home';
  if (/(work|office|workplace|job|shift)/.test(combined)) return 'Work';
  if (/(read|book)/.test(combined)) return 'Reading';
  if (COORDINATE_VALUE.test(String(raw || '')) || /(coordinate|latitude|longitude|gps|location|place)/.test(combined)) return 'Places';
  if (!token || /(system|project|completed_?activity|activity_?boundary|other)/.test(token)) return 'Moments';
  return humanize(token);
}

export function getCategoryDefinition(label) {
  return CATEGORY_DEFINITIONS[label] || { ...CATEGORY_DEFINITIONS.Other, label };
}

export function getPointCategoryDefinition(label) {
  return POINT_CATEGORY_DEFINITIONS[label]
    || CATEGORY_DEFINITIONS[label]
    || { ...POINT_CATEGORY_DEFINITIONS.Moments, label };
}

function firstMeaningfulString(...values) {
  return values.find((value) => (
    typeof value === 'string'
    && value.trim()
    && !COORDINATE_VALUE.test(value)
  ))?.trim() || '';
}

export function getPointCategoryLabel(event) {
  const category = getTallyActivityLabel(event);
  if (category === 'Music') return 'Spotify';
  if (category === 'Notes') return 'Journal';
  if (category === 'Work Reports') return 'Work Reports';
  if (category === 'Achievements') return 'Achievements';
  if (category === 'Attachments') return 'Attachments';
  if (['Work', 'Gym/Fitness', 'Sleep', 'Home', 'Transportation', 'Meals', 'Places', 'Reading'].includes(category)) return category;
  return 'Moments';
}

export function getMeaningfulEventDetails(event) {
  const metadata = event?.metadata || {};
  const payload = metadata.payload || event?.payload || {};
  const track = firstMeaningfulString(metadata.trackName, metadata.track, metadata.songName, metadata.song, payload.trackName, payload.track);
  const artist = firstMeaningfulString(metadata.artistName, metadata.artist, payload.artistName, payload.artist);
  const album = firstMeaningfulString(metadata.albumName, metadata.album, payload.albumName, payload.album);
  const playlist = firstMeaningfulString(metadata.playlistName, metadata.playlist, payload.playlistName, payload.playlist);
  const note = firstMeaningfulString(event?._journal?.note, metadata.note, metadata.notes, metadata.summary, metadata.text, metadata.message, event?.description);
  const eventType = cleanToken(event?.eventType);
  const location = GENERIC_LOCATION_EVENT_TYPES.has(eventType)
    ? getRawLocationLabel(event)
    : getLocationLabel(event) || event?._activityPrecedence?.associatedLocation || '';
  return { track, artist, album, playlist, note, location };
}

export function getEventDisplayTitle(event) {
  const eventType = cleanToken(event?.eventType);
  const details = getMeaningfulEventDetails(event);
  const location = details.location;
  const exact = {
    arrive_work: 'Arrived at Work',
    leave_work: 'Left Work',
    arrive_gym: location ? `Arrived at ${location}` : 'Arrived at Gym',
    leave_gym: location ? `Left ${location}` : 'Left Gym',
    arrive_home: 'Arrived Home',
    leave_home: 'Left Home',
    start_workout: 'Started Workout',
    finish_workout: 'Finished Workout',
    stop_workout: 'Finished Workout',
    start_spotify: details.track ? `Played ${details.track}` : 'Started listening to Spotify',
    arrive_location: details.location ? `Arrived at ${details.location}` : 'Arrived at a place',
    leave_location: details.location ? `Left ${details.location}` : 'Left a place'
  };
  if (exact[eventType]) return exact[eventType];
  if (event?._journal?.title && !GENERIC_TITLES.test(event._journal.title)) return event._journal.title;
  const rawTitle = String(event?.title || '').trim();
  if (rawTitle && !GENERIC_TITLES.test(rawTitle) && !COORDINATE_VALUE.test(rawTitle)) return rawTitle;
  if (details.note) return details.note.slice(0, 160);
  const category = getPointCategoryLabel(event);
  if (category === 'Journal') return 'Journal entry';
  if (category === 'Work Reports') return 'Work report';
  return category === 'Moments' ? 'Life moment' : category;
}

function meaningfulPointEvent(event) {
  if (event?.excludeFromActivity === true || event?._journal?.shortcutShadow === true) return false;
  const eventType = cleanToken(event?.eventType);
  if (GENERIC_LOCATION_EVENT_TYPES.has(eventType) && !getRawLocationLabel(event)) return false;
  const label = getPointCategoryLabel(event);
  if (HIDDEN_POINT_CATEGORIES.has(label)) return false;
  const raw = `${cleanToken(event?.eventType)} ${cleanToken(event?.activityFamily)} ${cleanToken(event?.title)}`;
  if (/coordinate|latitude|longitude|gps/.test(raw) || COORDINATE_VALUE.test(String(event?.title || ''))) return false;
  return Boolean(getEventTime(event));
}

export function enrichLifeEventsWithJournalDetails(events, details) {
  const byId = new Map((Array.isArray(details) ? details : [])
    .filter((detail) => detail?.lifeEventId)
    .map((detail) => [detail.lifeEventId, detail]));
  return (Array.isArray(events) ? events : []).map((event) => {
    const detail = byId.get(event?.id);
    if (!detail) return event;
    if (detail.kind === 'media') {
      return {
        ...event,
        displayAt: detail.occurredAt || event.displayAt,
        _journal: detail
      };
    }
    const note = String(detail.note || '').trim();
    return {
      ...event,
      displayAt: detail.occurredAt || event.displayAt,
      excludeFromActivity: detail.shortcutShadow === true,
      metadata: {
        ...(event.metadata || {}),
        ...(note ? { note } : {})
      },
      _journal: detail
    };
  });
}

export function deriveJournalTitle(note, explicitTitle = '') {
  const explicit = String(explicitTitle || '').replace(/\s+/g, ' ').trim();
  if (explicit && !GENERIC_TITLES.test(explicit)) return explicit.slice(0, 160);
  const firstLine = String(note || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const normalized = firstLine.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 160) : 'Journal entry';
}

export function buildJournalEntries(events, media = [], timeZone = APP_TIMEZONE) {
  const mediaById = new Map((Array.isArray(media) ? media : []).map((item) => [item.id, item]));
  const entries = new Map();
  sortLifeEvents((Array.isArray(events) ? events : []).filter((event) => (
    event?.excludeFromActivity !== true
    && event?._journal?.shortcutShadow !== true
    && getPointCategoryLabel(event) === 'Journal'
  ))).forEach((event) => {
    const detail = event._journal || {};
    const stableId = String(event.sourceRecordId || event.sourceEventId || event.id || '');
    if (!stableId) return;
    const note = String(detail.note || getMeaningfulEventDetails(event).note || '').trim();
    const occurredAt = toJsDate(detail.occurredAt);
    const sourceSentAt = toJsDate(detail.sourceSentAt) || getEventSentTime(event);
    const receivedAt = getEventReceivedTime(event);
    const dateId = detail.dateId
      || getDateIdInTimezone(occurredAt || toJsDate(event.occurredAt), timeZone);
    const mediaIds = [...new Set(Array.isArray(detail.mediaIds) ? detail.mediaIds.filter(Boolean) : [])];
    const current = entries.get(stableId);
    const next = {
      id: stableId,
      lifeEventId: event.id,
      title: deriveJournalTitle(note, detail.title || event.title),
      note,
      occurredAt,
      sourceSentAt,
      receivedAt,
      dateId,
      timeRecorded: Boolean(occurredAt),
      location: detail.location || getLocationLabel(event),
      projectId: detail.projectId || event.sourceProjectId || '',
      sourceApp: event.sourceApp || '',
      mediaIds,
      media: mediaIds.map((id) => mediaById.get(id)).filter(Boolean),
      event
    };
    if (!current) {
      entries.set(stableId, next);
      return;
    }
    const combinedIds = [...new Set([...current.mediaIds, ...next.mediaIds])];
    entries.set(stableId, {
      ...current,
      title: current.title !== 'Journal entry' ? current.title : next.title,
      note: current.note || next.note,
      occurredAt: current.occurredAt || next.occurredAt,
      sourceSentAt: current.sourceSentAt || next.sourceSentAt,
      receivedAt: current.receivedAt || next.receivedAt,
      location: current.location || next.location,
      mediaIds: combinedIds,
      media: combinedIds.map((id) => mediaById.get(id)).filter(Boolean)
    });
  });
  return [...entries.values()].sort((left, right) => (
    (right.occurredAt?.getTime() || 0) - (left.occurredAt?.getTime() || 0)
  ));
}

export function buildJournalMetrics(entries, timeZone = APP_TIMEZONE) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const photos = new Set(safeEntries.flatMap((entry) => entry.mediaIds || []));
  const reliableTimes = safeEntries.map((entry) => entry.occurredAt).filter(Boolean).sort((a, b) => a - b);
  return {
    entryCount: safeEntries.length,
    entriesWithPhotos: safeEntries.filter((entry) => entry.mediaIds?.length).length,
    photoCount: photos.size,
    activeDays: new Set(safeEntries.map((entry) => entry.dateId || getDateIdInTimezone(entry.occurredAt, timeZone)).filter(Boolean)).size,
    firstAt: reliableTimes[0] || null,
    lastAt: reliableTimes.at(-1) || null
  };
}

export function groupPhotosByDate(media, timeZone = APP_TIMEZONE) {
  const groups = new Map();
  (Array.isArray(media) ? media : []).forEach((item) => {
    const date = toJsDate(item?.createdAt);
    const dateId = date ? getDateIdInTimezone(date, timeZone) : '';
    if (!dateId) return;
    const group = groups.get(dateId) || [];
    if (!group.some((candidate) => candidate.id === item.id)) group.push(item);
    groups.set(dateId, group);
  });
  return [...groups.entries()]
    .map(([dateId, photos]) => ({ dateId, photos }))
    .sort((left, right) => right.dateId.localeCompare(left.dateId));
}

export function isPrimaryActivityCategory(label) {
  return Boolean(label) && !MOMENT_CATEGORIES.has(label);
}

function stableEventIdentity(event) {
  return String(
    event?.id
    || event?.sourceRecordId
    || event?.sourceEventId
    || event?.metadata?.sourceDocumentId
    || ''
  );
}

export function sortLifeEvents(events) {
  return [...(Array.isArray(events) ? events : [])].sort((left, right) => (
    (getEventTime(left)?.getTime() ?? Number.MAX_SAFE_INTEGER)
    - (getEventTime(right)?.getTime() ?? Number.MAX_SAFE_INTEGER)
    || stableEventIdentity(left).localeCompare(stableEventIdentity(right))
  ));
}

export function isPointEvent(event) {
  const duration = getEventDurationSeconds(event);
  return !boundaryDescriptor(event) && !getEventEndTime(event) && !(Number.isFinite(duration) && duration > 0);
}

export function toggleActivitySelection(currentLabel, nextLabel) {
  return currentLabel === nextLabel ? null : nextLabel;
}

function genericDestinationCategory(label) {
  const token = cleanToken(label);
  if (/(?:^|_)(?:gym|fitness)(?:_|$)/.test(token) || /goodlife/.test(token)) return 'Gym/Fitness';
  if (/(?:^|_)(?:home|house)(?:_|$)/.test(token)) return 'Home';
  if (/(?:^|_)(?:work|office|workplace)(?:_|$)/.test(token)) return 'Work';
  if (/(?:^|_)(?:drive|driving|transport|travel|trip)(?:_|$)/.test(token)) return 'Transportation';
  return 'Places';
}

function isCategoryAlias(label, category) {
  const token = cleanToken(label);
  if (category === 'Work') return /^(?:work|office|workplace)$/.test(token);
  if (category === 'Gym/Fitness') return /^(?:gym|fitness|goodlife_fitness)$/.test(token);
  if (category === 'Home') return /^(?:home|house)$/.test(token);
  return false;
}

function arrivalEvidence(event) {
  const eventType = cleanToken(event?.eventType);
  const generic = eventType === 'arrive_location';
  if (!generic && !/^arrive_/.test(eventType)) return null;
  const at = getEventTime(event);
  if (!at) return null;
  const rawLocation = getRawLocationLabel(event);
  if (generic && !rawLocation) return null;
  const category = generic ? genericDestinationCategory(rawLocation) : getTallyActivityLabel(event);
  return {
    event,
    at,
    category,
    generic,
    locationKey: cleanToken(rawLocation),
    location: rawLocation || category
  };
}

function genericMatchesSpecific(generic, specific) {
  if (!generic?.generic || specific?.generic) return false;
  if (generic.locationKey && specific.locationKey && generic.locationKey === specific.locationKey) return true;
  if (generic.category !== specific.category) return false;
  return !specific.locationKey || isCategoryAlias(generic.location, specific.category);
}

function sameArrivalPlace(left, right) {
  if (!left || !right) return false;
  if (left.locationKey && right.locationKey && left.locationKey === right.locationKey) return true;
  if (left.category !== right.category) return false;
  if (left.generic && !right.generic) return genericMatchesSpecific(left, right);
  if (right.generic && !left.generic) return genericMatchesSpecific(right, left);
  // Two specific arrivals in the same category with a missing location do not
  // prove that the person changed places.
  return !left.locationKey || !right.locationKey;
}

// Event-confidence model, highest first:
// 1. Explicit reported intervals retain their supplied start/end/duration.
// 2. Specific canonical boundaries (Gym/Home/Work/etc.) own session state.
// 3. Generic CarPlay arrive_location records are location Moments and can only
//    provide later-place evidence. Near an equivalent specific arrival, the
//    generic record is associated with it and hidden as a duplicate.
export function applyActivityEventPrecedence(events, options = {}) {
  const windowMs = Number.isFinite(options.dedupeWindowMs)
    ? Math.max(0, options.dedupeWindowMs)
    : GENERIC_LOCATION_DEDUP_WINDOW_MS;
  const ordered = sortLifeEvents(events);
  const suppressed = new Map();
  const associations = new Map();
  const arrivals = ordered.map(arrivalEvidence).filter(Boolean);
  const specificArrivals = arrivals.filter((evidence) => !evidence.generic);

  arrivals.filter((evidence) => evidence.generic).forEach((generic) => {
    const match = specificArrivals
      .filter((specific) => (
        Math.abs(specific.at.getTime() - generic.at.getTime()) <= windowMs
        && genericMatchesSpecific(generic, specific)
      ))
      .sort((left, right) => (
        Math.abs(left.at - generic.at) - Math.abs(right.at - generic.at)
      ))[0];
    if (!match) return;
    suppressed.set(generic.event, { reason: 'associated_with_specific_arrival', authoritativeEvent: match.event });
    const related = associations.get(match.event) || [];
    related.push(generic.event);
    associations.set(match.event, related);
  });

  ordered.forEach((event) => {
    const eventType = cleanToken(event?.eventType);
    if (GENERIC_LOCATION_EVENT_TYPES.has(eventType) && !getRawLocationLabel(event)) {
      suppressed.set(event, { reason: 'empty_generic_location' });
    }
  });

  const effectiveEvents = ordered
    .filter((event) => !suppressed.has(event))
    .map((event) => {
      const related = associations.get(event);
      if (!related?.length) return event;
      const genericLocation = related.map(getRawLocationLabel).find(Boolean);
      return {
        ...event,
        _activityPrecedence: {
          confidence: 'specific_boundary',
          // Display enrichment only: keeping this out of event.location ensures
          // a generic observation cannot alter the specific boundary-pair key.
          associatedLocation: getRawLocationLabel(event) ? '' : genericLocation,
          associatedGenericEventIds: related.map((candidate) => candidate.id).filter(Boolean)
        }
      };
    });

  return {
    events: effectiveEvents,
    suppressed: [...suppressed.entries()].map(([event, resolution]) => ({ event, ...resolution }))
  };
}

function boundaryDescriptor(event) {
  const eventType = cleanToken(event?.eventType);
  // Generic location records are observations, never duration boundaries.
  if (GENERIC_LOCATION_EVENT_TYPES.has(eventType)) return null;
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
  const category = getTallyActivityLabel(event);
  // Shortcut Spotify events describe track occurrences. Without a supplied
  // duration they remain Moments rather than open-ended listening sessions.
  if (category === 'Music') return null;
  const location = cleanToken(getLocationLabel(event) || event?.location?.placeId);
  const subject = cleanToken(event?.sourceUserId || event?.timeLeftUserId);
  return { phase, category, key: `${subject}|${category}|${location}`, rawActivity: activity };
}

function clippedInterval(start, end, bounds) {
  if (!start || !end || end <= start) return null;
  if (!bounds) return { startAt: start, endAt: end, durationSeconds: (end - start) / 1000 };
  const clippedStart = new Date(Math.max(start.getTime(), bounds.start.getTime()));
  const clippedEnd = new Date(Math.min(end.getTime(), bounds.end.getTime()));
  return clippedEnd > clippedStart
    ? { startAt: clippedStart, endAt: clippedEnd, durationSeconds: (clippedEnd - clippedStart) / 1000 }
    : null;
}

function reportedInterval(event, bounds) {
  const start = getEventTime(event);
  const explicitEnd = getEventEndTime(event);
  const duration = getEventDurationSeconds(event);
  const end = explicitEnd || (start && Number.isFinite(duration) && duration > 0
    ? new Date(start.getTime() + (duration * 1000))
    : null);
  return clippedInterval(start, end, bounds);
}

function makeSession(event, interval, extra = {}) {
  const category = getTallyActivityLabel(event);
  return {
    event,
    sourceApp: event?.sourceApp || '',
    timezone: event?.timezone || APP_TIMEZONE,
    category,
    rawCategory: getActivityLabel(event),
    location: getLocationLabel(event) || event?._activityPrecedence?.associatedLocation || '',
    ...interval,
    ...extra
  };
}

export function getSessionDisplayName(session) {
  const event = session?.event || {};
  const location = session?.location || getLocationLabel(event);
  const sourceTitle = String(event.title || '').trim();
  const usefulTitle = sourceTitle && !GENERIC_TITLES.test(sourceTitle) && !COORDINATE_VALUE.test(sourceTitle)
    ? sourceTitle
    : '';
  const raw = cleanToken(session?.rawCategory || event.activityFamily || event.eventType);
  if (session?.category === 'Work') return location ? `Work at ${location}` : 'Work';
  if (session?.category === 'Gym/Fitness') {
    if (/workout/.test(raw) || /workout/.test(cleanToken(event.eventType))) return usefulTitle || 'Workout';
    return location ? `Gym visit at ${location}` : 'Gym visit';
  }
  if (session?.category === 'Sleep') return location ? `Sleep at ${location}` : 'Sleep';
  if (session?.category === 'Home') return location && !/^home$/i.test(location) ? `Home at ${location}` : 'Home';
  if (session?.category === 'Transportation') {
    const destination = event?.metadata?.destinationName || event?.metadata?.destination || '';
    return destination ? `Drive to ${destination}` : usefulTitle || 'Travel';
  }
  if (session?.category === 'Music') return usefulTitle || 'Listening';
  if (session?.category === 'Places') return location ? `Visit to ${location}` : 'Place visit';
  return usefulTitle || session?.category || 'Activity';
}

function findSupersedingArrival(candidate, events, now) {
  const descriptor = boundaryDescriptor(candidate.event);
  if (!descriptor || descriptor.phase !== 'start' || !MUTUALLY_EXCLUSIVE_LOCATION_CATEGORIES.has(descriptor.category)) return null;
  const startEvidence = {
    event: candidate.event,
    at: candidate.eventTime,
    category: descriptor.category,
    generic: false,
    locationKey: cleanToken(getRawLocationLabel(candidate.event)),
    location: getRawLocationLabel(candidate.event) || descriptor.category
  };
  return events
    .map(arrivalEvidence)
    .filter((evidence) => (
      evidence
      && evidence.event !== candidate.event
      && evidence.at > candidate.eventTime
      && evidence.at <= now
      && !sameArrivalPlace(startEvidence, evidence)
    ))[0] || null;
}

export function getIncompleteSessionMessage(session) {
  if (session?.incompleteReason === 'superseded_by_arrival') {
    const location = session.supersededByLocation || 'another location';
    return `Departure was not recorded. A later arrival at ${location} confirms this visit ended.`;
  }
  if (session?.missingBoundary === 'start') return 'Arrival was not recorded, so duration cannot be calculated.';
  if (session?.missingBoundary === 'end') return 'Departure was not recorded, so duration cannot be calculated.';
  return '';
}

export function buildActivitySessions(events, bounds = null, options = {}) {
  const resolution = options.precedenceResolved
    ? { events: sortLifeEvents(events), suppressed: [] }
    : applyActivityEventPrecedence(events, options);
  const safeEvents = resolution.events;
  const sessions = [];
  const seen = new Set();
  const openBoundaries = new Map();
  const unmatchedEnds = [];
  const now = toJsDate(options.now) || new Date();

  safeEvents.forEach((event) => {
    const interval = reportedInterval(event, bounds);
    if (interval) {
      const identity = event.id || `${interval.startAt.toISOString()}|${interval.endAt.toISOString()}|${getTallyActivityLabel(event)}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        const session = makeSession(event, interval, {
          id: `timed-${identity}`,
          kind: 'reported',
          active: false,
          startEvent: event,
          endEvent: getEventEndTime(event) ? event : null
        });
        session.title = getSessionDisplayName(session);
        sessions.push(session);
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
    if (!start || eventTime <= start.eventTime) {
      unmatchedEnds.push({ event, eventTime, descriptor });
      return;
    }
    const identity = `${start.event.id || start.eventTime.getTime()}|${event.id || eventTime.getTime()}`;
    if (seen.has(identity)) return;
    const pairedInterval = clippedInterval(start.eventTime, eventTime, bounds);
    if (!pairedInterval) return;
    const duplicate = sessions.some((session) => (
      session.category === descriptor.category
      && session.startAt.getTime() === pairedInterval.startAt.getTime()
      && session.endAt.getTime() === pairedInterval.endAt.getTime()
    ));
    if (duplicate) return;
    seen.add(identity);
    const session = makeSession(start.event, pairedInterval, {
      id: `paired-${identity}`,
      kind: 'paired',
      active: false,
      startEvent: start.event,
      endEvent: event
    });
    session.title = getSessionDisplayName(session);
    sessions.push(session);
  });

  const unresolvedStarts = [...openBoundaries.values()].flat();
  const latestActiveByCategory = new Map();
  const supersededStarts = new Map();
  unresolvedStarts.forEach((candidate) => {
    const category = getTallyActivityLabel(candidate.event);
    const superseding = findSupersedingArrival(candidate, safeEvents, now);
    if (superseding) supersededStarts.set(candidate.event, superseding);
    const eligible = options.includeActive === true
      && ACTIVE_SESSION_CATEGORIES.has(category)
      && candidate.eventTime < now
      && (now.getTime() - candidate.eventTime.getTime()) <= (36 * 3600 * 1000)
      && (!bounds || (now >= bounds.start && now < bounds.end))
      && !superseding;
    if (!eligible) return;
    const current = latestActiveByCategory.get(category);
    if (!current || candidate.eventTime > current.eventTime) latestActiveByCategory.set(category, candidate);
  });

  unresolvedStarts.forEach(({ event, eventTime }) => {
    const category = getTallyActivityLabel(event);
    const live = latestActiveByCategory.get(category)?.event === event;
    const superseding = supersededStarts.get(event) || null;
    if (bounds && !live && (eventTime >= bounds.end || eventTime < bounds.start)) return;
    const interval = live ? clippedInterval(eventTime, now, bounds) : null;
    const session = makeSession(event, interval || {
      startAt: eventTime,
      endAt: null,
      durationSeconds: null
    }, {
      id: `${live ? 'active' : 'incomplete'}-${event.id || eventTime.getTime()}`,
      kind: live ? 'active' : 'incomplete',
      active: live,
      missingBoundary: live ? null : 'end',
      incompleteReason: superseding ? 'superseded_by_arrival' : null,
      supersededByEvent: superseding?.event || null,
      supersededAt: superseding?.at || null,
      supersededByLocation: superseding?.location || null,
      startEvent: event,
      endEvent: null
    });
    session.title = getSessionDisplayName(session);
    sessions.push(session);
  });

  unmatchedEnds.forEach(({ event, eventTime }) => {
    if (bounds && (eventTime < bounds.start || eventTime >= bounds.end)) return;
    const session = makeSession(event, {
      startAt: eventTime,
      endAt: null,
      durationSeconds: null
    }, {
      id: `incomplete-end-${event.id || eventTime.getTime()}`,
      kind: 'incomplete',
      active: false,
      missingBoundary: 'start',
      startEvent: null,
      endEvent: event
    });
    session.title = getSessionDisplayName(session);
    sessions.push(session);
  });

  return sessions.sort((left, right) => left.startAt - right.startAt);
}

function allocationPriority(session) {
  const category = getCategoryDefinition(session.category);
  const duration = session.endAt ? session.endAt - session.startAt : 0;
  return (category.priority * 1e12) + duration;
}

function allocateIntervals(sessions) {
  const complete = [...sessions]
    .filter((session) => session.endAt)
    .sort((left, right) => allocationPriority(right) - allocationPriority(left) || left.startAt - right.startAt);
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
  return accepted.sort((left, right) => left.startAt - right.startAt);
}

export function groupMoments(events, timeZone = APP_TIMEZONE) {
  const groups = new Map();
  sortLifeEvents(events).forEach((event) => {
    if (event?.excludeFromActivity === true || event?._journal?.shortcutShadow === true) return;
    const category = getTallyActivityLabel(event);
    const pointCategory = getPointCategoryLabel(event);
    const title = getEventDisplayTitle(event).slice(0, 160);
    const at = getActivityDisplayTime(event, timeZone);
    const dateId = event?._journal?.dateId
      || event?.dateId
      || eventDateOnlyId(event)
      || getDateIdInTimezone(at || getEventTime(event), timeZone)
      || 'unknown';
    const sourceIdentity = event?.sourceRecordId || event?.sourceEventId || event?.metadata?.sourceDocumentId;
    // Only collapse records that share a stable upstream identity. When no
    // identity is supplied, exact time remains part of the key so separate
    // Spotify plays or journals are never merged just because titles match.
    const identity = sourceIdentity
      ? `${cleanToken(event?.sourceApp)}|${String(sourceIdentity)}`
      : `${event?.id || ''}|${at?.toISOString() || 'unknown'}`;
    const key = `${pointCategory}|${identity}|${cleanToken(title)}|${dateId}`;
    const group = groups.get(key) || {
      id: key,
      category,
      pointCategory,
      title,
      icon: getPointCategoryDefinition(pointCategory).icon,
      dateId,
      count: 0,
      events: [],
      firstAt: at,
      lastAt: at,
      details: getMeaningfulEventDetails(event)
    };
    group.count += 1;
    group.events.push(event);
    if (at && (!group.firstAt || at < group.firstAt)) group.firstAt = at;
    if (at && (!group.lastAt || at > group.lastAt)) group.lastAt = at;
    groups.set(key, group);
  });
  return [...groups.values()].sort((left, right) => {
    if (left.firstAt && !right.firstAt) return -1;
    if (!left.firstAt && right.firstAt) return 1;
    return (left.firstAt?.getTime() || 0) - (right.firstAt?.getTime() || 0)
      || left.id.localeCompare(right.id);
  });
}

export function buildActivityEntries(events, timeZone = APP_TIMEZONE) {
  return groupMoments((Array.isArray(events) ? events : []).filter(meaningfulPointEvent), timeZone)
    .map((group) => ({
      ...group,
      event: group.events[0],
      sentAt: getEventSentTime(group.events[0]),
      receivedAt: getEventReceivedTime(group.events[0])
    }));
}

export function selectActivityPreviewEntries(entries, limit = 8) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length <= limit) return [...safeEntries];
  const chosen = [];
  const chosenIds = new Set();
  const seenCategories = new Set();
  const seenTitles = new Set();
  const remember = (entry) => {
    chosen.push(entry);
    chosenIds.add(entry.id);
    seenCategories.add(entry.pointCategory);
    seenTitles.add(`${entry.pointCategory}|${cleanToken(entry.title)}`);
  };
  safeEntries.forEach((entry) => {
    if (chosen.length >= limit || seenCategories.has(entry.pointCategory)) return;
    remember(entry);
  });
  safeEntries.forEach((entry) => {
    if (chosen.length >= limit || chosenIds.has(entry.id)) return;
    const titleKey = `${entry.pointCategory}|${cleanToken(entry.title)}`;
    if (entry.pointCategory !== 'Spotify' && seenTitles.has(titleKey)) return;
    remember(entry);
  });
  const order = new Map(safeEntries.map((entry, index) => [entry.id, index]));
  return chosen.sort((left, right) => (order.get(left.id) || 0) - (order.get(right.id) || 0));
}

function buildPointCategories(events, timeZone) {
  const groups = new Map();
  buildActivityEntries(events.filter(isPointEvent), timeZone).forEach((entry) => {
    if (HIDDEN_POINT_CATEGORIES.has(entry.pointCategory)) return;
    const definition = getPointCategoryDefinition(entry.pointCategory);
    const group = groups.get(entry.pointCategory) || {
      label: entry.pointCategory,
      color: definition.color,
      icon: definition.icon,
      count: 0,
      events: [],
      entries: [],
      seconds: 0,
      point: true
    };
    group.count += entry.count;
    group.events.push(...entry.events);
    group.entries.push(entry);
    const duration = getEventDurationSeconds(entry.event);
    if (Number.isFinite(duration) && duration > 0) group.seconds += duration;
    groups.set(entry.pointCategory, group);
  });
  return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function buildPeriodAnalysis(events, bounds = null, options = {}) {
  const rawSource = Array.isArray(events) ? events : [];
  const precedence = applyActivityEventPrecedence(rawSource, options);
  const source = precedence.events;
  const sessions = buildActivitySessions(source, bounds, { ...options, precedenceResolved: true });
  const allocatedSessions = allocateIntervals(sessions);
  const periodEvents = source.filter((event) => {
    if (!bounds) return true;
    const start = getEventTime(event);
    const end = getEventEndTime(event) || start;
    return start && end && end >= bounds.start && start < bounds.end;
  });
  const moments = periodEvents.filter(isPointEvent);
  const groups = new Map();

  sessions.filter((session) => isPrimaryActivityCategory(session.category)).forEach((session) => {
    const definition = getCategoryDefinition(session.category);
    const group = groups.get(session.category) || {
      label: session.category,
      color: definition.color,
      icon: definition.icon,
      seconds: 0,
      sessions: [],
      allSessions: [],
      nestedSessions: []
    };
    if (!group.allSessions.some((candidate) => candidate.id === session.id)) group.allSessions.push(session);
    groups.set(session.category, group);
  });

  allocatedSessions.forEach((session) => {
    if (!isPrimaryActivityCategory(session.category)) return;
    const definition = getCategoryDefinition(session.category);
    const group = groups.get(session.category) || {
      label: session.category,
      color: definition.color,
      icon: definition.icon,
      seconds: 0,
      sessions: [],
      allSessions: [],
      nestedSessions: []
    };
    group.seconds += session.allocatedSeconds;
    group.sessions.push(session);
    groups.set(session.category, group);
  });
  sessions.filter((session) => session.endAt).forEach((nested) => {
    const parent = sessions.find((candidate) => (
      candidate !== nested
      && candidate.endAt
      && candidate.rawCategory !== nested.rawCategory
      && candidate.startAt <= nested.startAt
      && candidate.endAt >= nested.endAt
    ));
    const group = parent && groups.get(parent.category);
    if (group && !group.nestedSessions.some((candidate) => candidate.id === nested.id)) group.nestedSessions.push(nested);
  });

  const sessionCategories = [...groups.values()].sort((left, right) => right.seconds - left.seconds || left.label.localeCompare(right.label));
  const categories = sessionCategories.filter((category) => category.seconds > 0);
  const timedSeconds = categories.reduce((sum, category) => sum + category.seconds, 0);
  const timezone = bounds?.timezone || APP_TIMEZONE;
  const pointCategories = buildPointCategories(moments, timezone);
  return {
    sourceEvents: sortLifeEvents(rawSource),
    suppressedEvents: precedence.suppressed,
    events: sortLifeEvents(periodEvents),
    sessions,
    allocatedSessions,
    moments: sortLifeEvents(moments),
    momentGroups: groupMoments(moments, timezone),
    activityEntries: buildActivityEntries(periodEvents, timezone),
    categories,
    sessionCategories,
    pointCategories,
    timedSeconds,
    activeCount: sessions.filter((session) => session.kind === 'active').length,
    incompleteCount: sessions.filter((session) => session.kind === 'incomplete').length,
    coveredDays: new Set(allocatedSessions.map((session) => (
      getDateIdInTimezone(session.startAt, bounds?.timezone || session.timezone || APP_TIMEZONE)
    ))).size
  };
}

function isWorkoutTimelineSession(session) {
  const event = session?.event || {};
  return /workout/.test(cleanToken(session?.rawCategory || event.activityFamily || event.eventType));
}

function timelineSessions(analysis) {
  const sessions = Array.isArray(analysis?.sessions) ? analysis.sessions : [];
  const workoutSessions = sessions.filter((session) => isWorkoutTimelineSession(session) && session.endAt);
  const preferredWorkoutIds = new Set(deduplicateNestedWorkouts(workoutSessions).map((session) => session.id));
  return sessions.filter((session) => (
    !isWorkoutTimelineSession(session)
    || !session.endAt
    || preferredWorkoutIds.has(session.id)
  ));
}

function findTimelineParent(session, sessions) {
  if (!session?.endAt) return null;
  return sessions
    .filter((candidate) => (
      candidate !== session
      && candidate.endAt
      && candidate.rawCategory !== session.rawCategory
      && candidate.startAt <= session.startAt
      && candidate.endAt >= session.endAt
    ))
    .sort((left, right) => (
      (left.endAt - left.startAt) - (right.endAt - right.startAt)
      || String(left.id).localeCompare(String(right.id))
    ))[0] || null;
}

function timelineEntryComparator(left, right) {
  const dateOrder = String(left.dateId || 'unknown').localeCompare(String(right.dateId || 'unknown'));
  if (dateOrder) return dateOrder;
  if (left.at && !right.at) return -1;
  if (!left.at && right.at) return 1;
  return (left.at?.getTime() || 0) - (right.at?.getTime() || 0)
    || String(left.stableIdentity).localeCompare(String(right.stableIdentity));
}

// “What happened” combines reliable sessions with point-in-time moments. It
// never contributes new duration: all totals still come from allocateIntervals.
// Date-only records sort after timed records and keep an honest null clock time.
export function buildChronologicalActivityTimeline(analysis, timeZone = APP_TIMEZONE) {
  const sessions = timelineSessions(analysis);
  const sessionEntries = sessions.map((session) => {
    const parent = findTimelineParent(session, sessions);
    const definition = getCategoryDefinition(session.category);
    const stableIdentity = stableEventIdentity(session.startEvent)
      || stableEventIdentity(session.endEvent)
      || String(session.id);
    const status = session.active
      ? 'In progress'
      : session.kind === 'incomplete'
        ? session.incompleteReason === 'superseded_by_arrival' ? 'Ended elsewhere' : 'Incomplete'
        : 'Completed';
    return {
      id: `session:${session.id}`,
      stableIdentity,
      type: 'session',
      category: session.category,
      pointCategory: null,
      color: definition.color,
      icon: definition.icon,
      title: session.title || getSessionDisplayName(session),
      at: session.startAt,
      endAt: session.endAt,
      dateId: getDateIdInTimezone(session.startAt, timeZone),
      timeRecorded: true,
      durationSeconds: session.durationSeconds,
      active: Boolean(session.active),
      incomplete: session.kind === 'incomplete',
      status,
      statusDetail: getIncompleteSessionMessage(session),
      nested: Boolean(parent),
      parentId: parent?.id || null,
      parentTitle: parent?.title || null,
      location: session.location || '',
      startEvent: session.startEvent || null,
      endEvent: session.endEvent || null,
      startSentAt: getEventSentTime(session.startEvent),
      endSentAt: getEventSentTime(session.endEvent),
      session
    };
  });

  const momentEntries = (Array.isArray(analysis?.momentGroups) ? analysis.momentGroups : []).map((group) => {
    const event = group.events.find((candidate) => getActivityDisplayTime(candidate)) || group.events[0];
    const definition = getPointCategoryDefinition(group.pointCategory);
    return {
      id: `moment:${group.id}`,
      stableIdentity: stableEventIdentity(event) || group.id,
      type: 'moment',
      category: group.category,
      pointCategory: group.pointCategory,
      color: definition.color,
      icon: definition.icon,
      title: group.title,
      at: group.firstAt || null,
      endAt: null,
      dateId: group.dateId || getDateIdInTimezone(getEventTime(event), timeZone) || 'unknown',
      timeRecorded: Boolean(group.firstAt),
      durationSeconds: null,
      count: group.count,
      details: group.details || getMeaningfulEventDetails(event),
      sentAt: getEventSentTime(event),
      receivedAt: getEventReceivedTime(event),
      sourceApp: event?.sourceApp || '',
      event,
      events: group.events
    };
  });

  const entries = [...sessionEntries, ...momentEntries].sort(timelineEntryComparator);
  const groups = new Map();
  entries.forEach((entry) => {
    const dateId = entry.dateId || 'unknown';
    const group = groups.get(dateId) || [];
    group.push(entry);
    groups.set(dateId, group);
  });
  return {
    entries,
    groups: [...groups.entries()]
      .map(([dateId, items]) => ({ dateId, entries: items }))
      .sort((left, right) => left.dateId.localeCompare(right.dateId))
  };
}

function positionWithinDay(value, bounds) {
  const date = toJsDate(value);
  if (!date || !bounds?.start || !bounds?.end || bounds.end <= bounds.start) return null;
  const percentage = ((date.getTime() - bounds.start.getTime()) / (bounds.end.getTime() - bounds.start.getTime())) * 100;
  return Math.max(0, Math.min(100, percentage));
}

export function buildDayActivityChart(analysis, bounds, now = new Date()) {
  if (!bounds || bounds.period !== 'day') return null;
  const timeline = buildChronologicalActivityTimeline(analysis, bounds.timezone || APP_TIMEZONE);
  const nowDate = toJsDate(now) || new Date();
  const rows = timeline.entries.filter((entry) => entry.type === 'session').map((entry) => {
    const startOffset = positionWithinDay(entry.at, bounds);
    const effectiveEnd = entry.active
      ? new Date(Math.min(nowDate.getTime(), bounds.end.getTime()))
      : entry.endAt;
    const endOffset = positionWithinDay(effectiveEnd, bounds);
    const hasReliableInterval = startOffset !== null && endOffset !== null && effectiveEnd > entry.at;
    return {
      ...entry,
      offset: startOffset,
      width: hasReliableInterval ? Math.max(0, endOffset - startOffset) : 0,
      hasReliableInterval
    };
  });
  const moments = timeline.entries
    .filter((entry) => entry.type === 'moment' && entry.at)
    .map((entry) => ({ ...entry, offset: positionWithinDay(entry.at, bounds) }));
  const currentOffset = nowDate >= bounds.start && nowDate < bounds.end
    ? positionWithinDay(nowDate, bounds)
    : null;
  return {
    rows,
    moments,
    currentOffset,
    trackedSeconds: Number(analysis?.timedSeconds || 0)
  };
}

function workoutDetailScore(session) {
  const title = cleanToken(session?.title);
  const metadata = session?.event?.metadata || {};
  let score = session?.kind === 'reported' ? 4 : 0;
  if (title && !/^(?:workout|started_?workout|workout_?started)$/.test(title)) score += 8;
  if (metadata.routineName || metadata.focus) score += 4;
  if (Array.isArray(metadata.exerciseSummaries) && metadata.exerciseSummaries.length) score += 6;
  return score;
}

function workoutsDescribeSameSession(left, right) {
  if (!left.endAt || !right.endAt) return false;
  const overlap = Math.max(0, Math.min(left.endAt, right.endAt) - Math.max(left.startAt, right.startAt));
  const shorter = Math.min(left.endAt - left.startAt, right.endAt - right.startAt);
  return shorter > 0 && (overlap / shorter) >= 0.8;
}

function deduplicateNestedWorkouts(workouts) {
  const chosen = [];
  [...workouts]
    .sort((left, right) => workoutDetailScore(right) - workoutDetailScore(left) || left.startAt - right.startAt)
    .forEach((workout) => {
      if (!chosen.some((candidate) => workoutsDescribeSameSession(candidate, workout))) chosen.push(workout);
    });
  return chosen
    .map((workout) => {
      if (workout.location) return workout;
      const related = workouts.find((candidate) => candidate.location && workoutsDescribeSameSession(candidate, workout));
      return related ? { ...workout, location: related.location } : workout;
    })
    .sort((left, right) => left.startAt - right.startAt);
}

function isWorkoutEvent(event) {
  return getTallyActivityLabel(event) === 'Gym/Fitness'
    && /workout/.test(`${cleanToken(event?.activityFamily)} ${cleanToken(event?.eventType)} ${cleanToken(event?.title)} ${cleanToken(event?.metadata?.routineName)}`);
}

function workoutStableIdentity(event) {
  const metadata = event?.metadata || {};
  return firstMeaningfulString(
    metadata.workoutId,
    metadata.parentWorkoutId,
    event?.sourceEventId,
    event?.sourceRecordId,
    metadata.sourceDocumentId
  );
}

function normalizeWorkoutExercises(event) {
  const metadata = event?.metadata || {};
  const exercises = Array.isArray(metadata.exerciseSummaries) ? metadata.exerciseSummaries : [];
  return exercises.map((exercise, exerciseIndex) => ({
    id: exercise.exerciseId || `${event?.id || 'workout'}-exercise-${exerciseIndex}`,
    name: firstMeaningfulString(exercise.name) || `Exercise ${exerciseIndex + 1}`,
    bestWeight: exercise.bestWeight ?? exercise.maxWeight ?? null,
    bestReps: exercise.bestReps ?? exercise.maxReps ?? null,
    bestVolume: exercise.bestVolume ?? null,
    sets: (Array.isArray(exercise.sets) ? exercise.sets : []).map((set, setIndex) => ({
      number: setIndex + 1,
      weight: set?.weight ?? null,
      reps: set?.reps ?? null,
      rpe: set?.rpe ?? null,
      completed: set?.completed ?? null,
      skipped: set?.skipped ?? null,
      bodyweight: set?.bodyweight ?? null,
      personalRecord: set?.personalRecord ?? set?.isPersonalRecord ?? null,
      notes: firstMeaningfulString(set?.notes, set?.note)
    }))
  }));
}

function richWorkoutScore(event) {
  const metadata = event?.metadata || {};
  let score = 0;
  if (workoutStableIdentity(event)) score += 4;
  if (metadata.routineName || (event?.title && !/^started|finished/i.test(event.title))) score += 5;
  if (Array.isArray(metadata.exerciseSummaries) && metadata.exerciseSummaries.length) score += 20;
  if (event?.eventClass === 'completed_activity') score += 5;
  if (/gym-k2/i.test(event?.sourceApp || '')) score += 5;
  if (getEventEndTime(event)) score += 3;
  return score;
}

function sameWorkoutInterval(session, event, timeZone) {
  if (!session?.endAt) return false;
  const start = getEventTime(event);
  const end = getEventEndTime(event);
  if (!start) return false;
  if (start >= session.startAt && start <= session.endAt) return true;
  if (end) {
    const overlap = Math.max(0, Math.min(session.endAt, end) - Math.max(session.startAt, start));
    const shorter = Math.min(session.endAt - session.startAt, end - start);
    if (shorter > 0 && overlap / shorter >= 0.6) return true;
  }
  return getDateIdInTimezone(start, timeZone) === getDateIdInTimezone(session.startAt, timeZone)
    && Math.abs(start - session.startAt) <= 2 * 3600 * 1000;
}

export function buildWorkoutRecords(events, sessions, timeZone = APP_TIMEZONE) {
  const workoutEvents = sortLifeEvents(events).filter(isWorkoutEvent);
  const workoutSessions = sessions.filter((session) => isWorkoutEvent(session.event) && session.endAt);
  const richEvents = workoutEvents.filter((event) => richWorkoutScore(event) >= 9)
    .sort((left, right) => richWorkoutScore(right) - richWorkoutScore(left));
  const usedSessions = new Set();
  const records = [];

  richEvents.forEach((event) => {
    const identity = workoutStableIdentity(event);
    if (identity && records.some((record) => record.identity === identity)) return;
    const direct = workoutSessions.find((session) => session.event === event || session.event?.id === event.id);
    const stable = identity && workoutSessions.find((session) => workoutStableIdentity(session.event) === identity);
    const correlated = workoutSessions.find((session) => !usedSessions.has(session.id) && sameWorkoutInterval(session, event, timeZone));
    const boundary = direct || stable || correlated || null;
    const contextualBoundary = [stable, correlated].find((session) => session && session !== direct) || boundary;
    workoutSessions
      .filter((session) => session === boundary || sameWorkoutInterval(session, event, timeZone))
      .forEach((session) => usedSessions.add(session.id));
    const explicitEnd = getEventEndTime(event);
    const explicitDuration = getEventDurationSeconds(event);
    const hasReliableRichInterval = Boolean(explicitEnd) || (Number.isFinite(explicitDuration) && explicitDuration > 0);
    const startAt = hasReliableRichInterval ? getEventTime(event) : (contextualBoundary?.startAt || boundary?.startAt || getEventTime(event));
    const endAt = hasReliableRichInterval ? (explicitEnd || new Date(startAt.getTime() + (explicitDuration * 1000))) : (contextualBoundary?.endAt || boundary?.endAt || null);
    const durationSeconds = startAt && endAt && endAt > startAt ? (endAt - startAt) / 1000 : getEventDurationSeconds(event);
    const metadata = event.metadata || {};
    const exercises = normalizeWorkoutExercises(event);
    const recordedSetCount = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    const routineName = firstMeaningfulString(metadata.routineName, event.title, metadata.focus?.[0]) || 'Workout';
    records.push({
      id: `workout-${identity || event.id || startAt?.getTime()}`,
      identity: identity || '',
      title: /workout$/i.test(routineName) ? routineName : `${humanize(routineName)} Workout`,
      event,
      startEvent: contextualBoundary?.startEvent || boundary?.startEvent || (boundary?.kind === 'reported' ? event : null),
      endEvent: contextualBoundary?.endEvent || boundary?.endEvent || (getEventEndTime(event) ? event : null),
      startAt,
      endAt,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      location: getLocationLabel(event) || contextualBoundary?.location || boundary?.location || '',
      exercises,
      exerciseCount: Number(metadata.exerciseCount) || exercises.length,
      setCount: Number(metadata.allSetCount) || recordedSetCount,
      notes: firstMeaningfulString(metadata.notes, metadata.note),
      sourceSentAt: getEventSentTime(event),
      receivedAt: getEventReceivedTime(event),
      completed: event.eventClass === 'completed_activity' || Boolean(getEventEndTime(event) || boundary?.endAt),
      hasExplicitSetStatus: exercises.some((exercise) => exercise.sets.some((set) => set.completed !== null || set.skipped !== null)),
      hasPersonalRecordFlags: exercises.some((exercise) => exercise.sets.some((set) => set.personalRecord !== null))
    });
  });

  deduplicateNestedWorkouts(workoutSessions.filter((session) => !usedSessions.has(session.id))).forEach((session) => {
    records.push({
      id: `workout-${session.id}`,
      identity: workoutStableIdentity(session.event),
      title: /workout$/i.test(session.title || '') ? session.title : `${session.title || 'Workout'} Workout`,
      event: session.event,
      startEvent: session.startEvent,
      endEvent: session.endEvent,
      startAt: session.startAt,
      endAt: session.endAt,
      durationSeconds: session.durationSeconds,
      location: session.location,
      exercises: [],
      exerciseCount: 0,
      setCount: 0,
      notes: '',
      sourceSentAt: getEventSentTime(session.event),
      receivedAt: getEventReceivedTime(session.event),
      completed: Boolean(session.endAt),
      hasExplicitSetStatus: false,
      hasPersonalRecordFlags: false
    });
  });

  return records.sort((left, right) => (left.startAt?.getTime() || 0) - (right.startAt?.getTime() || 0));
}

export function buildWorkAttendance(sessions, timeZone = APP_TIMEZONE) {
  const seen = new Set();
  return sessions
    .filter((session) => session.category === 'Work')
    .map((session) => {
      const arrivalEvent = session.startEvent || (session.missingBoundary === 'start' ? null : session.event);
      const departureEvent = session.endEvent || null;
      const arrivedAt = arrivalEvent ? getEventTime(arrivalEvent) : null;
      const leftAt = departureEvent ? (getEventTime(departureEvent) || getEventEndTime(departureEvent)) : null;
      const location = session.location || getLocationLabel(arrivalEvent) || getLocationLabel(departureEvent);
      const status = session.active
        ? 'In progress'
        : session.incompleteReason === 'superseded_by_arrival'
          ? 'Ended elsewhere'
          : session.missingBoundary
            ? 'Incomplete'
            : session.endAt
              ? 'Completed'
              : 'Incomplete';
      const notes = [arrivalEvent, departureEvent]
        .map((event) => getMeaningfulEventDetails(event).note)
        .filter(Boolean);
      return {
        id: `attendance-${session.id}`,
        session,
        dateId: getDateIdInTimezone(arrivedAt || leftAt || session.startAt, timeZone),
        title: location ? `Workday at ${location}` : 'Workday',
        location,
        arrivedAt,
        leftAt,
        totalSeconds: Number.isFinite(session.durationSeconds) ? session.durationSeconds : null,
        status,
        statusDetail: getIncompleteSessionMessage(session),
        missingBoundary: session.missingBoundary || null,
        supersededByLocation: session.supersededByLocation || '',
        arrivalEvent,
        departureEvent,
        arrivalSentAt: getEventSentTime(arrivalEvent),
        departureSentAt: getEventSentTime(departureEvent),
        arrivalReceivedAt: getEventReceivedTime(arrivalEvent),
        departureReceivedAt: getEventReceivedTime(departureEvent),
        notes
      };
    })
    .filter((row) => {
      const key = `${row.arrivedAt?.toISOString() || 'missing'}|${row.leftAt?.toISOString() || 'missing'}|${row.location}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (right.arrivedAt || right.leftAt || 0) - (left.arrivedAt || left.leftAt || 0));
}

export function buildPointCategoryAnalysis(category) {
  if (!category) return null;
  return {
    ...category,
    totalSeconds: category.seconds,
    reliableDuration: category.seconds > 0,
    entries: [...category.entries].sort((left, right) => {
      if (left.firstAt && !right.firstAt) return -1;
      if (!left.firstAt && right.firstAt) return 1;
      return (left.firstAt?.getTime() || 0) - (right.firstAt?.getTime() || 0)
        || String(left.id).localeCompare(String(right.id));
    })
  };
}

export function buildCategoryAnalysis(category, analysis, previousAnalysis, bounds, recentAnalyses = []) {
  if (!category) return null;
  const completeSessions = category.allSessions.filter((session) => session.endAt || session.active);
  const workouts = category.label === 'Gym/Fitness'
    ? buildWorkoutRecords(analysis.events, analysis.sessions, bounds?.timezone || APP_TIMEZONE)
    : [];
  const gymVisits = category.label === 'Gym/Fitness'
    ? completeSessions.filter((session) => !isWorkoutEvent(session.event))
      .map((session) => {
        if (session.location) return session;
        const nested = workouts.find((workout) => (
          workout.location
          && workout.startAt
          && workout.endAt
          && workout.startAt >= session.startAt
          && workout.endAt <= session.endAt
        ));
        if (!nested) return session;
        const enriched = { ...session, location: nested.location };
        return { ...enriched, title: getSessionDisplayName(enriched) };
      })
    : [];
  const primarySessions = category.label === 'Gym/Fitness' && gymVisits.length ? gymVisits : completeSessions;
  const historySessions = category.label === 'Gym/Fitness'
    ? category.allSessions
      .filter((session) => !isWorkoutEvent(session.event))
      .map((session) => gymVisits.find((visit) => visit.id === session.id) || session)
    : category.allSessions;
  const sessions = [...historySessions].sort((left, right) => left.startAt - right.startAt);
  const attendance = category.label === 'Work'
    ? buildWorkAttendance(category.allSessions, bounds?.timezone || APP_TIMEZONE)
    : [];
  const activeDays = new Set(
    (category.label === 'Work' ? attendance : primarySessions)
      .map((item) => item.dateId || getDateIdInTimezone(item.startAt, bounds?.timezone || APP_TIMEZONE))
      .filter(Boolean)
  ).size;
  const durations = primarySessions.map((session) => session.durationSeconds).filter((value) => Number.isFinite(value) && value > 0);
  const previous = previousAnalysis?.categories?.find((candidate) => candidate.label === category.label);
  const recentSeconds = recentAnalyses
    .map((recent) => recent?.categories?.find((candidate) => candidate.label === category.label)?.seconds)
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  const locations = new Map();
  primarySessions.forEach((session) => {
    if (!session.location) return;
    const current = locations.get(session.location) || { label: session.location, seconds: 0, visits: 0 };
    current.seconds += session.durationSeconds || 0;
    current.visits += 1;
    locations.set(session.location, current);
  });
  const totalWorkoutSeconds = workouts.reduce((sum, workout) => sum + (workout.durationSeconds || 0), 0);
  const reliableSessionCount = primarySessions.length;
  const sessionCount = historySessions.filter((session) => session.missingBoundary !== 'start').length;
  return {
    label: category.label,
    color: category.color,
    icon: category.icon,
    totalSeconds: category.seconds,
    sessionCount,
    reliableSessionCount,
    activeDays,
    averageSessionSeconds: reliableSessionCount ? category.seconds / reliableSessionCount : 0,
    averageActiveDaySeconds: activeDays ? category.seconds / activeDays : 0,
    longestSeconds: durations.length ? Math.max(...durations) : 0,
    shortestSeconds: durations.length ? Math.min(...durations) : 0,
    firstStart: primarySessions[0]?.startAt || null,
    lastEnd: primarySessions.at(-1)?.endAt || null,
    activeSession: sessions.find((session) => session.active) || null,
    previousSeconds: previous?.seconds || 0,
    hasPrevious: Boolean(previous),
    deltaSeconds: category.seconds - (previous?.seconds || 0),
    recentAverageSeconds: recentSeconds.length >= 2
      ? recentSeconds.reduce((sum, seconds) => sum + seconds, 0) / recentSeconds.length
      : 0,
    recentPeriodCount: recentSeconds.length,
    locations: [...locations.values()].sort((left, right) => right.seconds - left.seconds),
    workouts,
    workoutCount: workouts.filter((workout) => workout.completed).length,
    totalWorkoutSeconds,
    attendance,
    sessions
  };
}

export function buildCategoryInsight(categoryAnalysis) {
  if (!categoryAnalysis) return '';
  const { label, totalSeconds, sessionCount, reliableSessionCount, activeDays, averageSessionSeconds, hasPrevious, deltaSeconds, workoutCount, recentAverageSeconds, recentPeriodCount } = categoryAnalysis;
  if (sessionCount > 0 && reliableSessionCount === 0) {
    return `${sessionCount} ${label === 'Gym/Fitness' ? (sessionCount === 1 ? 'visit was' : 'visits were') : (sessionCount === 1 ? 'session was' : 'sessions were')} recorded, but missing boundaries keep uncertain time out of your totals.`;
  }
  const normalDelta = recentPeriodCount >= 2 ? totalSeconds - recentAverageSeconds : 0;
  const normalComparison = Math.abs(normalDelta) >= 60
    ? `, ${formatDuration(Math.abs(normalDelta))} ${normalDelta > 0 ? 'more' : 'less'} than your recent average`
    : '';
  if (label === 'Gym/Fitness') {
    return `You spent ${formatDuration(totalSeconds)} at the gym across ${sessionCount} ${sessionCount === 1 ? 'visit' : 'visits'}, averaging ${formatDuration(averageSessionSeconds)}${workoutCount ? `, with ${workoutCount} recorded ${workoutCount === 1 ? 'workout' : 'workouts'}` : ''}${normalComparison}.`;
  }
  if (label === 'Sleep') {
    return `You recorded ${formatDuration(totalSeconds)} of sleep across ${activeDays} ${activeDays === 1 ? 'night' : 'nights'}, averaging ${formatDuration(activeDays ? totalSeconds / activeDays : 0)}${normalComparison}.`;
  }
  if (label === 'Work') {
    const comparison = hasPrevious && deltaSeconds !== 0
      ? `, ${formatDuration(Math.abs(deltaSeconds))} ${deltaSeconds > 0 ? 'more' : 'less'} than the previous period`
      : '';
    return `You worked ${formatDuration(totalSeconds)} across ${activeDays} ${activeDays === 1 ? 'day' : 'days'}${comparison || normalComparison}.`;
  }
  return `${label} accounted for ${formatDuration(totalSeconds)} across ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}.`;
}

export function getActivityTallyRange(rangeId, now = new Date(), timeZone = APP_TIMEZONE) {
  const today = getLocalDateId(now, timeZone);
  const end = getPeriodBounds('day', shiftPeriodDate(today, 'day', 1, timeZone), timeZone).start;
  if (rangeId === 'year') return { id: 'year', label: String(zonedParts(now, timeZone).year), start: getPeriodBounds('year', today, timeZone).start, end };
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

export function buildActivityTallies(events, options = {}) {
  const safeEvents = sortLifeEvents(events);
  const analysis = buildPeriodAnalysis(safeEvents, null, options);
  const firstAndLast = new Map();
  safeEvents.forEach((event) => {
    const label = getTallyActivityLabel(event);
    if (!isPrimaryActivityCategory(label)) return;
    const at = getEventTime(event);
    if (!at) return;
    const values = firstAndLast.get(label) || { firstAt: at, lastAt: at };
    if (at < values.firstAt) values.firstAt = at;
    if (at > values.lastAt) values.lastAt = at;
    firstAndLast.set(label, values);
  });
  return analysis.categories
    .filter((category) => category.seconds > 0)
    .map((category) => {
      const days = new Set(category.sessions.map((session) => getDateIdInTimezone(session.startAt, session.timezone)));
      const dates = firstAndLast.get(category.label) || {};
      return {
        label: category.label,
        totalSeconds: category.seconds,
        sessionCount: category.sessions.length,
        dayCount: days.size,
        averageSeconds: category.sessions.length ? category.seconds / category.sessions.length : 0,
        firstAt: dates.firstAt || category.sessions[0]?.startAt || null,
        lastAt: dates.lastAt || category.sessions.at(-1)?.endAt || null,
        sessions: category.sessions,
        color: category.color,
        icon: category.icon
      };
    });
}

export function filterLifeEvents(events, selection) {
  const safeEvents = Array.isArray(events) ? events : [];
  if (!selection) return safeEvents;
  if (selection.kind === 'event') return safeEvents.filter((event) => event.id === selection.value);
  if (selection.kind === 'source') return safeEvents.filter((event) => String(event.sourceApp || '').toLowerCase() === String(selection.value || '').toLowerCase());
  if (selection.kind === 'category') return safeEvents.filter((event) => getTallyActivityLabel(event).toLowerCase() === String(selection.value || '').toLowerCase());
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
  return buildPeriodAnalysis(events).categories.map((category) => ({ ...category, value: category.seconds, usesDuration: true, count: category.sessions.length }));
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
  return { currentSeconds, previousSeconds, deltaSeconds: currentSeconds - previousSeconds, hasPrevious: Boolean(previous && (previous.events?.length || previous.timedSeconds)) };
}

export function buildDailyInsight(events, bounds = null, options = {}) {
  const analysis = buildPeriodAnalysis(events, bounds, options);
  if (!analysis.events.length) return 'No activities were recorded for this period. That may mean a quiet period or incomplete source coverage.';
  if (!analysis.timedSeconds) return `${analysis.momentGroups.length} ${analysis.momentGroups.length === 1 ? 'moment was' : 'moments were'} recorded, but no complete timed sessions are available yet.`;
  const leading = analysis.categories[0];
  return `${leading.label} was your largest time category at ${formatDuration(leading.seconds)}.${analysis.incompleteCount ? ` ${analysis.incompleteCount} incomplete session${analysis.incompleteCount === 1 ? '' : 's'} may affect the picture.` : ''}`;
}

export function buildActivityAnalysis(events, bounds = null, options = {}) {
  const analysis = buildPeriodAnalysis(events, bounds, options);
  const firstAt = analysis.sessions[0]?.startAt || getEventTime(analysis.events[0]);
  const lastAt = analysis.sessions.at(-1)?.endAt || getEventTime(analysis.events.at(-1));
  return {
    eventCount: analysis.events.length,
    sourceCount: new Set(analysis.events.map((event) => event.sourceApp).filter(Boolean)).size,
    sessionCount: analysis.allocatedSessions.length,
    activityDayCount: analysis.coveredDays,
    trackedSeconds: analysis.timedSeconds,
    averageSessionSeconds: analysis.allocatedSessions.length ? analysis.timedSeconds / analysis.allocatedSessions.length : 0,
    firstAt,
    lastAt,
    spanSeconds: firstAt && lastAt ? Math.max(0, (lastAt - firstAt) / 1000) : 0,
    averageDeliverySeconds: null,
    deliveredCount: 0,
    eventTypes: [],
    sessions: analysis.sessions,
    moments: analysis.moments
  };
}

export const ACTIVITY_COLORS = Object.values(CATEGORY_DEFINITIONS).map((definition) => definition.color);

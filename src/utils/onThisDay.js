import { addYears, formatDateId, getEventsForDate, parseDateId } from './dateUtils.js';
import { formatDuration } from './lifeEventUtils.js';
import { ratingLabel, lifeWeekFor } from './weeklyReview.js';

/** How far back "On this day" looks. */
export const ON_THIS_DAY_YEARS = Object.freeze([1, 2, 5, 10]);

const NOTE_MAX = 220;
const ACTIVITY_LIMIT = 3;

const clip = (text, max = NOTE_MAX) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
// Quick capture writes "7:24 PM: the line"; the time isn't part of what happened.
const withoutTime = (line) => line.replace(/^\d{1,2}:\d{2}\s?[AP]M:\s*/i, '').trim();
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const longDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * The same day 1, 2, 5 and 10 years ago, as YYYY-MM-DD. A Feb 29 falls back to Feb 28 in a year without one (rather
 * than rolling on to Mar 1), and nothing before the birth date is asked for.
 */
export function onThisDayDates(todayId, { birthDate = '', years = ON_THIS_DAY_YEARS } = {}) {
  if (!todayId) return [];
  const today = parseDateId(todayId);
  return years
    .map((yearsAgo) => {
      const same = addYears(today, -yearsAgo);
      if (same.getMonth() !== today.getMonth()) same.setDate(0);
      return { yearsAgo, dateId: formatDateId(same) };
    })
    .filter(({ dateId }) => !birthDate || dateId >= birthDate);
}

/** The lines written down that day, without quick capture's times. */
export function noteLines(entry) {
  const text = String(entry?.notes || '').trim() || String(entry?.journalText || '').trim();
  return text.split('\n').map(withoutTime).filter(Boolean);
}

/**
 * Calendar events on that day. An ongoing or every-day event (where you lived, a job) would be on every day, so it is
 * only named on the day it started.
 */
export function eventsOnDay(events, dateId) {
  return getEventsForDate(Array.isArray(events) ? events : [], dateId)
    .filter((event) => event.startDate === dateId || !(event.ongoing || event.everyDay))
    .map((event) => {
      if (event.startDate === dateId) return event.endDate && event.endDate !== dateId ? `${event.title} began` : event.title;
      return `${event.title} (${shortDate(event.startDate)} to ${shortDate(event.endDate)})`;
    });
}

function describeAttachments(attachments = []) {
  if (!attachments.length) return '';
  const images = attachments.filter((attachment) => attachment.type === 'image').length;
  const others = attachments.length - images;
  return [images && plural(images, 'photo', 'photos'), others && plural(others, 'file', 'files')].filter(Boolean).join(' and ') + ' saved';
}

function describeReview(review) {
  if (!review) return '';
  const said = String(review.moment || review.mattered || '').trim();
  const rating = ratingLabel(review.rating);
  if (said) return clip(rating ? `${rating} week: ${said}` : said);
  return rating ? `${rating} week` : '';
}

/** "Gym 1h 10m · Work 7h 52m" from a day's activity categories (biggest first). */
export function describeActivity(categories = []) {
  return categories
    .filter((category) => category.seconds >= 60)
    .slice(0, ACTIVITY_LIMIT)
    .map((category) => `${category.label} ${formatDuration(category.seconds)}`)
    .join(' · ');
}

/**
 * What happened on this day in earlier years. Each year with something in it gets a group, most recent first:
 * { yearsAgo, dateId, heading, items: [{ kind, text }] }. Kinds: note, event, attachments, review, activity.
 *
 * `entries` and `attachments` are keyed by date, `reviews` by life-week start, and `activity` by date, holding that
 * day's categories from buildPeriodAnalysis. Whatever the reader can't see simply isn't passed in.
 */
export function buildOnThisDay({ todayId, birthDate = '', events = [], entries = {}, attachments = {}, reviews = {}, activity = {}, years } = {}) {
  return onThisDayDates(todayId, { birthDate, years })
    .map(({ yearsAgo, dateId }) => {
      const items = [];
      const notes = noteLines(entries[dateId]);
      notes.forEach((line) => items.push({ kind: 'note', text: clip(line) }));
      eventsOnDay(events, dateId).forEach((text) => items.push({ kind: 'event', text }));
      const saved = describeAttachments(attachments[dateId] || []);
      if (saved) items.push({ kind: 'attachments', text: saved });
      const week = birthDate ? lifeWeekFor(birthDate, dateId) : null;
      const review = describeReview(week && reviews[week.start]);
      if (review) items.push({ kind: 'review', text: `That week: ${review}` });
      const tracked = describeActivity(activity[dateId] || []);
      if (tracked) items.push({ kind: 'activity', text: tracked });
      return {
        yearsAgo,
        dateId,
        heading: `${yearsAgo === 1 ? '1 year' : `${yearsAgo} years`} ago · ${longDate(dateId)}`,
        items
      };
    })
    .filter((group) => group.items.length > 0);
}

// What reads best on its own in one line: something written or a named event before a count of photos or hours.
const HEADLINE_ORDER = ['note', 'event', 'review', 'attachments', 'activity'];

/** The one line on the calendar: "On this day 1 year ago: Playing darts with David", plus how many more years. */
export function onThisDayHeadline(groups = []) {
  if (!groups.length) return '';
  const [first, ...rest] = groups;
  const item = HEADLINE_ORDER.map((kind) => first.items.find((candidate) => candidate.kind === kind)).find(Boolean);
  const when = first.yearsAgo === 1 ? '1 year ago' : `${first.yearsAgo} years ago`;
  const more = rest.length ? ` · and ${rest.length === 1 ? '1 more year' : `${rest.length} more years`}` : '';
  // A sentence's full stop would sit oddly before the " · ".
  const text = more ? clip(item.text, 120).replace(/\.$/, '') : clip(item.text, 120);
  return `On this day ${when}: ${text}${more}`;
}

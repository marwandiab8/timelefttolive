import { parseDateId } from './dateUtils.js';
import { formatHeight } from './childMeasurements.js';
import { noteLines } from './onThisDay.js';
import { ratingLabel } from './weeklyReview.js';

/** At least this many letters before anything is searched, so one keystroke doesn't list everything. */
export const MIN_QUERY_LENGTH = 2;
const SNIPPET_RADIUS = 70;

const KIND_LABELS = Object.freeze({ note: 'Day note', event: 'Event', review: 'Weekly review', plan: 'To do', measurement: 'Height' });
export const kindLabel = (kind) => KIND_LABELS[kind] || kind;

// Case and accents don't matter: "cafe" finds "Café". Each character maps to one, so positions line up with the
// original text for highlighting.
const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
const foldForMatch = (text) => {
  const source = String(text || '');
  // Fold character by character so an index in the folded text is the same index in the original.
  return Array.from(source).map((char) => {
    const folded = fold(char);
    return folded.length === char.length ? folded : char;
  }).join('');
};

const isDateId = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const longDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The words to look for. Every word has to be there, in any order; "quoted words" have to be there together.
 * Returns folded terms, longest first so a highlight covers the longer match.
 */
export function parseQuery(query) {
  const terms = [];
  String(query || '').replace(/"([^"]*)"|(\S+)/g, (_, phrase, word) => {
    const term = fold((phrase ?? word).trim());
    if (term) terms.push(term);
    return '';
  });
  return [...new Set(terms)].sort((left, right) => right.length - left.length);
}

/**
 * Everything that can be searched, one record per thing: { kind, id, dateId, title, when, text, keywords, ref }.
 * `keywords` are found but not shown (who a plan is for; "height"). `ref` is what opening it needs (the date, the
 * week, the plan or the child). Whatever the reader can't see simply isn't passed in.
 */
export function buildSearchRecords({ entries = [], events = [], reviews = {}, plans = [], measurements = [], children = [] } = {}) {
  const records = [];
  const names = new Map(children.map((child) => [child.id, child.name || 'Unnamed child']));

  (Array.isArray(entries) ? entries : Object.values(entries)).forEach((entry) => {
    const dateId = entry?.dateId || entry?.id;
    const lines = noteLines(entry);
    if (!isDateId(dateId) || !lines.length) return;
    records.push({ kind: 'note', id: `note-${dateId}`, dateId, title: longDate(dateId), when: '', text: lines.join('\n'), ref: { dateId } });
  });

  events.forEach((event) => {
    if (!event?.title || !isDateId(event.startDate)) return;
    const ends = event.ongoing ? 'now' : (isDateId(event.endDate) && event.endDate !== event.startDate ? shortDate(event.endDate) : '');
    records.push({
      kind: 'event',
      id: `event-${event.id || `${event.title}-${event.startDate}`}`,
      dateId: event.startDate,
      title: event.title,
      when: ends ? `${shortDate(event.startDate)} to ${ends}` : shortDate(event.startDate),
      text: String(event.description || '').trim(),
      ref: { dateId: event.startDate }
    });
  });

  Object.values(reviews || {}).forEach((review) => {
    if (!isDateId(review?.weekStart)) return;
    const parts = [review.moment, review.mattered, review.intention && `Intention: ${review.intention}`].map((part) => String(part || '').trim()).filter(Boolean);
    if (!parts.length) return;
    const rating = ratingLabel(review.rating);
    records.push({
      kind: 'review',
      id: `review-${review.weekStart}`,
      dateId: review.weekStart,
      title: `Week of ${shortDate(review.weekStart)}`,
      when: rating ? `${rating} week` : '',
      text: parts.join('\n'),
      ref: { weekStart: review.weekStart }
    });
  });

  plans.forEach((plan) => {
    if (!plan?.title) return;
    const dateId = isDateId(plan.doneOn) ? plan.doneOn : (isDateId(plan.plannedWeekStart) ? plan.plannedWeekStart : '');
    records.push({
      kind: 'plan',
      id: `plan-${plan.id || plan.title}`,
      dateId,
      title: plan.title,
      when: plan.doneOn ? `Done ${shortDate(plan.doneOn)}` : (plan.plannedWeekStart ? `Planned for the week of ${shortDate(plan.plannedWeekStart)}` : 'Not done yet'),
      text: String(plan.notes || '').trim(),
      keywords: (plan.who || []).map((id) => names.get(id)).filter(Boolean).join(' '),
      ref: { planId: plan.id }
    });
  });

  measurements.forEach((measurement) => {
    if (!isDateId(measurement?.measuredOn)) return;
    const name = names.get(measurement.childId) || 'A child';
    const value = Number.isFinite(measurement.valueMm) ? formatHeight(measurement.valueMm) : String(measurement.asWritten || '').trim();
    records.push({
      kind: 'measurement',
      id: `measurement-${measurement.id || `${measurement.childId}-${measurement.measuredOn}`}`,
      dateId: measurement.measuredOn,
      title: `${name}, ${value}`,
      when: shortDate(measurement.measuredOn),
      text: [measurement.asWritten !== value && measurement.asWritten, measurement.note].map((part) => String(part || '').trim()).filter(Boolean).join(' · '),
      keywords: 'height',
      ref: { childId: measurement.childId, dateId: measurement.measuredOn }
    });
  });

  return records;
}

// Where each term appears in `text`, merged where they overlap: [[start, end], …].
function matchRanges(text, terms) {
  const folded = foldForMatch(text);
  const ranges = [];
  terms.forEach((term) => {
    let at = folded.indexOf(term);
    while (at !== -1) {
      ranges.push([at, at + term.length]);
      at = folded.indexOf(term, at + term.length);
    }
  });
  ranges.sort((left, right) => left[0] - right[0]);
  return ranges.reduce((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
    return merged;
  }, []);
}

/** `text` as parts to render, the matches marked: [{ text, match }]. */
export function highlight(text, terms) {
  const source = String(text || '');
  const parts = [];
  let at = 0;
  matchRanges(source, terms).forEach(([start, end]) => {
    if (start > at) parts.push({ text: source.slice(at, start), match: false });
    parts.push({ text: source.slice(start, end), match: true });
    at = end;
  });
  if (at < source.length) parts.push({ text: source.slice(at), match: false });
  return parts;
}

/**
 * The part of a long text around its first match, on one line, with "…" where it was cut. A short text is kept whole.
 */
export function snippet(text, terms, radius = SNIPPET_RADIUS) {
  const flat = String(text || '').replace(/\s*\n\s*/g, ' · ').trim();
  if (flat.length <= radius * 2) return flat;
  const [first] = matchRanges(flat, terms);
  if (!first) return `${flat.slice(0, radius * 2).trimEnd()}…`;
  let start = Math.max(0, first[0] - radius);
  let end = Math.min(flat.length, first[1] + radius);
  // Don't cut a word in half.
  if (start > 0) start = flat.indexOf(' ', start) + 1 || start;
  if (end < flat.length) end = flat.lastIndexOf(' ', end) > first[1] ? flat.lastIndexOf(' ', end) : end;
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/**
 * The records with every term in their title, date or text, newest first (undated plans last), each with a snippet:
 * { results: [{ ...record, snippet }], total }. Only the first `limit` are returned.
 */
export function searchRecords(records, query, { limit = 50 } = {}) {
  const terms = parseQuery(query);
  if (!terms.length || terms.join(' ').length < MIN_QUERY_LENGTH) return { results: [], total: 0, terms };
  const matches = records.filter((record) => {
    const haystack = fold(`${record.title}\n${record.when}\n${record.text}\n${record.keywords || ''}`);
    return terms.every((term) => haystack.includes(term));
  });
  matches.sort((left, right) => (right.dateId || '').localeCompare(left.dateId || '') || left.title.localeCompare(right.title));
  return {
    results: matches.slice(0, limit).map((record) => ({ ...record, snippet: snippet(record.text, terms) })),
    total: matches.length,
    terms
  };
}

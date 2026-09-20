// How a week's events are drawn on its square: the square is split into equal
// wedges, one per event. Pure helpers, so they can be tested without a DOM.

export const MAX_EVENT_WEDGES = 4;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Event colours end up inside an inline style, so only plain hex values are used.
export function isSafeColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * Picks the wedges for one week. Events keep the order they began in (ties
 * broken by id), so a long event holds the same slice from week to week as
 * far as it can. Events beyond MAX_EVENT_WEDGES are counted in `overflow`.
 */
export function pickWeekWedges(weekEvents, fallbackColor) {
  const ordered = [...(weekEvents || [])].sort((left, right) => (
    String(left.startDate || '').localeCompare(String(right.startDate || ''))
    || String(left.id || '').localeCompare(String(right.id || ''))
  ));
  const wedges = ordered.slice(0, MAX_EVENT_WEDGES).map((event) => ({
    id: event.id,
    title: event.title || 'Event',
    color: isSafeColor(event.color) ? event.color : fallbackColor
  }));
  return { wedges, overflow: Math.max(0, ordered.length - wedges.length) };
}

/** A CSS background: one colour for one event, equal pie slices for several. */
export function buildWedgeGradient(colors) {
  if (!colors.length) return '';
  if (colors.length === 1) return `linear-gradient(${colors[0]}, ${colors[0]})`;
  const edge = (index) => Number(((100 * index) / colors.length).toFixed(3));
  const stops = colors.map((color, index) => `${color} ${edge(index)}% ${edge(index + 1)}%`);
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

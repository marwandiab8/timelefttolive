// Dated measurements of each child (height first), kept at lifeCalendars/{id}/childMeasurements/{measurementId}.
// Heights are written the way they are read off a wall, in feet, inches and fractions; they are stored in whole
// millimetres with the original text kept as written. A value that doesn't read cleanly (a fraction of 9/8, say) is
// kept as written, gets no number, and is flagged so it can be corrected.

const MM_PER_INCH = 25.4;
export const MEASUREMENT_KINDS = Object.freeze(['height']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const fraction = (text) => {
  if (!text) return { value: 0, clean: true };
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (!match) return { value: 0, clean: false };
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator) return { value: 0, clean: false };
  return { value: numerator / denominator, clean: numerator < denominator };
};

/**
 * Reads a height: `5' 11"`, `5' 8 1/2"`, `5'6"`, `5 ft 6 in`, `66 in`, `66"`, `167 cm`, `1.67 m`.
 * Returns `{ mm, clean }`: `mm` is null when it can't be read; `clean` is false when it was read but looks wrong
 * (an improper fraction, more than 11 inches past the feet, or an implausible height).
 */
export function parseHeight(text) {
  const raw = String(text || '').trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/\s+/g, ' ');
  if (!raw) return { mm: null, clean: false };
  const metric = /^(\d+(?:\.\d+)?)\s*(cm|m)$/i.exec(raw);
  if (metric) {
    const mm = Math.round(Number(metric[1]) * (metric[2].toLowerCase() === 'm' ? 1000 : 10));
    return { mm, clean: plausible(mm) };
  }
  const imperial = /^(?:(\d+)\s*(?:'|ft|feet))?\s*(?:(\d+)(?:\s+(\d+\s*\/\s*\d+))?|(\d+\s*\/\s*\d+))?\s*(?:"|in|inches)?$/i.exec(raw);
  if (!imperial || (!imperial[1] && !imperial[2] && !imperial[4])) return { mm: null, clean: false };
  const feet = Number(imperial[1] || 0);
  const inches = Number(imperial[2] || 0);
  const part = fraction(imperial[3] || imperial[4]);
  const hasUnit = /['"]|ft|feet|in|inches/i.test(raw);
  if (!hasUnit) return { mm: null, clean: false };
  const totalInches = feet * 12 + inches + part.value;
  const mm = Math.round(totalInches * MM_PER_INCH);
  const clean = part.clean && (!imperial[1] || inches < 12) && plausible(mm);
  return { mm, clean };
}

const plausible = (mm) => mm >= 300 && mm <= 2500;

/** Millimetres as feet, inches and the nearest sixteenth: `5' 8 1/2"`. */
export function formatHeight(mm) {
  if (!Number.isFinite(mm)) return '';
  const sixteenths = Math.round((mm / MM_PER_INCH) * 16);
  const feet = Math.floor(sixteenths / (12 * 16));
  const rest = sixteenths - feet * 12 * 16;
  const inches = Math.floor(rest / 16);
  let part = rest - inches * 16;
  let denominator = 16;
  while (part && part % 2 === 0) {
    part /= 2;
    denominator /= 2;
  }
  return `${feet}' ${inches}${part ? ` ${part}/${denominator}` : ''}"`;
}

/** A change in height in words: `+2 1/2"`, `-1/8"`, `no change`. */
export function formatHeightChange(mm) {
  if (!Number.isFinite(mm)) return '';
  const sixteenths = Math.round((Math.abs(mm) / MM_PER_INCH) * 16);
  if (!sixteenths) return 'no change';
  const inches = Math.floor(sixteenths / 16);
  let part = sixteenths - inches * 16;
  let denominator = 16;
  while (part && part % 2 === 0) {
    part /= 2;
    denominator /= 2;
  }
  const text = [inches ? String(inches) : '', part ? `${part}/${denominator}` : ''].filter(Boolean).join(' ');
  return `${mm < 0 ? '-' : '+'}${text}"`;
}

/** "Nov 23, 2026", "23 Nov 2026", "2026-11-23", "November 23 2026" → "2026-11-23", else null. */
export function parseLooseDate(text) {
  const raw = String(text || '').trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const monthFirst = /^([a-z]+)\.? (\d{1,2}) (\d{4})$/i.exec(raw);
  if (monthFirst) return validDate(Number(monthFirst[3]), monthIndex(monthFirst[1]), Number(monthFirst[2]));
  const dayFirst = /^(\d{1,2}) ([a-z]+)\.? (\d{4})$/i.exec(raw);
  if (dayFirst) return validDate(Number(dayFirst[3]), monthIndex(dayFirst[2]), Number(dayFirst[1]));
  return null;
}

const monthIndex = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

function validDate(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The stable id of a child's measurement on a day, so a migration or a second save never makes a duplicate. */
export const measurementId = (childId, kind, measuredOn) => `${childId}-${kind}-${measuredOn}`;

/** The document saved for a measurement. Owner-only unless shared. */
export function buildMeasurement({ childId, kind = 'height', measuredOn, asWritten, note = '', shareWithViewers = false, source = 'manual' }) {
  const parsed = parseHeight(asWritten);
  return {
    id: measurementId(childId, kind, measuredOn),
    data: {
      childId,
      kind,
      measuredOn,
      valueMm: parsed.clean ? parsed.mm : null,
      asWritten: String(asWritten || '').trim(),
      needsCheck: !parsed.clean,
      note: String(note || '').trim().slice(0, 500),
      visibility: shareWithViewers ? 'viewers' : 'ownerOnly',
      source
    }
  };
}

/**
 * The child's free-text detail rows that are heights ("Height, Nov 23, 2026" = "5' 11""), as measurements to
 * migrate, plus the rows that look like heights but whose date can't be read (left alone, and reported).
 */
export function heightRowsFromDetails(child) {
  const measurements = [];
  const skipped = [];
  (child?.details || []).forEach((detail) => {
    const match = /^height\b[\s,:-]*(.*)$/i.exec(String(detail.label || '').trim());
    if (!match) return;
    const measuredOn = parseLooseDate(match[1]);
    if (!measuredOn) {
      skipped.push({ detailId: detail.id, label: detail.label, value: detail.value, reason: 'no readable date in the label' });
      return;
    }
    measurements.push({ detailId: detail.id, ...buildMeasurement({ childId: child.id, measuredOn, asWritten: detail.value, source: 'migratedDetail' }) });
  });
  return { measurements, skipped };
}

/**
 * A child's heights, oldest first, and what to say about them: the latest (with its date), the change since the one
 * before, and which ones need checking. `measurements` are documents with `measuredOn`, `valueMm`, `asWritten`.
 */
export function summarizeHeights(measurements = []) {
  const heights = measurements.filter((item) => item.kind === 'height' || !item.kind)
    .sort((left, right) => left.measuredOn.localeCompare(right.measuredOn));
  const readable = heights.filter((item) => Number.isFinite(item.valueMm));
  const latest = readable.at(-1) || null;
  const previous = readable.at(-2) || null;
  return {
    heights,
    points: readable.map((item) => ({ measuredOn: item.measuredOn, mm: item.valueMm })),
    latest,
    change: latest && previous ? { mm: latest.valueMm - previous.valueMm, since: previous.measuredOn } : null,
    needsCheck: heights.filter((item) => item.needsCheck)
  };
}

/**
 * Geometry for the small growth chart: an SVG path and point positions in a `width` × `height` box, time along the
 * bottom and height up the side, with a little headroom. Needs two readable points.
 */
export function growthChartGeometry(points, { width = 220, height = 70, pad = 6 } = {}) {
  if (!points || points.length < 2) return null;
  const times = points.map((point) => Date.parse(`${point.measuredOn}T12:00:00Z`));
  const values = points.map((point) => point.mm);
  const [minT, maxT] = [Math.min(...times), Math.max(...times)];
  const spread = Math.max(...values) - Math.min(...values);
  const minV = Math.min(...values) - Math.max(10, spread * 0.1);
  const maxV = Math.max(...values) + Math.max(10, spread * 0.1);
  const x = (time) => pad + ((time - minT) / Math.max(1, maxT - minT)) * (width - pad * 2);
  const y = (value) => height - pad - ((value - minV) / Math.max(1, maxV - minV)) * (height - pad * 2);
  const positions = points.map((point, index) => ({ ...point, x: Math.round(x(times[index]) * 10) / 10, y: Math.round(y(values[index]) * 10) / 10 }));
  return {
    width,
    height,
    positions,
    path: positions.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')
  };
}

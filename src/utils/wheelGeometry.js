// Geometry for the Activity time wheel. Everything here is pure so it can be
// tested without a DOM. Angles are degrees measured clockwise from 12 o'clock,
// and coordinates are in a 100 x 100 SVG viewBox.

export const WHEEL = Object.freeze({
  center: 50,
  outerRadius: 48,
  // The hole is a little under half the wheel's width.
  innerRadius: 21,
  cornerRadius: 2.2,
  // Space left between neighbouring slices.
  gapAngle: 1.8,
  // Smallest slice drawn, so a few minutes stay visible next to a whole week.
  minAngle: 8
});

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;
const number = (value) => Number(value.toFixed(3));

// Label sizes in viewBox units (about 5px each at the default wheel size).
// `icon` is the icon's line box and `iconGlyph` the smaller area the glyph
// actually inks, which is what has to stay inside a narrow slice.
const LABEL = Object.freeze({ icon: 4.2, iconGlyph: 3, lineHeight: 3, characterWidth: 1.55, padding: 0.6 });

/**
 * Turns categories into slices.
 *
 * `items` need a `seconds` value and keep their order and other fields. Slices
 * are proportional to time, except that none is drawn smaller than `minAngle`;
 * the room those slices take is removed from the larger ones. `trueShare` is
 * always the real fraction of the total, and `boosted` marks slices that are
 * drawn bigger than that.
 */
export const UNTRACKED_LABEL = 'Untracked';
// An untracked remainder under this share of the period is not drawn: it would only be
// boosted to the minimum slice and claim more attention than it deserves.
const UNTRACKED_MIN_SHARE = 0.01;

export function buildWheelSegments(items, options = {}) {
  const { minAngle, gapAngle, showUntracked = false, periodSeconds = 0 } = { ...WHEEL, ...options };
  const tracked = (items || []).filter((item) => Number(item.seconds) > 0);
  const trackedSeconds = tracked.reduce((total, item) => total + item.seconds, 0);
  const untrackedSeconds = showUntracked && periodSeconds > 0 ? periodSeconds - trackedSeconds : 0;
  // The frosted remainder of the period. It follows the categories so the ring still reads
  // largest first, and it is never selectable.
  const valid = untrackedSeconds > 0 && untrackedSeconds >= periodSeconds * UNTRACKED_MIN_SHARE && tracked.length
    ? [...tracked, { label: UNTRACKED_LABEL, seconds: untrackedSeconds, untracked: true, color: null }]
    : tracked;
  if (!valid.length) return [];

  const totalSeconds = valid.reduce((total, item) => total + item.seconds, 0);

  if (valid.length === 1) {
    return [{ ...valid[0], startAngle: 0, endAngle: 360, sweep: 360, midAngle: 180, trueShare: 1, boosted: false, full: true }];
  }

  const available = 360 - valid.length * gapAngle;
  const sweeps = new Array(valid.length);
  const pinned = new Set();

  if (valid.length * minAngle >= available) {
    // Too many slices to honour the minimum; share the ring evenly.
    valid.forEach((_, index) => {
      sweeps[index] = available / valid.length;
    });
  } else {
    // Pin every slice that would be under the minimum, rescale the rest into
    // what is left, and repeat: rescaling can push another slice under it.
    for (;;) {
      const freeSeconds = valid.reduce((total, item, index) => (pinned.has(index) ? total : total + item.seconds), 0);
      const scale = (available - pinned.size * minAngle) / freeSeconds;
      let changed = false;
      valid.forEach((item, index) => {
        if (!pinned.has(index) && item.seconds * scale < minAngle) {
          pinned.add(index);
          changed = true;
        }
      });
      if (!changed) {
        valid.forEach((item, index) => {
          sweeps[index] = pinned.has(index) ? minAngle : item.seconds * scale;
        });
        break;
      }
    }
  }

  // Each slice sits in a slot of sweep + gap, so the gap is centred on every
  // boundary, including the one at 12 o'clock.
  let cursor = 0;
  return valid.map((item, index) => {
    const sweep = sweeps[index];
    const startAngle = cursor + gapAngle / 2;
    const endAngle = startAngle + sweep;
    cursor += sweep + gapAngle;
    return {
      ...item,
      startAngle,
      endAngle,
      sweep,
      midAngle: startAngle + sweep / 2,
      trueShare: item.seconds / totalSeconds,
      boosted: pinned.has(index),
      full: false
    };
  });
}

function polar(center, radius, radians) {
  return { x: center + radius * Math.sin(radians), y: center - radius * Math.cos(radians) };
}

const point = ({ x, y }) => `${number(x)} ${number(y)}`;

/**
 * SVG path for one slice: an annular sector with rounded corners. A full ring
 * (a single slice) is two concentric circles, to be filled with `evenodd`.
 */
export function describeWheelSegment(segment, options = {}) {
  const { center, outerRadius: outer, innerRadius: inner, cornerRadius } = { ...WHEEL, ...options };

  if (segment.full) {
    const circle = (radius) => `M ${number(center - radius)} ${center} A ${radius} ${radius} 0 1 0 ${number(center + radius)} ${center} A ${radius} ${radius} 0 1 0 ${number(center - radius)} ${center} Z`;
    return `${circle(outer)} ${circle(inner)}`;
  }

  const a0 = toRadians(segment.startAngle);
  const a1 = toRadians(segment.endAngle);

  // A corner circle must fit the ring's thickness and both inner corners must
  // fit in the slice's width, so narrow slices are rounded less.
  const halfSweep = ((a1 - a0) / 2) * 0.8;
  const byWidth = (inner * Math.sin(halfSweep)) / (1 - Math.sin(halfSweep));
  const rc = Math.max(0, Math.min(cornerRadius, (outer - inner) / 2 - 0.05, byWidth));

  // Corner circles touch the radial edge and the arc they round. Their centres
  // sit rc away from the edge, so each tangent point is a fixed angle in.
  const outerCentre = outer - rc;
  const innerCentre = inner + rc;
  const outerOffset = Math.asin(rc / outerCentre);
  const innerOffset = Math.asin(rc / innerCentre);
  const outerEdge = Math.sqrt(outerCentre ** 2 - rc ** 2);
  const innerEdge = Math.sqrt(innerCentre ** 2 - rc ** 2);

  const startInner = polar(center, innerEdge, a0);
  const startOuter = polar(center, outerEdge, a0);
  const outerStart = polar(center, outer, a0 + outerOffset);
  const outerEnd = polar(center, outer, a1 - outerOffset);
  const endOuter = polar(center, outerEdge, a1);
  const endInner = polar(center, innerEdge, a1);
  const innerEnd = polar(center, inner, a1 - innerOffset);
  const innerStart = polar(center, inner, a0 + innerOffset);

  const outerLarge = (a1 - outerOffset) - (a0 + outerOffset) > Math.PI ? 1 : 0;
  const innerLarge = (a1 - innerOffset) - (a0 + innerOffset) > Math.PI ? 1 : 0;
  const corner = `A${number(rc)} ${number(rc)} 0 0 1`;

  return [
    `M ${point(startInner)}`,
    `L ${point(startOuter)}`,
    `${corner} ${point(outerStart)}`,
    `A${outer} ${outer} 0 ${outerLarge} 1 ${point(outerEnd)}`,
    `${corner} ${point(endOuter)}`,
    `L ${point(endInner)}`,
    `${corner} ${point(innerEnd)}`,
    `A${inner} ${inner} 0 ${innerLarge} 0 ${point(innerStart)}`,
    `${corner} ${point(startInner)}`,
    'Z'
  ].join(' ');
}

/** Where a slice's label is centred, as percentages of the wheel's size. */
export function getWheelLabelPosition(segment, options = {}) {
  const { center, outerRadius, innerRadius } = { ...WHEEL, ...options };
  const middle = polar(center, (outerRadius + innerRadius) / 2, toRadians(segment.midAngle));
  return { left: middle.x, top: middle.y };
}

/**
 * How much of a label fits inside its slice: 'full' (icon and duration),
 * 'icon', or 'none'. The label is upright, so this checks whether its bounding
 * box lies inside the slice's wedge rather than guessing from the angle alone.
 */
export function getWheelLabelMode(segment, textLength, options = {}) {
  const { center, outerRadius, innerRadius } = { ...WHEEL, ...options };
  const anchor = getWheelLabelPosition(segment, options);

  const fits = (width, height) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([sx, sy]) => {
    const dx = anchor.left + (sx * width) / 2 - center;
    const dy = anchor.top + (sy * height) / 2 - center;
    const radius = Math.hypot(dx, dy);
    if (radius < innerRadius || radius > outerRadius) return false;
    const angle = (toDegrees(Math.atan2(dx, -dy)) + 360) % 360;
    const offset = ((angle - segment.midAngle + 540) % 360) - 180;
    return Math.abs(offset) <= segment.sweep / 2;
  });

  const textWidth = Math.max(LABEL.icon, textLength * LABEL.characterWidth) + LABEL.padding;
  if (fits(textWidth, LABEL.icon + LABEL.lineHeight)) return 'full';
  if (fits(LABEL.iconGlyph, LABEL.iconGlyph)) return 'icon';
  return 'none';
}

/** An arc of the ring at `radius`, from `startAngle` to `endAngle` (degrees clockwise from 12). */
export function describeArc(radius, startAngle, endAngle, options = {}) {
  const { center } = { ...WHEEL, ...options };
  const sweep = endAngle - startAngle;
  if (!(sweep > 0)) return '';
  if (sweep >= 360) {
    return `M ${number(center)} ${number(center - radius)} A ${radius} ${radius} 0 1 1 ${number(center)} ${number(center + radius)} A ${radius} ${radius} 0 1 1 ${number(center)} ${number(center - radius)}`;
  }
  const from = polar(center, radius, toRadians(startAngle));
  const to = polar(center, radius, toRadians(endAngle));
  return `M ${point(from)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${point(to)}`;
}

/** A point on the ring, in viewBox units. */
export function pointOnRing(radius, angle, options = {}) {
  const { center } = { ...WHEEL, ...options };
  const { x, y } = polar(center, radius, toRadians(angle));
  return { x: number(x), y: number(y) };
}

const normalizeAngle = (angle) => ((angle % 360) + 360) % 360;

/**
 * Clock layout for a day: every allocated fragment at its real time of day, midnight at
 * 12 o'clock and noon at 6 o'clock. `fragments` carry `start` and `end` in ms, plus whatever
 * fields the caller wants back (label, color, session). `dayStart`/`dayEnd` are the day's
 * bounds in ms, so the ring maps the real day length (23 or 25 hours when the clocks change).
 * A night that began the evening before (`start` earlier than `dayStart`) wraps back past
 * 12 o'clock, the way the 24-hour chart draws it. Fragments keep their order by start time.
 */
export function buildClockSegments(fragments, options = {}) {
  const { dayStart, dayEnd, minSweep = 0.8, nowMs = null } = options;
  const length = dayEnd - dayStart;
  if (!(length > 0)) return [];
  const toAngle = (ms) => ((ms - dayStart) / length) * 360;
  return (fragments || [])
    .filter((fragment) => Number.isFinite(fragment?.start) && Number.isFinite(fragment?.end) && fragment.end > fragment.start)
    .map((fragment) => {
      const end = fragment.active && Number.isFinite(nowMs) ? Math.min(fragment.end, nowMs) : fragment.end;
      const rawStart = toAngle(Math.max(fragment.start, dayStart - length));
      const rawEnd = toAngle(Math.min(end, dayEnd));
      const sweep = Math.min(360, Math.max(minSweep, rawEnd - rawStart));
      const startAngle = normalizeAngle(rawStart);
      return {
        ...fragment,
        startAngle,
        endAngle: startAngle + sweep,
        sweep,
        midAngle: normalizeAngle(startAngle + sweep / 2),
        seconds: (end - fragment.start) / 1000,
        trueShare: (end - fragment.start) / length,
        boosted: rawEnd - rawStart < minSweep,
        full: sweep >= 360,
        clock: true,
        wrapsMidnight: fragment.start < dayStart
      };
    })
    .sort((left, right) => left.start - right.start);
}

/** Hour marks for the clock layout, with the real local hour for each one. */
export function buildClockTicks(options = {}) {
  const { dayStart, dayEnd, hourAt } = options;
  const length = dayEnd - dayStart;
  if (!(length > 0)) return [];
  const ticks = [];
  for (let hour = 0; hour < 24; hour += 1) {
    // `hourAt` gives the instant the local clock shows `hour`; without it the day is taken as
    // 24 equal hours.
    const at = typeof hourAt === 'function' ? hourAt(hour) : dayStart + hour * (length / 24);
    if (!Number.isFinite(at) || at < dayStart || at >= dayEnd) continue;
    ticks.push({ hour, angle: ((at - dayStart) / length) * 360, major: hour % 6 === 0 });
  }
  return ticks;
}

/**
 * The comparison ring: for every slice, an arc that starts where the slice starts and runs as
 * long as that category's time in the period being compared (the previous period, or the recent
 * normal), on the same scale as the current ring. An arc that outruns its slice says you did
 * more of it then; one that stops short says less.
 */
export function buildComparisonArcs(segments, compareSeconds, options = {}) {
  const { gapAngle } = { ...WHEEL, ...options };
  const drawn = (segments || []).filter((segment) => !segment.untracked && !segment.clock);
  const totalSeconds = drawn.reduce((total, segment) => total + segment.seconds, 0);
  const totalSweep = drawn.reduce((total, segment) => total + segment.sweep, 0);
  if (!totalSeconds || !drawn.length) return [];
  const degreesPerSecond = totalSweep / totalSeconds;
  const lookup = compareSeconds instanceof Map ? compareSeconds : new Map(Object.entries(compareSeconds || {}));
  return drawn
    .map((segment) => {
      const seconds = Number(lookup.get(segment.label)) || 0;
      if (!(seconds > 0)) return null;
      const sweep = Math.min(360 - gapAngle, seconds * degreesPerSecond);
      return {
        label: segment.label,
        color: segment.color,
        startAngle: segment.startAngle,
        endAngle: segment.startAngle + sweep,
        sweep,
        seconds,
        deltaSeconds: segment.seconds - seconds,
        longer: seconds > segment.seconds
      };
    })
    .filter(Boolean);
}

/**
 * Moments as beads on the rim. Each `point` has a `label` (its point category), an optional
 * `angle` (used in the clock layout, from its time of day) and a `segmentLabel` (the slice it
 * belongs with in the share layout). Beads closer than `clusterAngle` degrees merge into one
 * with a count. Points with nowhere to go (no angle and no matching slice) are left out.
 */
export function buildWheelBeads(points, options = {}) {
  const { segments = [], layout = 'share', clusterAngle = 5 } = options;
  const bySegment = new Map(segments.map((segment) => [segment.label, segment]));
  const placed = [];
  const grouped = new Map();
  (points || []).forEach((item) => {
    if (layout === 'clock' && Number.isFinite(item.angle)) {
      placed.push({ ...item, angle: normalizeAngle(item.angle) });
      return;
    }
    const segment = bySegment.get(item.segmentLabel) || bySegment.get(item.label);
    if (!segment) {
      // No slice to sit with (a journal entry on a day with no Journal time): its own angle, if it has one.
      if (Number.isFinite(item.angle)) placed.push({ ...item, angle: normalizeAngle(item.angle) });
      return;
    }
    const list = grouped.get(segment.label) || [];
    list.push(item);
    grouped.set(segment.label, list);
  });
  // In the share layout the beads of a slice are spread across its middle 70 percent.
  grouped.forEach((list, label) => {
    const segment = bySegment.get(label);
    const inset = segment.sweep * 0.15;
    const span = segment.sweep - inset * 2;
    list.forEach((item, index) => {
      const fraction = list.length === 1 ? 0.5 : index / (list.length - 1);
      placed.push({ ...item, angle: normalizeAngle(segment.startAngle + inset + span * fraction) });
    });
  });
  placed.sort((left, right) => left.angle - right.angle);
  const beads = [];
  placed.forEach((item) => {
    const last = beads.at(-1);
    if (last && item.angle - last.lastAngle < clusterAngle && last.label === item.label) {
      last.items.push(item);
      last.count += item.count || 1;
      last.lastAngle = item.angle;
      last.angle = (last.firstAngle + item.angle) / 2;
      return;
    }
    beads.push({ id: item.id, label: item.label, color: item.color, angle: item.angle, firstAngle: item.angle, lastAngle: item.angle, count: item.count || 1, items: [item] });
  });
  return beads.map(({ firstAngle, lastAngle, ...bead }) => bead);
}

/**
 * Where a target sits on a slice: the angle at which the slice would end if the category had
 * exactly the target's seconds, on the current ring's scale. `null` when the mark would lap the
 * ring (more than 300 degrees past the slice's start).
 */
export function targetAngle(segment, targetSeconds, segments) {
  if (!segment || !(targetSeconds > 0)) return null;
  const drawn = (segments || [segment]).filter((candidate) => !candidate.untracked);
  const totalSeconds = drawn.reduce((total, candidate) => total + candidate.seconds, 0);
  const totalSweep = drawn.reduce((total, candidate) => total + candidate.sweep, 0);
  if (!totalSeconds) return null;
  const sweep = targetSeconds * (totalSweep / totalSeconds);
  if (sweep > 300) return null;
  return { angle: normalizeAngle(segment.startAngle + sweep), met: segment.seconds >= targetSeconds, sweep };
}

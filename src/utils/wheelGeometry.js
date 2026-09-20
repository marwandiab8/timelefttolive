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
export function buildWheelSegments(items, options = {}) {
  const { minAngle, gapAngle } = { ...WHEEL, ...options };
  const valid = (items || []).filter((item) => Number(item.seconds) > 0);
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

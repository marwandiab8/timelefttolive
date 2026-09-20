import { describe, expect, it } from 'vitest';
import {
  WHEEL,
  buildWheelSegments,
  describeWheelSegment,
  getWheelLabelMode,
  getWheelLabelPosition
} from './wheelGeometry.js';

const H = 3600;
const items = (...seconds) => seconds.map((value, index) => ({ label: `c${index}`, seconds: value }));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const round = (value) => Math.round(value * 1000) / 1000;

describe('buildWheelSegments', () => {
  it('returns nothing when there is no positive time', () => {
    expect(buildWheelSegments([])).toEqual([]);
    expect(buildWheelSegments(items(0, -5))).toEqual([]);
  });

  it('keeps input order and the original fields, and ignores non-positive entries', () => {
    const segments = buildWheelSegments([{ label: 'a', color: '#111', seconds: 10 }, { label: 'skip', seconds: 0 }, { label: 'b', seconds: 5 }]);
    expect(segments.map((segment) => segment.label)).toEqual(['a', 'b']);
    expect(segments[0].color).toBe('#111');
  });

  it('is proportional when every slice is big enough', () => {
    const [big, small] = buildWheelSegments(items(75 * H, 25 * H), { minAngle: 8, gapAngle: 2 });
    expect(round(big.sweep / small.sweep)).toBe(3);
    expect(big.boosted).toBe(false);
    expect(round(big.trueShare)).toBe(0.75);
  });

  it('accounts for the whole circle: sweeps plus gaps add up to 360 degrees', () => {
    const segments = buildWheelSegments(items(57 * H, 45 * H, 44 * H, 10 * H, 8 * H, 5 * H, 2 * H, 660), WHEEL);
    expect(round(sum(segments.map((segment) => segment.sweep)) + segments.length * WHEEL.gapAngle)).toBe(360);
  });

  it('centres the gap on every boundary, including the one at 12 o\'clock', () => {
    const gap = 3;
    const segments = buildWheelSegments(items(3, 2, 1), { minAngle: 1, gapAngle: gap });
    expect(round(segments[0].startAngle)).toBe(gap / 2);
    segments.slice(1).forEach((segment, index) => {
      expect(round(segment.startAngle - segments[index].endAngle)).toBe(gap);
    });
    expect(round(360 - segments.at(-1).endAngle)).toBe(gap / 2);
  });

  it('gives a tiny slice the minimum angle so it stays visible, and takes it from the others', () => {
    const [big, tiny] = buildWheelSegments(items(1_000_000, 1), { minAngle: 8, gapAngle: 2 });
    expect(round(tiny.sweep)).toBe(8);
    expect(tiny.boosted).toBe(true);
    expect(tiny.trueShare).toBeLessThan(0.0001);
    expect(round(big.sweep)).toBe(round(360 - 4 - 8));
  });

  it('keeps redistributing until no slice is under the minimum', () => {
    // After the first pass scales the big slice down, the second-largest drops under 55 as well.
    const segments = buildWheelSegments(items(50, 12, 10, 1), { minAngle: 55, gapAngle: 0 });
    expect(segments.map((segment) => round(segment.sweep))).toEqual([195, 55, 55, 55]);
    segments.forEach((segment) => expect(segment.sweep).toBeGreaterThanOrEqual(55));
  });

  it('never reorders slices while enforcing the minimum', () => {
    const segments = buildWheelSegments(items(500, 300, 200, 3, 2, 1), WHEEL);
    segments.slice(1).forEach((segment, index) => expect(segment.startAngle).toBeGreaterThan(segments[index].startAngle));
  });

  it('falls back to an even split when there are too many slices for the minimum', () => {
    const segments = buildWheelSegments(items(...Array.from({ length: 50 }, (_, index) => (index + 1) * 60)), { minAngle: 8, gapAngle: 1.8 });
    const expected = (360 - 50 * 1.8) / 50;
    segments.forEach((segment) => expect(round(segment.sweep)).toBe(round(expected)));
    expect(round(sum(segments.map((segment) => segment.sweep)) + 50 * 1.8)).toBe(360);
  });

  it('draws a single slice as a full ring with no gap', () => {
    const [only] = buildWheelSegments(items(3 * H), WHEEL);
    expect(only.full).toBe(true);
    expect(only.sweep).toBe(360);
    expect(only.startAngle).toBe(0);
    expect(only.endAngle).toBe(360);
    expect(only.trueShare).toBe(1);
  });

  it('reports the midpoint angle', () => {
    const [first] = buildWheelSegments(items(1, 1), { minAngle: 1, gapAngle: 0 });
    expect(round(first.midAngle)).toBe(round(first.startAngle + first.sweep / 2));
  });
});

// Reads every drawn point (the last pair of each M/L/A command) out of an SVG path.
function pathPoints(d) {
  const points = [];
  for (const [, command, args] of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const numbers = args.trim().split(/[\s,]+/).map(Number);
    const [x, y] = numbers.slice(-2);
    points.push({ command, x, y });
  }
  return points;
}

const radiusOf = ({ x, y }) => Math.hypot(x - WHEEL.center, y - WHEEL.center);
const angleOf = ({ x, y }) => ((Math.atan2(x - WHEEL.center, WHEEL.center - y) * 180) / Math.PI + 360) % 360;

describe('describeWheelSegment', () => {
  const [big, mid, tiny] = buildWheelSegments(items(100, 40, 1), WHEEL);

  it('produces a closed path with real numbers only', () => {
    for (const segment of [big, mid, tiny]) {
      const d = describeWheelSegment(segment);
      expect(d.startsWith('M')).toBe(true);
      expect(d.trim().endsWith('Z')).toBe(true);
      expect(d).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('keeps every point inside the ring, between the inner and outer radius', () => {
    for (const segment of [big, mid, tiny]) {
      for (const point of pathPoints(describeWheelSegment(segment))) {
        expect(radiusOf(point)).toBeGreaterThanOrEqual(WHEEL.innerRadius - 0.01);
        expect(radiusOf(point)).toBeLessThanOrEqual(WHEEL.outerRadius + 0.01);
      }
    }
  });

  it('keeps every point inside the slice\'s own angular span', () => {
    for (const segment of [big, mid, tiny]) {
      for (const point of pathPoints(describeWheelSegment(segment))) {
        const angle = angleOf(point);
        expect(angle).toBeGreaterThanOrEqual(segment.startAngle - 0.01);
        expect(angle).toBeLessThanOrEqual(segment.endAngle + 0.01);
      }
    }
  });

  it('starts on the slice\'s leading radial edge', () => {
    const [start] = pathPoints(describeWheelSegment(mid));
    // Path coordinates are rounded to three decimals, so allow for that.
    expect(angleOf(start)).toBeCloseTo(mid.startAngle, 1);
  });

  it('rounds the corners with arcs, and rounds less on very small slices', () => {
    const arcs = (segment) => pathPoints(describeWheelSegment(segment)).filter((point) => point.command === 'A').length;
    expect(arcs(big)).toBe(6);
    expect(arcs(tiny)).toBe(6);
    const rounding = (segment) => Number(describeWheelSegment(segment).match(/A([\d.]+)/)[1]);
    expect(rounding(tiny)).toBeLessThan(rounding(big));
    expect(rounding(big)).toBeCloseTo(WHEEL.cornerRadius, 5);
  });

  it('describes a full ring as two concentric circles', () => {
    const [only] = buildWheelSegments(items(H), WHEEL);
    const d = describeWheelSegment(only);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toMatch(/NaN/);
  });
});

describe('label placement', () => {
  const [home, , , , , , , fuel] = buildWheelSegments(items(57 * H, 45 * H, 44 * H, 10 * H, 8 * H, 5 * H, 2 * H, 660), WHEEL);

  it('places a label at the middle of the ring, at the slice\'s midpoint', () => {
    const mid = (WHEEL.outerRadius + WHEEL.innerRadius) / 2;
    const top = getWheelLabelPosition({ midAngle: 0 });
    expect(round(top.left)).toBe(50);
    expect(round(top.top)).toBe(round(50 - mid));
    const right = getWheelLabelPosition({ midAngle: 90 });
    expect(round(right.left)).toBe(round(50 + mid));
    expect(round(right.top)).toBe(50);
    expect(getWheelLabelPosition(home)).toEqual({ left: expect.any(Number), top: expect.any(Number) });
  });

  it('shows icon and duration on a big slice', () => {
    expect(getWheelLabelMode(home, '57h'.length)).toBe('full');
  });

  it('shows only the icon on the smallest slice, so nothing spills onto its neighbours', () => {
    expect(fuel.boosted).toBe(true);
    expect(getWheelLabelMode(fuel, '11m'.length)).toBe('icon');
  });

  it('gives a slice on the side of the ring more room than one at the top, since the text runs along the ring\'s thickness there', () => {
    const narrow = { sweep: 9, midAngle: 90 };
    const narrowAtTop = { sweep: 9, midAngle: 0 };
    const rank = { none: 0, icon: 1, full: 2 };
    expect(rank[getWheelLabelMode(narrow, 3)]).toBeGreaterThanOrEqual(rank[getWheelLabelMode(narrowAtTop, 3)]);
  });

  it('always leaves at least the icon on a slice of the minimum size, wherever it sits on the ring', () => {
    for (let angle = 0; angle < 360; angle += 5) {
      const slice = { sweep: WHEEL.minAngle, midAngle: angle };
      expect(getWheelLabelMode(slice, 3), `midAngle ${angle}`).not.toBe('none');
    }
  });

  it('drops the label entirely when even the icon cannot fit', () => {
    expect(getWheelLabelMode({ sweep: 2, midAngle: 0 }, 3)).toBe('none');
  });

  it('needs more room for a longer duration', () => {
    const slice = { sweep: 16, midAngle: 0 };
    expect(getWheelLabelMode(slice, 2)).toBe('full');
    expect(getWheelLabelMode(slice, 8)).not.toBe('full');
  });
});

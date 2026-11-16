import { describe, expect, it } from 'vitest';
import {
  UNTRACKED_LABEL,
  WHEEL,
  buildClockSegments,
  buildClockTicks,
  buildComparisonArcs,
  buildWheelBeads,
  buildWheelSegments,
  describeArc,
  describeWheelSegment,
  pointOnRing,
  targetAngle
} from './wheelGeometry.js';

const H = 3600;
const DAY = 24 * H * 1000;
const items = (...seconds) => seconds.map((value, index) => ({ label: `c${index}`, seconds: value, color: '#123456' }));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const round = (value) => Math.round(value * 1000) / 1000;

describe('untracked time on the wheel', () => {
  it('appends a frosted, unselectable remainder that brings a day to 24 hours', () => {
    const segments = buildWheelSegments(items(8 * H, 7 * H, 3 * H), { showUntracked: true, periodSeconds: 24 * H });
    const last = segments.at(-1);
    expect(last.label).toBe(UNTRACKED_LABEL);
    expect(last.untracked).toBe(true);
    expect(last.seconds).toBe(6 * H);
    expect(round(sum(segments.map((segment) => segment.sweep)) + segments.length * WHEEL.gapAngle)).toBe(360);
    expect(round(last.trueShare)).toBe(0.25);
  });

  it('keeps the categories first, so the ring still reads largest first', () => {
    const segments = buildWheelSegments(items(2 * H, 9 * H), { showUntracked: true, periodSeconds: 24 * H });
    expect(segments.map((segment) => segment.label)).toEqual(['c0', 'c1', UNTRACKED_LABEL]);
  });

  it('draws nothing extra when the option is off, when the period is full, or when the remainder is a sliver', () => {
    expect(buildWheelSegments(items(8 * H), { periodSeconds: 24 * H }).map((segment) => segment.label)).toEqual(['c0']);
    expect(buildWheelSegments(items(25 * H), { showUntracked: true, periodSeconds: 24 * H })).toHaveLength(1);
    expect(buildWheelSegments(items(24 * H - 60), { showUntracked: true, periodSeconds: 24 * H })).toHaveLength(1);
    expect(buildWheelSegments([], { showUntracked: true, periodSeconds: 24 * H })).toEqual([]);
  });
});

describe('describeArc and pointOnRing', () => {
  it('starts at 12 o\'clock and runs clockwise', () => {
    expect(describeArc(48, 0, 90)).toBe('M 50 2 A 48 48 0 0 1 98 50');
    expect(describeArc(48, 90, 90)).toBe('');
    expect(describeArc(10, 0, 360)).toContain('A 10 10 0 1 1');
    expect(pointOnRing(48, 180)).toEqual({ x: 50, y: 98 });
  });
});

describe('clock layout', () => {
  const dayStart = Date.parse('2026-11-03T05:00:00Z'); // midnight Toronto (EST)
  const dayEnd = dayStart + DAY;
  const fragment = (startHour, endHour, extra = {}) => ({ start: dayStart + startHour * H * 1000, end: dayStart + endHour * H * 1000, label: 'Work', ...extra });

  it('places noon at 6 o\'clock and keeps the real duration', () => {
    const [segment] = buildClockSegments([fragment(9, 12)], { dayStart, dayEnd });
    expect(round(segment.startAngle)).toBe(135);
    expect(round(segment.endAngle)).toBe(180);
    expect(round(segment.midAngle)).toBe(157.5);
    expect(segment.seconds).toBe(3 * H);
    expect(round(segment.trueShare)).toBe(0.125);
    expect(segment.clock).toBe(true);
  });

  it('wraps a night that began the evening before back past 12 o\'clock, from its bedtime', () => {
    const [night] = buildClockSegments([fragment(-1.15, 3.6, { label: 'Sleep' })], { dayStart, dayEnd });
    expect(night.wrapsMidnight).toBe(true);
    expect(round(night.startAngle)).toBe(round(360 - 1.15 * 15));
    expect(round(night.sweep)).toBe(round(4.75 * 15));
    expect(night.endAngle).toBeGreaterThan(360);
    const d = describeWheelSegment(night);
    expect(d).not.toMatch(/NaN/);
    // The outer arc is drawn the short way round: a 71 degree sweep is not a large arc.
    expect(d).toContain(`A${WHEEL.outerRadius} ${WHEEL.outerRadius} 0 0 1`);
  });

  it('stops a live fragment at the current time and gives a sliver a visible minimum', () => {
    const nowMs = dayStart + 10 * H * 1000;
    const [live] = buildClockSegments([fragment(9, 24, { active: true })], { dayStart, dayEnd, nowMs });
    expect(round(live.endAngle)).toBe(150);
    expect(live.seconds).toBe(H);
    const [sliver] = buildClockSegments([fragment(9, 9.01)], { dayStart, dayEnd });
    expect(sliver.sweep).toBe(0.8);
    expect(sliver.boosted).toBe(true);
  });

  it('maps a 25 hour day onto the full ring and sorts by start time', () => {
    const longEnd = dayStart + 25 * H * 1000;
    const segments = buildClockSegments([fragment(20, 25), fragment(0, 5)], { dayStart, dayEnd: longEnd });
    expect(segments.map((segment) => round(segment.startAngle))).toEqual([0, 288]);
    expect(round(segments[1].endAngle)).toBe(360);
  });

  it('builds hour ticks from the real local hour when given one', () => {
    const ticks = buildClockTicks({ dayStart, dayEnd, hourAt: (hour) => dayStart + hour * H * 1000 });
    expect(ticks).toHaveLength(24);
    expect(ticks[6]).toEqual({ hour: 6, angle: 90, major: true });
    expect(ticks[7].major).toBe(false);
    expect(buildClockTicks({ dayStart, dayEnd: dayStart })).toEqual([]);
  });
});

describe('comparison arcs', () => {
  const segments = buildWheelSegments(items(8 * H, 4 * H));

  it('runs each arc from its slice\'s start, on the current ring\'s scale', () => {
    const arcs = buildComparisonArcs(segments, new Map([['c0', 4 * H], ['c1', 6 * H]]));
    expect(arcs).toHaveLength(2);
    expect(round(arcs[0].startAngle)).toBe(round(segments[0].startAngle));
    expect(round(arcs[0].sweep)).toBe(round(segments[0].sweep / 2));
    expect(arcs[0].longer).toBe(false);
    expect(arcs[1].longer).toBe(true);
    expect(round(arcs[1].sweep)).toBe(round(segments[1].sweep * 1.5));
    expect(arcs[1].deltaSeconds).toBe(-2 * H);
  });

  it('skips categories with nothing to compare and the untracked segment, and accepts a plain object', () => {
    const withUntracked = buildWheelSegments(items(8 * H), { showUntracked: true, periodSeconds: 24 * H });
    const arcs = buildComparisonArcs(withUntracked, { c0: 2 * H, [UNTRACKED_LABEL]: 99 * H, zz: 5 });
    expect(arcs.map((arc) => arc.label)).toEqual(['c0']);
    expect(buildComparisonArcs([], { c0: 1 })).toEqual([]);
  });

  it('never runs further than a full turn', () => {
    const [arc] = buildComparisonArcs(buildWheelSegments(items(H, H)), { c0: 100 * H });
    expect(arc.sweep).toBeLessThan(360);
  });
});

describe('beads', () => {
  const segments = buildWheelSegments(items(8 * H, 4 * H));

  it('spreads a slice\'s moments across its middle in the share layout', () => {
    const beads = buildWheelBeads([
      { id: 'a', label: 'Journal', segmentLabel: 'c0' },
      { id: 'b', label: 'Journal', segmentLabel: 'c0' },
      { id: 'c', label: 'Spotify', segmentLabel: 'c1' },
      { id: 'd', label: 'Spotify', segmentLabel: 'nowhere' },
      { id: 'e', label: 'Journal', segmentLabel: 'nowhere', angle: 350 }
    ], { segments, clusterAngle: 1 });
    expect(beads).toHaveLength(4);
    expect(beads.find((bead) => bead.id === 'e').angle).toBe(350);
    const [first, second] = beads.filter((bead) => bead.label === 'Journal');
    expect(first.angle).toBeGreaterThan(segments[0].startAngle);
    expect(second.angle).toBeLessThan(segments[0].endAngle);
    expect(beads.find((bead) => bead.label === 'Spotify').angle).toBeGreaterThan(segments[1].startAngle);
  });

  it('uses the time of day in the clock layout and merges close beads of one kind', () => {
    const beads = buildWheelBeads([
      { id: 'a', label: 'Spotify', angle: 100 },
      { id: 'b', label: 'Spotify', angle: 102, count: 2 },
      { id: 'c', label: 'Journal', angle: 103 },
      { id: 'd', label: 'Spotify', angle: 200 }
    ], { layout: 'clock', clusterAngle: 5 });
    expect(beads.map((bead) => [bead.label, bead.count])).toEqual([['Spotify', 3], ['Journal', 1], ['Spotify', 1]]);
    expect(beads[0].angle).toBe(101);
    expect(beads[0].items).toHaveLength(2);
  });
});

describe('target marks', () => {
  const segments = buildWheelSegments(items(8 * H, 4 * H));

  it('marks where the slice would end at the target, and whether it was met', () => {
    const under = targetAngle(segments[1], 6 * H, segments);
    expect(under.met).toBe(false);
    expect(round(under.sweep)).toBe(round(segments[1].sweep * 1.5));
    expect(round(under.angle)).toBe(round((segments[1].startAngle + segments[1].sweep * 1.5) % 360));
    expect(targetAngle(segments[0], 7 * H, segments).met).toBe(true);
  });

  it('gives up on a target that would lap the ring, or on nothing', () => {
    expect(targetAngle(segments[1], 40 * H, segments)).toBeNull();
    expect(targetAngle(null, H, segments)).toBeNull();
    expect(targetAngle(segments[0], 0, segments)).toBeNull();
  });
});

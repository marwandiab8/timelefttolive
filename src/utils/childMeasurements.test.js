import { describe, expect, it } from 'vitest';
import {
  buildMeasurement,
  formatHeight,
  formatHeightChange,
  growthChartGeometry,
  heightRowsFromDetails,
  measurementId,
  parseHeight,
  parseLooseDate,
  planHeightNoteMove,
  summarizeHeights
} from './childMeasurements.js';

describe('parseHeight', () => {
  it('reads the heights as they are written on the wall', () => {
    expect(parseHeight(`5' 11"`)).toEqual({ mm: 1803, clean: true });
    expect(parseHeight(`5' 8 1/2"`)).toEqual({ mm: 1740, clean: true });
    expect(parseHeight(`4' 9 3/16"`)).toEqual({ mm: 1453, clean: true });
    expect(parseHeight(`5' 6 7/16"`)).toEqual({ mm: 1688, clean: true });
    expect(parseHeight('5’ 3 7/8”')).toEqual({ mm: 1622, clean: true });
  });

  it('reads the other usual ways of writing a height', () => {
    ['5\'6"', '5 ft 6 in', '66 in', '66"', '5 feet 6 inches'].forEach((text) => expect(parseHeight(text), text).toEqual({ mm: 1676, clean: true }));
    expect(parseHeight('167 cm')).toEqual({ mm: 1670, clean: true });
    expect(parseHeight('1.67 m')).toEqual({ mm: 1670, clean: true });
  });

  it('flags what reads but looks wrong, and gives no number for what does not read', () => {
    expect(parseHeight(`5' 10 9/8"`)).toEqual({ mm: 1807, clean: false });
    expect(parseHeight(`5' 13"`).clean).toBe(false);
    expect(parseHeight('40 cm').clean).toBe(true);
    expect(parseHeight('20 cm').clean).toBe(false);
    expect(parseHeight('tall')).toEqual({ mm: null, clean: false });
    expect(parseHeight('11')).toEqual({ mm: null, clean: false });
    expect(parseHeight('')).toEqual({ mm: null, clean: false });
  });
});

describe('formatHeight and formatHeightChange', () => {
  it('writes millimetres back as feet, inches and the nearest sixteenth, round-tripping the wall values', () => {
    [`5' 11"`, `5' 8 1/2"`, `4' 9 3/16"`, `5' 6 7/16"`, `5' 4 7/8"`, `4' 5 1/8"`].forEach((text) => expect(formatHeight(parseHeight(text).mm)).toBe(text));
    expect(formatHeight(NaN)).toBe('');
  });

  it('writes a change with its sign', () => {
    expect(formatHeightChange(63.5)).toBe('+2 1/2"');
    expect(formatHeightChange(-3.175)).toBe('-1/8"');
    expect(formatHeightChange(0.3)).toBe('no change');
  });
});

describe('parseLooseDate', () => {
  it('reads the dates used in the detail labels', () => {
    expect(parseLooseDate('Nov 23, 2026')).toBe('2026-11-23');
    expect(parseLooseDate('September 27 2026')).toBe('2026-09-27');
    expect(parseLooseDate('3 May 2023')).toBe('2023-05-03');
    expect(parseLooseDate('2024-06-02')).toBe('2024-06-02');
    expect(parseLooseDate('Feb 30, 2026')).toBeNull();
    expect(parseLooseDate('someday')).toBeNull();
  });
});

describe('heightRowsFromDetails', () => {
  const child = {
    id: 'd',
    details: [
      { id: '1', label: 'Height, Nov 23, 2026', value: `5' 11"` },
      { id: '2', label: 'Height, Sep 27, 2026', value: `5' 10 9/8"` },
      { id: '3', label: 'Shoe size', value: '11' },
      { id: '4', label: 'Height', value: `5' 2"` },
      { id: '5', label: 'height: 3 May 2023', value: `5' 2 3/4"` }
    ]
  };

  it('turns dated height rows into measurements, keeping odd values as written and flagged', () => {
    const { measurements, skipped } = heightRowsFromDetails(child);
    expect(measurements.map((item) => [item.detailId, item.id, item.data.valueMm, item.data.asWritten, item.data.needsCheck])).toEqual([
      ['1', 'd-height-2026-11-23', 1803, `5' 11"`, false],
      ['2', 'd-height-2026-09-27', null, `5' 10 9/8"`, true],
      ['5', 'd-height-2023-05-03', 1594, `5' 2 3/4"`, false]
    ]);
    expect(measurements[0].data).toMatchObject({ childId: 'd', kind: 'height', visibility: 'ownerOnly', source: 'migratedDetail' });
    expect(skipped).toEqual([{ detailId: '4', label: 'Height', value: `5' 2"`, reason: 'no readable date in the label' }]);
  });
});

describe('buildMeasurement', () => {
  it('keeps the text as written, stores a clean value in mm and is private unless shared', () => {
    expect(buildMeasurement({ childId: 'j', measuredOn: '2026-11-23', asWritten: ` 5' 3 7/8" `, note: 'shoes off' })).toEqual({
      id: measurementId('j', 'height', '2026-11-23'),
      data: { childId: 'j', kind: 'height', measuredOn: '2026-11-23', valueMm: 1622, asWritten: `5' 3 7/8"`, needsCheck: false, note: 'shoes off', visibility: 'ownerOnly', source: 'manual' }
    });
    expect(buildMeasurement({ childId: 'j', measuredOn: '2026-11-23', asWritten: '5 10 9/8', shareWithViewers: true }).data).toMatchObject({ valueMm: null, needsCheck: true, visibility: 'viewers' });
  });
});

describe('summarizeHeights and growthChartGeometry', () => {
  const measurements = [
    { kind: 'height', measuredOn: '2026-11-23', valueMm: 1803, asWritten: `5' 11"` },
    { kind: 'height', measuredOn: '2026-09-27', valueMm: null, asWritten: `5' 10 9/8"`, needsCheck: true },
    { kind: 'height', measuredOn: '2025-02-10', valueMm: 1740, asWritten: `5' 8 1/2"` },
    { kind: 'height', measuredOn: '2023-05-03', valueMm: 1594, asWritten: `5' 2 3/4"` }
  ];

  it('gives the latest, the change since the reading before, and what needs checking', () => {
    const summary = summarizeHeights(measurements);
    expect(summary.heights.map((item) => item.measuredOn)).toEqual(['2023-05-03', '2025-02-10', '2026-09-27', '2026-11-23']);
    expect(summary.latest.measuredOn).toBe('2026-11-23');
    expect(summary.change).toEqual({ mm: 63, since: '2025-02-10' });
    expect(formatHeightChange(summary.change.mm)).toBe('+2 1/2"');
    expect(summary.needsCheck.map((item) => item.asWritten)).toEqual([`5' 10 9/8"`]);
    expect(summary.points).toHaveLength(3);
    expect(summarizeHeights([]).latest).toBeNull();
  });

  it('draws the readable heights left to right in time and upward in height', () => {
    const chart = growthChartGeometry(summarizeHeights(measurements).points, { width: 200, height: 60, pad: 5 });
    const [first, second, third] = chart.positions;
    expect(first.x).toBe(5);
    expect(third.x).toBe(195);
    expect(second.x).toBeGreaterThan(first.x);
    expect(first.y).toBeGreaterThan(second.y);
    expect(second.y).toBeGreaterThan(third.y);
    expect(chart.path.startsWith('M5 ')).toBe(true);
    expect(growthChartGeometry([{ measuredOn: '2026-01-01', mm: 1500 }])).toBeNull();
  });
});

describe('planHeightNoteMove', () => {
  const child = {
    id: 'd',
    details: [
      { id: '1', label: 'Height, Nov 23, 2026', value: `5' 11"` },
      { id: '2', label: 'Height, Sep 27, 2026', value: `5' 10 9/8"` },
      { id: '3', label: 'Shoe size', value: '11' }
    ]
  };

  it('copies the notes not yet in the history, and only then offers to take them off the profile', () => {
    const fresh = planHeightNoteMove(child, []);
    expect(fresh.toCopy.map((row) => row.id)).toEqual(['d-height-2026-11-23', 'd-height-2026-09-27']);
    expect(fresh.removable).toEqual([]);
    const half = planHeightNoteMove(child, [{ id: 'd-height-2026-11-23' }]);
    expect(half.toCopy.map((row) => row.detailId)).toEqual(['2']);
    expect(half.removable).toEqual(['1']);
    const done = planHeightNoteMove(child, [{ id: 'd-height-2026-11-23' }, { id: 'd-height-2026-09-27' }]);
    expect(done).toMatchObject({ toCopy: [], removable: ['1', '2'] });
    expect(planHeightNoteMove({ id: 'x', details: [] }, [])).toMatchObject({ toCopy: [], removable: [] });
  });
});

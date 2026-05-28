import { describe, expect, it } from 'vitest';
import { getCustodyStats } from './custodyUtils.js';
import { parseDateId } from './dateUtils.js';

describe('custodyUtils', () => {
  it('counts every-other-week parenting time through the latest selected child cutoff', () => {
    const stats = getCustodyStats({
      birthDate: '1975-02-24',
      targetAge: 90,
      targetEndDate: '2065-02-24',
      children: [
        { id: 'a', name: 'One', birthDate: '2010-06-28' },
        { id: 'b', name: 'Two', birthDate: '2011-04-27' }
      ],
      custodySchedule: {
        enabled: true,
        nextStartDate: '2026-06-01',
        cycleWeeks: 2,
        withParentWeeks: 1,
        childIds: ['a', 'b'],
        countUntilChildAge: 18
      }
    }, parseDateId('2026-05-28'));

    expect(stats.daysRemaining).toBeGreaterThan(300);
    expect(stats.childNames).toEqual(['One', 'Two']);
    expect(stats.throughDate).toBe('2029-04-27');
  });

  it('returns null when parenting time is not configured', () => {
    expect(getCustodyStats({ children: [] })).toBeNull();
  });
});

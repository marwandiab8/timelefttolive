import { describe, expect, it } from 'vitest';
import { msUntilNextLocalMidnight } from './useCurrentDay.js';

describe('msUntilNextLocalMidnight', () => {
  const hours = (count) => count * 60 * 60 * 1000;

  it('is the time left until the next local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 8, 20, 12, 0, 0, 0))).toBe(hours(12));
    expect(msUntilNextLocalMidnight(new Date(2026, 8, 20, 23, 59, 59, 0))).toBe(1000);
  });

  it('is a full day just after midnight, never zero', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 8, 20, 0, 0, 0, 0))).toBe(hours(24));
    expect(msUntilNextLocalMidnight(new Date(2026, 8, 20, 0, 0, 0, 1))).toBeGreaterThan(0);
  });

  it('lands on the next calendar day across a month and a year end', () => {
    const next = (now) => new Date(now.getTime() + msUntilNextLocalMidnight(now));
    expect(next(new Date(2026, 8, 30, 9, 0)).getDate()).toBe(1);
    expect(next(new Date(2026, 11, 31, 22, 0)).getFullYear()).toBe(2027);
  });
});

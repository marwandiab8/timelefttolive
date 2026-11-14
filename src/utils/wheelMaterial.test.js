import { describe, expect, it } from 'vitest';
import { CRYSTAL, contrastRatio, darkenHex, frostedStops, labelColorFor, lightenHex, luminance, mixHex, sliceStops } from './wheelMaterial.js';

describe('wheel material colours', () => {
  it('mixes toward black and white without leaving the hex range', () => {
    expect(mixHex('#4f8cff', '#000000', 0)).toBe('#4f8cff');
    expect(mixHex('#4f8cff', '#000000', 1)).toBe('#000000');
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080');
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
    expect(mixHex('#abc', '#000', 0)).toBe('#aabbcc');
    expect(mixHex('nonsense', '#000', 0)).toBe('#8b98a1');
  });

  it('computes luminance and contrast like the stylesheet test does', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBe(0);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('puts dark ink on yellow and orange slices and white on blue and purple ones', () => {
    expect(labelColorFor('#f2b84b')).toBe('#17252d'); // Transportation
    expect(labelColorFor('#ef996c')).toBe('#17252d'); // Meals
    expect(labelColorFor('#e8d44d')).toBe('#17252d'); // Grocery shopping
    expect(labelColorFor('#4f8cff')).toBe('#ffffff'); // Work
    expect(labelColorFor('#8178e8')).toBe('#ffffff'); // Sleep
    expect(labelColorFor('#1f9d55')).toBe('#ffffff'); // Darts
  });

  it('derives the three body stops from the category colour alone', () => {
    const stops = sliceStops('#4f8cff');
    expect(stops.middle).toBe('#4f8cff');
    expect(luminance(stops.inner)).toBeLessThan(luminance(stops.middle));
    expect(luminance(stops.outer)).toBeGreaterThan(luminance(stops.middle));
    expect(sliceStops('#4f8cff', { ...CRYSTAL, innerDark: 0, outerLight: 0 })).toEqual({ inner: '#4f8cff', middle: '#4f8cff', outer: '#4f8cff' });
  });

  it('keeps the frosted untracked segment lighter on the light theme', () => {
    expect(luminance(frostedStops('light').middle)).toBeGreaterThan(luminance(frostedStops('dark').middle));
  });
});

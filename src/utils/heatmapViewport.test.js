import { describe, expect, it } from 'vitest';
import {
  HEATMAP_MAX_ZOOM,
  HEATMAP_MIN_ZOOM,
  calculateAnchoredOffset,
  calculateBaseCellSize,
  calculateFitZoom,
  calculateHeatmapContentWidth,
  clampHeatmapZoom,
  isReducedMotionPreferred,
  stepHeatmapZoom
} from './heatmapViewport.js';

describe('heatmap viewport calculations', () => {
  it('clamps invalid and out-of-range zoom values', () => {
    expect(clampHeatmapZoom(-3)).toBe(HEATMAP_MIN_ZOOM);
    expect(clampHeatmapZoom(8)).toBe(HEATMAP_MAX_ZOOM);
    expect(clampHeatmapZoom('invalid')).toBe(1);
  });

  it('uses predictable ten-percent zoom steps', () => {
    expect(stepHeatmapZoom(1, 1)).toBe(1.1);
    expect(stepHeatmapZoom(1, -1)).toBe(0.9);
    expect(stepHeatmapZoom(HEATMAP_MAX_ZOOM, 1)).toBe(HEATMAP_MAX_ZOOM);
    expect(stepHeatmapZoom(HEATMAP_MIN_ZOOM, -1)).toBe(HEATMAP_MIN_ZOOM);
  });

  it('sizes the base calendar to its measured viewport', () => {
    const baseCellSize = calculateBaseCellSize(1700);
    expect(calculateHeatmapContentWidth(baseCellSize, 1)).toBeCloseTo(1700, 5);
    expect(calculateHeatmapContentWidth(baseCellSize, 1.1)).toBeGreaterThan(1700);
    expect(calculateHeatmapContentWidth(baseCellSize, 0.9)).toBeLessThan(1700);
  });

  it('calculates fit from real available width and padding', () => {
    const baseCellSize = calculateBaseCellSize(1200);
    const fit = calculateFitZoom({ baseCellSize, viewportWidth: 1224, padding: 12 });
    expect(fit).toBeCloseTo(1, 5);
    const narrowerFit = calculateFitZoom({ baseCellSize, viewportWidth: 900, padding: 12 });
    expect(narrowerFit).toBeLessThan(1);
  });

  it('protects mobile readability instead of forcing all weeks into a tiny width', () => {
    const baseCellSize = calculateBaseCellSize(860);
    const fit = calculateFitZoom({
      baseCellSize,
      viewportWidth: 354,
      padding: 12,
      minReadableZoom: 0.7
    });
    expect(fit).toBe(0.7);
    expect(calculateHeatmapContentWidth(baseCellSize, fit)).toBeGreaterThan(354);
  });

  it('keeps the viewport centre stable while an extent changes', () => {
    const nextOffset = calculateAnchoredOffset({
      anchor: 400,
      nextExtent: 2000,
      previousExtent: 1000,
      previousOffset: 100,
      viewportExtent: 800
    });
    expect(nextOffset).toBe(600);
  });

  it('keeps a pointer focal point stable and clamps at the edge', () => {
    expect(calculateAnchoredOffset({
      anchor: 120,
      nextExtent: 1500,
      previousExtent: 1000,
      previousOffset: 300,
      viewportExtent: 500
    })).toBe(510);
    expect(calculateAnchoredOffset({
      anchor: 480,
      nextExtent: 600,
      previousExtent: 1000,
      previousOffset: 500,
      viewportExtent: 500
    })).toBe(100);
  });

  it('reports reduced-motion preferences safely', () => {
    expect(isReducedMotionPreferred(() => ({ matches: true }))).toBe(true);
    expect(isReducedMotionPreferred(() => ({ matches: false }))).toBe(false);
    expect(isReducedMotionPreferred(undefined)).toBe(false);
  });
});

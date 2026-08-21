export const HEATMAP_MIN_ZOOM = 0.45;
export const HEATMAP_MAX_ZOOM = 2.5;
export const HEATMAP_ZOOM_STEP = 0.1;
export const HEATMAP_RESET_ZOOM = 1;

const WEEK_COUNT = 52;
const WEEK_GAP_COUNT = WEEK_COUNT - 1;
const YEAR_LABEL_WIDTH = 70;
const YEAR_ROW_GAP = 8;
const WEEK_GAP = 3;

export function clampHeatmapZoom(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : HEATMAP_RESET_ZOOM;
  return Math.min(HEATMAP_MAX_ZOOM, Math.max(HEATMAP_MIN_ZOOM, safe));
}

export function stepHeatmapZoom(zoom, direction) {
  const steps = direction < 0 ? -1 : 1;
  return clampHeatmapZoom(Math.round((clampHeatmapZoom(zoom) + (steps * HEATMAP_ZOOM_STEP)) * 100) / 100);
}

export function calculateBaseCellSize(targetWidth) {
  const available = Math.max(0, Number(targetWidth) - YEAR_LABEL_WIDTH - YEAR_ROW_GAP - (WEEK_GAP_COUNT * WEEK_GAP));
  return Math.max(1, available / WEEK_COUNT);
}

export function calculateHeatmapContentWidth(baseCellSize, zoom) {
  const safeZoom = clampHeatmapZoom(zoom);
  const scaledGap = WEEK_GAP * Math.min(safeZoom, 1);
  return YEAR_LABEL_WIDTH
    + YEAR_ROW_GAP
    + (WEEK_COUNT * Number(baseCellSize) * safeZoom)
    + (WEEK_GAP_COUNT * scaledGap);
}

export function calculateFitZoom({
  baseCellSize,
  minReadableZoom = HEATMAP_MIN_ZOOM,
  padding = 12,
  viewportWidth
}) {
  const available = Math.max(1, Number(viewportWidth) - (Math.max(0, Number(padding)) * 2));
  const fixedWidth = YEAR_LABEL_WIDTH + YEAR_ROW_GAP;
  const scalableWidth = (WEEK_COUNT * Number(baseCellSize)) + (WEEK_GAP_COUNT * WEEK_GAP);
  const rawZoom = (available - fixedWidth) / Math.max(1, scalableWidth);
  return Math.min(
    HEATMAP_MAX_ZOOM,
    Math.max(HEATMAP_MIN_ZOOM, Number(minReadableZoom), rawZoom)
  );
}

export function calculateAnchoredOffset({
  anchor,
  nextExtent,
  previousExtent,
  previousOffset,
  viewportExtent
}) {
  const safePreviousExtent = Math.max(1, Number(previousExtent));
  const safeAnchor = Math.max(0, Number(anchor));
  const focalRatio = Math.min(1, Math.max(0, (Number(previousOffset) + safeAnchor) / safePreviousExtent));
  const rawOffset = (focalRatio * Math.max(1, Number(nextExtent))) - safeAnchor;
  return Math.min(
    Math.max(0, Number(nextExtent) - Math.max(0, Number(viewportExtent))),
    Math.max(0, rawOffset)
  );
}

export function isReducedMotionPreferred(matchMedia = globalThis.matchMedia) {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

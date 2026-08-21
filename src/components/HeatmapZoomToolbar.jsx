import { HEATMAP_MAX_ZOOM, HEATMAP_MIN_ZOOM } from '../utils/heatmapViewport.js';

export default function HeatmapZoomToolbar({ fitMode, onFit, onReset, onZoomIn, onZoomOut, zoom }) {
  const percentage = Math.round(zoom * 100);
  return (
    <div className="zoom-toolbar" role="group" aria-label="Calendar zoom and position">
      <button
        className="zoom-step-button"
        disabled={zoom <= HEATMAP_MIN_ZOOM}
        title="Zoom out by 10% (keyboard: −)"
        type="button"
        onClick={onZoomOut}
      >
        <span aria-hidden="true">−</span><span className="zoom-button-label">Zoom out</span>
      </button>
      <output className="zoom-percentage" aria-live="polite" aria-label={`Calendar zoom ${percentage}%`}>
        {percentage}%
      </output>
      <button
        className="zoom-step-button"
        disabled={zoom >= HEATMAP_MAX_ZOOM}
        title="Zoom in by 10% (keyboard: +)"
        type="button"
        onClick={onZoomIn}
      >
        <span aria-hidden="true">+</span><span className="zoom-button-label">Zoom in</span>
      </button>
      <span className="zoom-toolbar-divider" aria-hidden="true" />
      <button
        aria-pressed={fitMode === 'fit'}
        className={`zoom-mode-button ${fitMode === 'fit' ? 'selected' : ''}`}
        title="Fit the calendar to this viewport (keyboard: F)"
        type="button"
        onClick={onFit}
      >
        <span aria-hidden="true">⊡</span> Fit calendar
      </button>
      <button
        className="zoom-mode-button"
        disabled={fitMode !== 'fit' && Math.abs(zoom - 1) < 0.001}
        title="Reset calendar to 100% (keyboard: 0)"
        type="button"
        onClick={onReset}
      >
        Reset 100%
      </button>
      <span className="zoom-shortcuts">Ctrl/Cmd + wheel · F to fit</span>
    </div>
  );
}

export default function HeatmapZoomToolbar({ zoom, fitMode, onZoomChange, onFitModeChange }) {
  return (
    <div className="zoom-toolbar" aria-label="Heatmap zoom controls">
      <button className="secondary" type="button" onClick={() => onZoomChange(Math.max(0.45, zoom - 0.15))}>Zoom out</button>
      <input
        aria-label="Zoom"
        min="0.45"
        max="2.5"
        step="0.05"
        type="range"
        value={zoom}
        onChange={(event) => onZoomChange(Number(event.target.value))}
      />
      <button className="secondary" type="button" onClick={() => onZoomChange(Math.min(2.5, zoom + 0.15))}>Zoom in</button>
      <button className="secondary" type="button" onClick={() => onZoomChange(1)}>Reset</button>
      <button className={fitMode === 'width' ? 'primary' : 'secondary'} type="button" onClick={() => onFitModeChange('width')}>Fit width</button>
      <button className={fitMode === 'whole' ? 'primary' : 'secondary'} type="button" onClick={() => onFitModeChange('whole')}>Fit whole picture</button>
      <span className="muted">{Math.round(zoom * 100)}%</span>
    </div>
  );
}

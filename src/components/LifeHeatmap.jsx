import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  eventIntersectsWeek,
  formatDateId,
  getLifeYearsWeeks,
  isCurrentWeek
} from '../utils/dateUtils.js';
import {
  calculateAnchoredOffset,
  calculateBaseCellSize,
  calculateFitZoom,
  clampHeatmapZoom,
  HEATMAP_RESET_ZOOM,
  isReducedMotionPreferred,
  stepHeatmapZoom
} from '../utils/heatmapViewport.js';
import HeatmapZoomToolbar from './HeatmapZoomToolbar.jsx';

const FIT_PADDING = 12;
const DESKTOP_MINIMUM_WIDTH = 980;
const MOBILE_MINIMUM_WIDTH = 860;
const MOBILE_FIT_MINIMUM_ZOOM = 0.7;

const LifeHeatmap = forwardRef(function LifeHeatmap({
  calendar,
  events,
  onSelectWeek,
  onAgeClick,
  zoom,
  fitMode,
  onZoomChange,
  onFitModeChange
}, ref) {
  const rows = useMemo(() => getLifeYearsWeeks(calendar.birthDate, calendar.targetAge), [calendar.birthDate, calendar.targetAge]);
  const rowsWithEvents = useMemo(() => rows.map((row) => ({
    ...row,
    weeks: row.weeks.map((week) => ({
      ...week,
      weekEvents: events.filter((event) => eventIntersectsWeek(event, week))
    }))
  })), [rows, events]);
  const cellRefs = useRef(new Map());
  const heatmapElementRef = useRef(null);
  const scrollRef = useRef(null);
  const pendingAnchorRef = useRef(null);
  const pointerStateRef = useRef({ pointers: new Map(), pinch: null });
  const centerCurrentAfterFitRef = useRef(false);
  const [geometry, setGeometry] = useState({ baseCellSize: 18, viewportWidth: 0 });
  const settings = calendar.settings || {};

  const scrollToCurrentWeek = useCallback(({ announce = true, block = 'center' } = {}) => {
    const current = rowsWithEvents.flatMap((row) => row.weeks).find((week) => isCurrentWeek(week));
    const element = current && cellRefs.current.get(current.dateId);
    if (!element) return;
    element.scrollIntoView({
      behavior: isReducedMotionPreferred() ? 'auto' : 'smooth',
      block,
      inline: 'center'
    });
    if (announce && !isReducedMotionPreferred()) {
      element.classList.add('pulse');
      window.setTimeout(() => element.classList.remove('pulse'), 1400);
    }
  }, [rowsWithEvents]);

  const captureAnchor = useCallback((clientPoint = {}) => {
    const viewport = scrollRef.current;
    const content = heatmapElementRef.current;
    if (!viewport || !content) return;
    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const clientX = Number.isFinite(clientPoint.clientX)
      ? clientPoint.clientX
      : viewportRect.left + (viewport.clientWidth / 2);
    const viewportMidpoint = window.innerHeight / 2;
    const clientY = Number.isFinite(clientPoint.clientY)
      ? clientPoint.clientY
      : Math.max(contentRect.top, Math.min(contentRect.bottom, viewportMidpoint));
    const horizontalAnchor = Math.max(0, Math.min(viewport.clientWidth, clientX - viewportRect.left));
    const verticalPoint = clientY - contentRect.top;
    pendingAnchorRef.current = {
      clientY,
      horizontalAnchor,
      previousScrollLeft: viewport.scrollLeft,
      previousWidth: viewport.scrollWidth,
      verticalRatio: Math.max(0, Math.min(1, verticalPoint / Math.max(1, contentRect.height)))
    };
  }, []);

  const requestZoom = useCallback((value, clientPoint) => {
    const nextZoom = clampHeatmapZoom(value);
    if (Math.abs(nextZoom - zoom) < 0.001) {
      if (fitMode === 'fit') onFitModeChange('manual');
      return;
    }
    captureAnchor(clientPoint);
    onFitModeChange('manual');
    onZoomChange(nextZoom, { preserveFitMode: false });
  }, [captureAnchor, fitMode, onFitModeChange, onZoomChange, zoom]);

  const applyFit = useCallback(({ centreCurrent = false } = {}) => {
    const viewport = scrollRef.current;
    if (!viewport || !geometry.baseCellSize) return;
    const mobile = viewport.clientWidth <= 620;
    const nextZoom = calculateFitZoom({
      baseCellSize: geometry.baseCellSize,
      minReadableZoom: mobile ? MOBILE_FIT_MINIMUM_ZOOM : undefined,
      padding: FIT_PADDING,
      viewportWidth: viewport.clientWidth
    });
    if (centreCurrent && mobile) centerCurrentAfterFitRef.current = true;
    if (Math.abs(nextZoom - zoom) >= 0.001) {
      captureAnchor();
      onZoomChange(nextZoom, { preserveFitMode: true });
    } else if (centerCurrentAfterFitRef.current) {
      centerCurrentAfterFitRef.current = false;
      scrollToCurrentWeek({ announce: false, block: 'center' });
    }
  }, [captureAnchor, geometry.baseCellSize, onZoomChange, scrollToCurrentWeek, zoom]);

  const activateFit = useCallback(() => {
    onFitModeChange('fit');
    applyFit({ centreCurrent: true });
  }, [applyFit, onFitModeChange]);

  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    const viewport = scrollRef.current;
    const content = heatmapElementRef.current;
    if (!viewport || !content) return;
    viewport.scrollLeft = calculateAnchoredOffset({
      anchor: pending.horizontalAnchor,
      nextExtent: viewport.scrollWidth,
      previousExtent: pending.previousWidth,
      previousOffset: pending.previousScrollLeft,
      viewportExtent: viewport.clientWidth
    });
    const contentRect = content.getBoundingClientRect();
    const nextContentTop = contentRect.top + window.scrollY;
    const nextScrollY = nextContentTop + (pending.verticalRatio * contentRect.height) - pending.clientY;
    window.scrollTo({ left: window.scrollX, top: Math.max(0, nextScrollY), behavior: 'auto' });
    pendingAnchorRef.current = null;
    if (centerCurrentAfterFitRef.current) {
      centerCurrentAfterFitRef.current = false;
      window.requestAnimationFrame(() => scrollToCurrentWeek({ announce: false, block: 'center' }));
    }
  }, [geometry.baseCellSize, scrollToCurrentWeek, zoom]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return undefined;
    const measure = () => {
      const viewportWidth = viewport.clientWidth;
      // A hidden Calendar reports zero width while Activity is visible. Ignoring
      // that transient measurement preserves the exact manual zoom geometry and
      // horizontal scroll position for the return trip.
      if (viewportWidth <= 0) return;
      const minimumWidth = viewportWidth <= 620 ? MOBILE_MINIMUM_WIDTH : DESKTOP_MINIMUM_WIDTH;
      const targetWidth = Math.max(minimumWidth, viewportWidth - (FIT_PADDING * 2));
      const baseCellSize = calculateBaseCellSize(targetWidth);
      setGeometry((current) => (
        Math.abs(current.baseCellSize - baseCellSize) < 0.01 && current.viewportWidth === viewportWidth
          ? current
          : { baseCellSize, viewportWidth }
      ));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  useEffect(() => {
    if (fitMode !== 'fit' || !geometry.viewportWidth) return;
    applyFit();
  }, [applyFit, fitMode, geometry.viewportWidth]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return undefined;
    const handleWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      requestZoom(stepHeatmapZoom(zoom, event.deltaY < 0 ? 1 : -1), {
        clientX: event.clientX,
        clientY: event.clientY
      });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [requestZoom, zoom]);

  useImperativeHandle(ref, () => ({
    fitCalendar: activateFit,
    getViewportState() {
      return {
        scrollLeft: scrollRef.current?.scrollLeft || 0,
        scrollTop: scrollRef.current?.scrollTop || 0,
        zoom
      };
    },
    resetZoom() {
      requestZoom(HEATMAP_RESET_ZOOM);
    },
    scrollToCurrentWeek,
    zoomBy(direction) {
      requestZoom(stepHeatmapZoom(zoom, direction));
    }
  }), [activateFit, requestZoom, scrollToCurrentWeek, zoom]);

  function handlePointerDown(event) {
    if (event.pointerType !== 'touch') return;
    const state = pointerStateRef.current;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size === 2) {
      const [first, second] = [...state.pointers.values()];
      state.pinch = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  }

  function handlePointerMove(event) {
    const state = pointerStateRef.current;
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size !== 2 || !state.pinch) return;
    event.preventDefault();
    const [first, second] = [...state.pointers.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (state.pinch.distance <= 0) return;
    const nextZoom = clampHeatmapZoom(state.pinch.zoom * (distance / state.pinch.distance));
    if (Math.abs(nextZoom - zoom) < 0.02) return;
    requestZoom(nextZoom, {
      clientX: (first.x + second.x) / 2,
      clientY: (first.y + second.y) / 2
    });
    state.pinch = { distance, zoom: nextZoom };
  }

  function handlePointerEnd(event) {
    const state = pointerStateRef.current;
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.pinch = null;
  }

  function getWeekState(week) {
    const today = new Date();
    if (isCurrentWeek(week, today)) return 'current';
    if (week.end < today) return 'past';
    return 'future';
  }

  return (
    <section className="heatmap-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Life calendar</p>
          <h2>One square per week</h2>
        </div>
        <div className="legend">
          <span><i style={{ background: settings.pastColor }} />Past</span>
          <span><i style={{ background: settings.currentWeekColor }} />Current</span>
          <span><i style={{ background: settings.futureColor }} />Future</span>
          <span><i style={{ background: settings.weekendColor }} />Weekend marks</span>
        </div>
      </div>
      <HeatmapZoomToolbar
        fitMode={fitMode}
        zoom={zoom}
        onFit={activateFit}
        onReset={() => requestZoom(HEATMAP_RESET_ZOOM)}
        onZoomIn={() => requestZoom(stepHeatmapZoom(zoom, 1))}
        onZoomOut={() => requestZoom(stepHeatmapZoom(zoom, -1))}
      />
      <div
        ref={scrollRef}
        className="heatmap-scroll"
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
      >
        <div
          ref={heatmapElementRef}
          className="heatmap"
          style={{ '--cell-base': `${geometry.baseCellSize}px`, '--heatmap-zoom': zoom }}
        >
          {rowsWithEvents.map((row) => (
            <div className="year-row" key={row.age}>
              <button className="year-label age-button" type="button" onClick={() => onAgeClick(row.age)}>
                {row.label}
              </button>
              <div className="week-row">
                {row.weeks.map((week) => {
                  const state = getWeekState(week);
                  const weekEvents = week.weekEvents;
                  const baseColor = state === 'past' ? settings.pastColor : settings.futureColor;
                  const title = `${formatDateId(week.start)} to ${formatDateId(week.end)} · Age ${row.age} · ${weekEvents.length} events`;
                  return (
                    <button
                      ref={(node) => node && cellRefs.current.set(week.dateId, node)}
                      className={`week-cell ${state}`}
                      key={week.dateId}
                      type="button"
                      title={title}
                      aria-label={title}
                      onClick={() => onSelectWeek({ ...week, events: weekEvents })}
                      style={{
                        background: baseColor,
                        '--current-color': settings.currentWeekColor,
                        '--weekend-color': settings.weekendColor
                      }}
                    >
                      <span className="event-stripes">
                        {weekEvents.slice(0, 3).map((event) => <i key={event.id} style={{ background: event.color }} />)}
                      </span>
                      {weekEvents.length > 3 && <span className="event-count">{weekEvents.length}</span>}
                      <span className="weekend-strip"><i /><i /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});

export default LifeHeatmap;

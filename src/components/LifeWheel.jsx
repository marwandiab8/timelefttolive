// The Activity time wheel: a ring of lit crystal segments, one per category, with the hub, labels,
// tooltip, comparison ring, moment beads and target marks. Geometry comes from wheelGeometry.js,
// colours from wheelMaterial.js; this file only draws and animates.
//
// Materials: 'crystal' (the glass) or 'plain' (flat fills: reduced transparency, tests, thumbnails).
// Layouts: 'share' (largest first, clockwise from 12) or 'clock' (a day at its real hours).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { APP_TIMEZONE, formatDuration } from '../utils/lifeEventUtils.js';
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
  getWheelLabelMode,
  pointOnRing,
  targetAngle
} from '../utils/wheelGeometry.js';
import { CRYSTAL, frostedStops, labelColorFor, sliceStops } from '../utils/wheelMaterial.js';
import { getActivityIconKey, renderActivityIconPaths } from './activityIcons.jsx';

const { center: C, outerRadius: R, innerRadius: IR } = WHEEL;
const MID_RADIUS = (R + IR) / 2;
const COMPARE_RADIUS = R + 2.2;
const BEAD_RADIUS = R + 4.8;
const ICON_UNITS = 4.6;
const LABEL_FONT = 2.7;
const ENTRANCE_MS = 700;
const MORPH_MS = 350;

const THEMES = {
  dark: { seat: '#0b1015', seatEdge: 'rgba(255,255,255,0.07)', hub: ['#1a242d', '#0e151b'], hubShine: 0.16, hubRim: 0.22, tick: 'rgba(255,255,255,0.55)', track: 'rgba(255,255,255,0.14)', etchDark: 0.35, etchLight: 0.05, hubShadow: 0.55 },
  light: { seat: '#c4ced2', seatEdge: 'rgba(16,38,48,0.2)', hub: ['#ffffff', '#e4eaec'], hubShine: 0.9, hubRim: 0.9, tick: 'rgba(16,38,48,0.55)', track: 'rgba(16,38,48,0.16)', etchDark: 0.1, etchLight: 0.5, hubShadow: 0.22 }
};

const clockFormatter = new Intl.DateTimeFormat(undefined, { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit' });
const CLOCK_LABELS = { 0: '12 AM', 6: '6 AM', 12: 'Noon', 18: '6 PM' };
const PREVIOUS_NAMES = { day: 'yesterday', week: 'last week', month: 'last month', year: 'last year' };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const n = (value) => Number(value.toFixed(3));
const sharePercent = (share) => `${Math.round(share * 1000) / 10}%`;

// --- preferences (SSR-safe: the first render never touches window) -----------------------------

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/** 'crystal' in a browser unless transparency is reduced; 'plain' on the server and in tests. */
export function useWheelMaterial(requested = 'auto') {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reducedTransparency = useMediaQuery('(prefers-reduced-transparency: reduce)');
  if (requested !== 'auto') return requested;
  if (!mounted || reducedTransparency) return 'plain';
  return 'crystal';
}

function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

// --- motion ------------------------------------------------------------------------------------

function withDerived(segment) {
  const sweep = segment.endAngle - segment.startAngle;
  return { ...segment, sweep, midAngle: ((segment.startAngle + sweep / 2) % 360 + 360) % 360, full: Boolean(segment.full) && sweep >= 359.99 };
}

/** Morphs slices between layouts: same key moves, new ones grow from nothing, gone ones shrink. */
function useAnimatedSegments(target, enabled) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const frame = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (!enabled || first.current) {
      first.current = false;
      displayRef.current = target;
      setDisplay(target);
      return undefined;
    }
    const from = new Map(displayRef.current.map((segment) => [segment.key, segment]));
    const keys = new Set(target.map((segment) => segment.key));
    const leaving = displayRef.current.filter((segment) => !keys.has(segment.key) && !segment.leaving);
    const started = performance.now();
    const step = (time) => {
      const t = Math.min(1, (time - started) / MORPH_MS);
      const e = easeInOut(t);
      const moving = target.map((segment) => {
        const previous = from.get(segment.key);
        const fromStart = previous ? previous.startAngle : segment.startAngle;
        const fromEnd = previous ? previous.endAngle : segment.startAngle;
        return withDerived({ ...segment, startAngle: lerp(fromStart, segment.startAngle, e), endAngle: lerp(fromEnd, segment.endAngle, e) });
      });
      const shrinking = t < 1
        ? leaving.map((segment) => withDerived({ ...segment, leaving: true, endAngle: lerp(segment.endAngle, segment.startAngle, e) }))
        : [];
      const next = [...moving, ...shrinking];
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, enabled]);
  return enabled ? display : target;
}

/** The ring draws itself clockwise once, on first paint. Returns 0..1, or 1 when motion is off. */
function useEntrance(enabled) {
  // On the server (and in tests) there is no frame to animate: the ring is complete at once.
  const canAnimate = enabled && typeof window !== 'undefined';
  const [progress, setProgress] = useState(canAnimate ? 0 : 1);
  useEffect(() => {
    if (!canAnimate) {
      setProgress(1);
      return undefined;
    }
    let frame = 0;
    const started = performance.now();
    const step = (time) => {
      const t = Math.min(1, (time - started) / ENTRANCE_MS);
      setProgress(easeInOut(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [canAnimate]);
  return progress;
}

/** Counts a number up to its value, for the hub total. */
export function useCountUp(value, enabled, duration = ENTRANCE_MS) {
  const canAnimate = enabled && typeof window !== 'undefined';
  const [shown, setShown] = useState(canAnimate ? 0 : value);
  const previous = useRef(canAnimate ? 0 : value);
  useEffect(() => {
    if (!canAnimate) {
      previous.current = value;
      setShown(value);
      return undefined;
    }
    let frame = 0;
    const from = previous.current;
    const started = performance.now();
    const step = (time) => {
      const t = Math.min(1, (time - started) / duration);
      const next = Math.round(lerp(from, value, easeInOut(t)));
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
      else previous.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, canAnimate, duration]);
  return shown;
}

// --- data shaping ------------------------------------------------------------------------------

function categoryColors(analysis) {
  return new Map((analysis?.sessionCategories || analysis?.categories || []).map((category) => [category.label, category.color]));
}

/** Allocated fragments of a day, ready for buildClockSegments; a night starts at its bedtime. */
export function buildClockFragments(analysis, bounds) {
  if (!bounds?.start) return { fragments: [], overlays: [] };
  const colors = categoryColors(analysis);
  const dayStart = bounds.start.getTime();
  const fragments = [];
  const overlays = [];
  (analysis?.allocatedSessions || []).forEach((session, sessionIndex) => {
    const wholeNight = Number.isFinite(session.attributedSeconds) && session.nightStartAt;
    (session.fragments || []).forEach((fragment, index) => {
      const start = wholeNight && index === 0 && session.nightStartAt.getTime() < dayStart
        ? session.nightStartAt.getTime()
        : fragment.start;
      const item = {
        key: `${session.category}#${session.id || sessionIndex}#${index}`,
        label: session.category,
        color: colors.get(session.category) || session.color || '#8b98a1',
        start,
        end: fragment.end,
        active: Boolean(session.active) && index === (session.fragments.length - 1),
        title: session.title,
        location: session.location || '',
        session
      };
      (session.category === 'Music' ? overlays : fragments).push(item);
    });
  });
  return { fragments, overlays };
}

/** The instant the local clock shows `hour` on this day (right on the days the clocks change). */
function makeHourAt(bounds) {
  const timeZone = bounds?.timezone || APP_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', hourCycle: 'h23' });
  const dayStart = bounds.start.getTime();
  return (hour) => {
    let at = dayStart + hour * 3_600_000;
    const local = Number(formatter.format(new Date(at)));
    const difference = hour - local;
    if (difference !== 0 && Math.abs(difference) <= 2) at += difference * 3_600_000;
    return at;
  };
}

function sessionWindow(segment) {
  const sessions = segment.sessions || [];
  if (!sessions.length) return null;
  const starts = sessions.map((session) => session.nightStartAt || session.startAt).filter(Boolean);
  const ends = sessions.map((session) => session.endAt).filter(Boolean);
  if (!starts.length) return null;
  const first = new Date(Math.min(...starts.map((date) => date.getTime())));
  const last = ends.length ? new Date(Math.max(...ends.map((date) => date.getTime()))) : null;
  const live = sessions.some((session) => session.active);
  return `${clockFormatter.format(first)} – ${live ? 'in progress' : last ? clockFormatter.format(last) : '…'}`;
}

// --- the wheel ---------------------------------------------------------------------------------

export function LifeWheel({
  analysis,
  categoryAnalysis,
  now,
  onSelect,
  period,
  pointAnalysis,
  selectedLabel,
  title,
  bounds = null,
  layout = 'share',
  compare = 'none',
  compareSeconds = null,
  showUntracked = false,
  beads: beadPoints = [],
  onBeadSelect,
  targets = null,
  targetText = '',
  theme = 'dark',
  material: requestedMaterial = 'auto',
  animate = true,
  svgRef = null
}) {
  const material = useWheelMaterial(requestedMaterial);
  const reducedMotion = usePrefersReducedMotion();
  const motion = animate && !reducedMotion && material !== 'plain';
  const rawId = useId();
  const id = `lw${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const palette = THEMES[theme] || THEMES.dark;
  const isClock = layout === 'clock' && period === 'day' && bounds?.start;
  const gapAngle = material === 'plain' ? WHEEL.gapAngle : CRYSTAL.gapAngle;

  // Share layout: the categories largest first (with the untracked remainder when asked).
  const periodSeconds = bounds?.start && bounds?.end ? (bounds.end - bounds.start) / 1000 : 0;
  const shareSegments = useMemo(() => (
    buildWheelSegments(analysis.categories, { gapAngle, showUntracked, periodSeconds })
      .map((segment) => ({ ...segment, key: segment.label }))
  ), [analysis.categories, gapAngle, periodSeconds, showUntracked]);

  // Clock layout: every allocated fragment at its real time of day.
  const clock = useMemo(() => {
    if (!isClock) return null;
    const dayStart = bounds.start.getTime();
    const dayEnd = bounds.end.getTime();
    const { fragments, overlays } = buildClockFragments(analysis, bounds);
    const nowMs = now ? now.getTime() : null;
    return {
      segments: buildClockSegments(fragments, { dayStart, dayEnd, nowMs }),
      overlays: buildClockSegments(overlays, { dayStart, dayEnd, nowMs }),
      ticks: buildClockTicks({ dayStart, dayEnd, hourAt: makeHourAt(bounds) }),
      toAngle: (date) => (((date.getTime() - dayStart) / (dayEnd - dayStart)) * 360)
    };
  }, [analysis, bounds, isClock, now]);

  const targetSegments = isClock ? clock.segments : shareSegments;
  const animated = useAnimatedSegments(targetSegments, motion);
  const entrance = useEntrance(motion);
  const limit = entrance >= 1 ? Infinity : entrance * 360;
  const segments = useMemo(() => animated
    .filter((segment) => segment.startAngle < limit && segment.sweep > 0.01)
    .map((segment) => (segment.endAngle > limit ? withDerived({ ...segment, endAngle: limit, full: false }) : segment)), [animated, limit]);

  const comparisonArcs = useMemo(() => (
    compare !== 'none' && compareSeconds && !isClock ? buildComparisonArcs(shareSegments, compareSeconds, { gapAngle }) : []
  ), [compare, compareSeconds, gapAngle, isClock, shareSegments]);

  const beads = useMemo(() => {
    if (!beadPoints.length) return [];
    const points = beadPoints.map((point) => ({
      ...point,
      angle: isClock && point.at ? clock.toAngle(point.at) : (Number.isFinite(point.angle) ? point.angle : 0),
      segmentLabel: shareSegments.some((segment) => segment.label === point.segmentLabel)
        ? point.segmentLabel
        : shareSegments.some((segment) => segment.untracked) ? UNTRACKED_LABEL : undefined
    }));
    return buildWheelBeads(points, { segments: shareSegments, layout: isClock ? 'clock' : 'share' });
  }, [beadPoints, clock, isClock, shareSegments]);

  const targetMarks = useMemo(() => {
    if (!targets || isClock) return [];
    return shareSegments.map((segment) => {
      const target = targets.get ? targets.get(segment.label) : targets[segment.label];
      if (!target?.ringSeconds) return null;
      const mark = targetAngle(segment, target.ringSeconds, shareSegments);
      return mark ? { label: segment.label, ...mark, met: target.met } : null;
    }).filter(Boolean);
  }, [isClock, shareSegments, targets]);

  const liveLabels = useMemo(() => new Set(
    (analysis.sessionCategories || analysis.categories || [])
      .filter((category) => (category.allSessions || category.sessions || []).some((session) => session.active))
      .map((category) => category.label)
  ), [analysis]);

  // Hover and keyboard focus share one tooltip; arrows walk the slices.
  const [hovered, setHovered] = useState(null);
  const [focusKey, setFocusKey] = useState(null);
  const sliceRefs = useRef(new Map());
  const selectable = segments.filter((segment) => !segment.untracked && !segment.leaving);
  const activeFocus = selectable.some((segment) => segment.key === focusKey) ? focusKey : selectable[0]?.key;

  function moveFocus(fromKey, delta) {
    const index = selectable.findIndex((segment) => segment.key === fromKey);
    if (index < 0 || selectable.length < 2) return;
    const next = selectable[(index + delta + selectable.length) % selectable.length];
    setFocusKey(next.key);
    sliceRefs.current.get(next.key)?.focus();
  }

  const totalSeconds = Number(analysis.timedSeconds) || 0;
  const countedTotal = useCountUp(totalSeconds, motion);
  const centerSession = categoryAnalysis?.activeSession
    || (period === 'day' && categoryAnalysis?.sessionCount === 1 ? categoryAnalysis?.sessions[0] : null);

  const describe = (segment) => describeSegment(segment, { period, isClock, compare, comparisonArcs, targets, totalSeconds });

  return (
    <div className={`life-wheel material-${material} layout-${isClock ? 'clock' : 'share'}`} data-testid="life-wheel" data-material={material}>
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={`${title} time allocation`}
        ref={svgRef}
        data-theme={theme}
      >
        {material === 'crystal' && <WheelDefs id={id} segments={segments} theme={theme} palette={palette} />}

        {material === 'crystal' && (
          <g className="life-wheel-glow" filter={`url(#${id}-glow)`} opacity={CRYSTAL.glow.alpha[theme] ?? CRYSTAL.glow.alpha.dark}>
            {segments.filter((segment) => !segment.untracked).map((segment) => (
              <path key={segment.key} d={describeWheelSegment(segment)} fill={segment.color} fillRule="evenodd" />
            ))}
          </g>
        )}

        {/* The seat: a dark bezel the gaps open onto, with hour marks in the clock layout. */}
        <circle className="life-wheel-seat" cx={C} cy={C} r={R + 1.4} fill={material === 'crystal' ? `url(#${id}-seat)` : palette.seat} stroke={palette.seatEdge} strokeWidth="0.3" />
        {isClock && clock.ticks.map((tick) => {
          const from = pointOnRing(tick.major ? R + 0.2 : R + 0.5, tick.angle);
          const to = pointOnRing(tick.major ? R + 1.4 : R + 1.15, tick.angle);
          return <line key={tick.hour} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={palette.tick} strokeWidth={tick.major ? 0.45 : 0.25} strokeLinecap="round" />;
        })}
        {isClock && clock.ticks.filter((tick) => CLOCK_LABELS[tick.hour]).map((tick) => {
          const at = pointOnRing(R + 3.4, tick.angle);
          return <text key={`label-${tick.hour}`} x={at.x} y={at.y} className="life-wheel-clock-label" textAnchor="middle" dominantBaseline="central" fontSize="2.1" fontWeight="600" fill={palette.tick}>{CLOCK_LABELS[tick.hour]}</text>;
        })}

        {comparisonArcs.length > 0 && (
          <g className="life-wheel-compare" aria-hidden="true">
            <circle cx={C} cy={C} r={COMPARE_RADIUS} fill="none" stroke={palette.track} strokeWidth="0.25" />
            {comparisonArcs.map((arc) => (
              <path key={arc.label} d={describeArc(COMPARE_RADIUS, arc.startAngle, arc.endAngle)} fill="none" stroke={arc.color} strokeWidth="0.75" strokeLinecap="round" opacity={arc.longer ? 0.85 : 0.55} strokeDasharray={arc.longer ? undefined : '0.01 0'} />
            ))}
          </g>
        )}

        <g className="life-wheel-ring" filter={material === 'crystal' ? `url(#${id}-shadow)` : undefined}>
          {segments.map((segment, index) => (
            <WheelSlice
              key={segment.key}
              id={id}
              index={index}
              segment={segment}
              material={material}
              theme={theme}
              palette={palette}
              selected={selectedLabel === segment.label}
              faded={Boolean(selectedLabel) && selectedLabel !== segment.label}
              live={liveLabels.has(segment.label) && (!isClock || segment.active)}
              tabIndex={segment.key === activeFocus ? 0 : -1}
              onSelect={onSelect}
              onHover={setHovered}
              onFocusKey={setFocusKey}
              onMove={moveFocus}
              registerRef={(element) => { if (element) sliceRefs.current.set(segment.key, element); else sliceRefs.current.delete(segment.key); }}
            />
          ))}
          {isClock && clock.overlays.map((overlay) => (
            <path key={overlay.key} className="life-wheel-overlay" d={describeArc(IR + 2.4, overlay.startAngle, overlay.endAngle)} fill="none" stroke={overlay.color} strokeWidth="2.4" strokeLinecap="round" opacity={selectedLabel && selectedLabel !== overlay.label ? 0.25 : 0.85} onClick={() => onSelect(overlay.label)} />
          ))}
        </g>

        {targetMarks.length > 0 && (
          <g className="life-wheel-targets" aria-hidden="true">
            {targetMarks.map((mark) => {
              const from = pointOnRing(R - 1.6, mark.angle);
              const to = pointOnRing(R + 1.7, mark.angle);
              return <line key={mark.label} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={mark.met ? '#ffffff' : '#f2b84b'} strokeWidth="0.55" strokeLinecap="round" opacity="0.95" />;
            })}
          </g>
        )}

        <WheelLabels segments={segments} />

        {beads.length > 0 && (
          <g className="life-wheel-beads">
            {beads.map((bead) => {
              const at = pointOnRing(BEAD_RADIUS, bead.angle);
              const radius = bead.count > 1 ? 1.75 : 1.35;
              const name = `${bead.label}${bead.count > 1 ? `, ${bead.count} moments` : ''}`;
              return (
                <g
                  key={`${bead.label}-${bead.id}`}
                  className={`life-wheel-bead ${selectedLabel && selectedLabel !== bead.label ? 'faded' : ''}`}
                  role="button"
                  tabIndex="-1"
                  aria-label={name}
                  onClick={() => (onBeadSelect || onSelect)(bead.label, bead)}
                  onMouseEnter={() => setHovered({ bead, x: at.x, y: at.y })}
                  onMouseLeave={() => setHovered(null)}
                >
                  <circle cx={at.x} cy={at.y} r={radius + 0.5} fill={bead.color} opacity="0.25" />
                  <circle cx={at.x} cy={at.y} r={radius} fill={bead.color} stroke="#fff" strokeOpacity="0.55" strokeWidth="0.25" />
                  <circle cx={at.x - radius * 0.32} cy={at.y - radius * 0.32} r={radius * 0.3} fill="#fff" opacity="0.7" />
                  {bead.count > 1 && <text x={at.x} y={at.y + 0.1} textAnchor="middle" dominantBaseline="central" fontSize="1.7" fontWeight="700" fill={labelColorFor(bead.color)}>{bead.count}</text>}
                </g>
              );
            })}
          </g>
        )}

        <WheelHub id={id} material={material} theme={theme} palette={palette} />
      </svg>

      <div className="life-wheel-center" aria-live="polite">
        {categoryAnalysis ? (
          <>
            <span className="life-wheel-icon" aria-hidden="true"><HubIcon label={categoryAnalysis.label} /></span>
            <h2>{categoryAnalysis.label}</h2>
            {centerSession?.location && <p>{centerSession.location}</p>}
            {centerSession ? (
              <time>{clockFormatter.format(sessionShownStart(centerSession))} – {centerSession.active ? 'In progress' : clockFormatter.format(centerSession.endAt)}</time>
            ) : (
              <p>{categoryAnalysis.sessionCount} {categoryAnalysis.sessionCount === 1 ? 'session' : 'sessions'}</p>
            )}
            <strong>{formatDuration(centerSession?.durationSeconds ?? categoryAnalysis.totalSeconds)}</strong>
            {targetText && <small className="life-wheel-target">{targetText}</small>}
          </>
        ) : pointAnalysis ? (
          <>
            <span className="life-wheel-icon" aria-hidden="true"><HubIcon label={pointAnalysis.label} /></span>
            <h2>{pointAnalysis.label}</h2>
            <p>{pointAnalysis.count} {pointAnalysis.count === 1 ? 'event' : 'events'}</p>
            <strong>{pointAnalysis.reliableDuration ? formatDuration(pointAnalysis.totalSeconds) : 'Moments'}</strong>
            {!pointAnalysis.reliableDuration && <span>No duration supplied</span>}
          </>
        ) : (
          <>
            <p>{title}</p>
            <strong>{formatDuration(motion ? countedTotal : totalSeconds)}</strong>
            <span>tracked time</span>
            {analysis.activeCount > 0 && <small><i className="life-wheel-pulse" aria-hidden="true" />{analysis.activeCount} in progress · updated {clockFormatter.format(now)}</small>}
          </>
        )}
      </div>

      {hovered && <WheelTooltip hovered={hovered} describe={describe} />}
    </div>
  );
}

function sessionShownStart(session) {
  return session.nightStartAt || session.startAt;
}

function HubIcon({ label }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {renderActivityIconPaths(getActivityIconKey(label))}
    </svg>
  );
}

// --- material ----------------------------------------------------------------------------------

function WheelDefs({ id, segments, theme, palette }) {
  const specular = CRYSTAL.specular[theme] ?? CRYSTAL.specular.dark;
  const band = CRYSTAL.band.alpha[theme] ?? CRYSTAL.band.alpha.dark;
  const shadow = CRYSTAL.shadow[theme] ?? CRYSTAL.shadow.dark;
  return (
    <defs>
      {/* A glancing light from the upper left, gone before the middle of the wheel. */}
      <linearGradient id={`${id}-spec`} gradientUnits="userSpaceOnUse" x1="16" y1="8" x2="52" y2="48">
        <stop offset="0" stopColor="#fff" stopOpacity={specular} />
        <stop offset="0.28" stopColor="#fff" stopOpacity={n(specular * 0.22)} />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${id}-band`} gradientUnits="userSpaceOnUse" cx="24" cy="14" r="78">
        <stop offset="0" stopColor="#fff" stopOpacity={band} />
        <stop offset="0.55" stopColor="#fff" stopOpacity={n(band * 0.35)} />
        <stop offset="1" stopColor="#fff" stopOpacity="0.04" />
      </radialGradient>
      <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={CRYSTAL.glow.blur} /></filter>
      <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0.6" dy="1.8" stdDeviation="1.6" floodColor="#000" floodOpacity={shadow} /></filter>
      <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4" /></filter>
      <radialGradient id={`${id}-hub`} gradientUnits="userSpaceOnUse" cx="42" cy="40" r="26">
        <stop offset="0" stopColor={palette.hub[0]} /><stop offset="1" stopColor={palette.hub[1]} />
      </radialGradient>
      <radialGradient id={`${id}-hubshine`} gradientUnits="userSpaceOnUse" cx="40" cy="36" r="22">
        <stop offset="0" stopColor="#fff" stopOpacity={palette.hubShine} /><stop offset="0.7" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-seat`} gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R + 2}>
        <stop offset="0.9" stopColor={palette.seat} /><stop offset="1" stopColor={theme === 'dark' ? '#05080b' : '#9aa6ab'} />
      </radialGradient>
      <clipPath id={`${id}-hubclip`}><circle cx={C} cy={C} r={IR - 0.6} /></clipPath>
      {segments.map((segment, index) => {
        const stops = segment.untracked ? frostedStops(theme) : sliceStops(segment.color);
        return (
          <radialGradient key={segment.key} id={`${id}-body-${index}`} gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R}>
            <stop offset={n(IR / R)} stopColor={stops.inner} />
            <stop offset={n((IR + (R - IR) * 0.55) / R)} stopColor={stops.middle} />
            <stop offset="0.985" stopColor={stops.outer} />
          </radialGradient>
        );
      })}
    </defs>
  );
}

function outerArcOf(segment, inset) {
  const pad = segment.full ? 0 : 2.2;
  const start = segment.startAngle + pad;
  const end = segment.endAngle - pad;
  return end > start ? describeArc(R - inset, start, end) : '';
}

function WheelSlice({ id, index, segment, material, theme, palette, selected, faded, live, tabIndex, onSelect, onHover, onFocusKey, onMove, registerRef }) {
  const d = describeWheelSegment(segment);
  const untracked = Boolean(segment.untracked);
  const name = untracked
    ? `Untracked time, ${formatDuration(segment.seconds)}`
    : `${segment.label}, ${formatDuration(segment.seconds)}, ${sharePercent(segment.trueShare)} of tracked time`;
  const lift = selected && !segment.full ? 1.2 : 0;
  const radians = (segment.midAngle * Math.PI) / 180;
  const style = lift ? { transform: `translate(${n(lift * Math.sin(radians))}px, ${n(-lift * Math.cos(radians))}px)` } : undefined;
  const classes = `life-wheel-slice ${faded ? 'faded' : ''} ${selected ? 'selected' : ''} ${live ? 'live' : ''} ${untracked ? 'untracked' : ''}`.replace(/\s+/g, ' ').trim();
  const segmentClass = `life-wheel-segment ${faded ? 'faded' : ''} ${selected ? 'selected' : ''}`;
  const inner = untracked ? frostedStops(theme).inner : sliceStops(segment.color).inner;
  const rimLight = (CRYSTAL.rim.light[theme] ?? CRYSTAL.rim.light.dark);
  const interactive = !untracked && !segment.leaving;

  const handlers = interactive ? {
    role: 'button',
    tabIndex,
    'aria-pressed': selected,
    'aria-label': name,
    ref: registerRef,
    onClick: () => onSelect(segment.label),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(segment.label);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        onMove(segment.key, 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        onMove(segment.key, -1);
      }
    },
    onFocus: () => { onFocusKey(segment.key); onHover({ segment }); },
    onBlur: () => onHover(null),
    onMouseEnter: () => onHover({ segment }),
    onMouseLeave: () => onHover(null)
  } : {
    'aria-label': name,
    onMouseEnter: () => onHover({ segment }),
    onMouseLeave: () => onHover(null)
  };

  if (material === 'plain') {
    return (
      <g className={classes} style={style} data-label={segment.label} {...handlers}>
        <path className={segmentClass} d={d} fill={untracked ? frostedStops(theme).middle : segment.color} fillRule="evenodd" />
        {segment.boosted && !untracked && <path d={outerArcOf(segment, 0.3)} fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="0.25" strokeDasharray="0.6 0.7" />}
      </g>
    );
  }

  return (
    <g className={classes} style={style} data-label={segment.label} {...handlers}>
      <path className={segmentClass} d={d} fill={`url(#${id}-body-${index})`} fillRule="evenodd" />
      {!untracked && <path d={d} fill={`url(#${id}-spec)`} fillRule="evenodd" />}
      {!untracked && <path d={outerArcOf(segment, CRYSTAL.band.width / 2 + 0.25)} fill="none" stroke={`url(#${id}-band)`} strokeWidth={CRYSTAL.band.width} strokeLinecap="round" />}
      <path d={d} fill="none" stroke={inner} strokeOpacity={untracked ? 0.35 : CRYSTAL.rim.dark} strokeWidth="0.7" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#fff" strokeOpacity={untracked ? rimLight * 0.4 : rimLight} strokeWidth="0.32" strokeLinejoin="round" />
      {segment.boosted && !untracked && <path d={outerArcOf(segment, 0.15)} fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="0.25" strokeDasharray="0.6 0.7" />}
      {live && <path className="life-wheel-live" d={outerArcOf(segment, 0.05)} fill="none" stroke={segment.color} strokeWidth="1.6" strokeLinecap="round" filter={`url(#${id}-soft)`} />}
    </g>
  );
}

function WheelHub({ id, material, theme, palette }) {
  const crystal = material === 'crystal';
  return (
    <g className="life-wheel-hub" aria-hidden="true">
      <circle cx={C} cy={C} r={IR - 0.6} fill={crystal ? `url(#${id}-hub)` : palette.hub[1]} />
      {crystal && (
        <g clipPath={`url(#${id}-hubclip)`}>
          <circle cx={C} cy={C} r={IR + 1.2} fill="none" stroke="#000" strokeOpacity={palette.hubShadow} strokeWidth="3.2" filter={`url(#${id}-soft)`} />
          {/* Marwan's K2 logo, etched into the lens: a dark and a light copy a hair apart. */}
          <image href="/brand/k2-logo-watermark.png" x={C - 14.3} y={C - 13.7} width="28" height="28" style={{ filter: 'brightness(0)', opacity: palette.etchDark }} />
          <image href="/brand/k2-logo-watermark.png" x={C - 13.7} y={C - 14.3} width="28" height="28" style={{ filter: 'brightness(4) grayscale(1)', opacity: palette.etchLight }} />
        </g>
      )}
      {!crystal && <image href="/brand/k2-logo-watermark.png" x={C - 14} y={C - 14} width="28" height="28" opacity={theme === 'dark' ? 0.14 : 0.1} />}
      {crystal && <circle cx={C} cy={C} r={IR - 0.6} fill={`url(#${id}-hubshine)`} />}
      <circle cx={C} cy={C} r={IR - 0.75} fill="none" stroke="#fff" strokeOpacity={palette.hubRim} strokeWidth="0.3" />
    </g>
  );
}

// --- labels, tooltip ---------------------------------------------------------------------------

function WheelLabels({ segments }) {
  return (
    <g className="life-wheel-labels" aria-hidden="true" pointerEvents="none">
      {segments.map((segment) => {
        if (segment.leaving) return null;
        const duration = formatDuration(segment.seconds);
        const mode = segment.untracked
          ? (getWheelLabelMode(segment, duration.length) === 'full' ? 'text' : 'none')
          : getWheelLabelMode(segment, duration.length);
        if (mode === 'none') return null;
        const at = pointOnRing(MID_RADIUS, segment.midAngle);
        const color = segment.untracked ? 'currentColor' : labelColorFor(segment.color);
        const key = getActivityIconKey(segment.label);
        return (
          <g key={segment.key} className={`life-wheel-label ${segment.untracked ? 'untracked' : ''}`} style={{ color }}>
            {mode !== 'text' && (
              <svg x={at.x - ICON_UNITS / 2} y={mode === 'full' ? at.y - ICON_UNITS - 0.3 : at.y - ICON_UNITS / 2} width={ICON_UNITS} height={ICON_UNITS} viewBox="0 0 24 24" overflow="visible" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                {renderActivityIconPaths(key)}
              </svg>
            )}
            {(mode === 'full' || mode === 'text') && (
              <text x={at.x} y={mode === 'text' ? at.y : at.y + 2.3} textAnchor="middle" dominantBaseline="central" fontSize={LABEL_FONT} fontWeight="700" fill="currentColor">{duration}</text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function describeSegment(segment, { period, isClock, compare, comparisonArcs, targets, totalSeconds }) {
  if (segment.untracked) {
    return { title: 'Untracked time', lines: [`${formatDuration(segment.seconds)} of this ${period} without a session`, `${sharePercent(segment.trueShare)} of the ${period}`] };
  }
  const lines = [];
  if (isClock) {
    const start = new Date(segment.start);
    const end = segment.active ? null : new Date(segment.end);
    lines.push(`${clockFormatter.format(start)} – ${end ? clockFormatter.format(end) : 'in progress'} · ${formatDuration(segment.seconds)}`);
    if (segment.location) lines.push(segment.location);
    if (segment.wrapsMidnight) lines.push('From bedtime the evening before');
  } else {
    lines.push(`${formatDuration(segment.seconds)} · ${sharePercent(segment.trueShare)} of tracked time`);
    const count = (segment.sessions || []).length;
    if (count) lines.push(`${count} ${count === 1 ? 'session' : 'sessions'}${period === 'day' && sessionWindow(segment) ? ` · ${sessionWindow(segment)}` : ''}`);
    const arc = comparisonArcs.find((candidate) => candidate.label === segment.label);
    if (compare !== 'none' && arc) {
      const delta = segment.seconds - arc.seconds;
      const against = compare === 'previous' ? PREVIOUS_NAMES[period] || 'the previous period' : 'your recent normal';
      lines.push(Math.abs(delta) < 60 ? `Same as ${against}` : `${formatDuration(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than ${against} (${formatDuration(arc.seconds)})`);
    }
    const target = targets?.get ? targets.get(segment.label) : targets?.[segment.label];
    if (target?.text) lines.push(target.text);
  }
  if (segment.boosted) lines.push(`Drawn larger than its share (${sharePercent(segment.trueShare)}) so it stays visible`);
  if (!totalSeconds) lines.push('No tracked time');
  return { title: isClock ? (segment.title || segment.label) : segment.label, lines };
}

function WheelTooltip({ hovered, describe }) {
  if (hovered.bead) {
    const { bead, x, y } = hovered;
    const titles = bead.items.slice(0, 3).map((item) => item.title).filter(Boolean);
    return (
      <div className={`life-wheel-tooltip ${x > 50 ? 'right' : 'left'} ${y > 50 ? 'below' : 'above'}`} style={{ left: `${x}%`, top: `${y}%` }} role="tooltip">
        <strong>{bead.label}{bead.count > 1 ? ` · ${bead.count}` : ''}</strong>
        {titles.map((text, index) => <span key={index}>{text}</span>)}
        {bead.items[0]?.at && <span>{clockFormatter.format(bead.items[0].at)}{bead.count > 1 && bead.items.at(-1)?.at ? ` – ${clockFormatter.format(bead.items.at(-1).at)}` : ''}</span>}
      </div>
    );
  }
  const { segment } = hovered;
  const at = pointOnRing(MID_RADIUS, segment.midAngle);
  const { title, lines } = describe(segment);
  return (
    <div className={`life-wheel-tooltip ${at.x > 50 ? 'right' : 'left'} ${at.y > 50 ? 'below' : 'above'}`} style={{ left: `${at.x}%`, top: `${at.y}%`, '--tooltip-color': segment.color || 'transparent' }} role="tooltip">
      <strong>{title}</strong>
      {lines.map((line, index) => <span key={index}>{line}</span>)}
    </div>
  );
}

// --- thumbnails --------------------------------------------------------------------------------

/** A small plain wheel: for the days of a week or the weeks of a month. */
export function MiniWheel({ categories, size = 56, label, selected = false, onClick, emptyLabel = 'Nothing tracked' }) {
  const segments = buildWheelSegments(categories || [], { gapAngle: 3, minAngle: 10, cornerRadius: 1.2 });
  const total = (categories || []).reduce((sum, category) => sum + (category.seconds || 0), 0);
  return (
    <button className={`mini-wheel ${selected ? 'selected' : ''}`} type="button" onClick={onClick} aria-label={`${label}: ${total ? formatDuration(total) : emptyLabel}`} title={`${label}: ${total ? formatDuration(total) : emptyLabel}`}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <circle cx={C} cy={C} r={R} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth={R - IR} />
        {segments.map((segment) => <path key={segment.label} d={describeWheelSegment(segment)} fill={segment.color} fillRule="evenodd" />)}
      </svg>
      <span>{label}</span>
    </button>
  );
}

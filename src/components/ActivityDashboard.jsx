import { useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from './BrandLogo.jsx';
import { saveActivityTargets, useAllLifeEvents, useActivityJournalDetails, useConnectedSources, useLifeEvents } from '../hooks/useCalendar.js';
import { loadAuthorizedActivityImage } from '../services/activityJournal.js';
import { deleteActivityEntry, editActivityEntry, restoreActivityEntry } from '../services/activityEntries.js';
import { listRecentlyDeleted } from '../services/recycleBin.js';
import PrimaryViewSwitcher from './PrimaryViewSwitcher.jsx';
import { LifeWheel, MiniWheel } from './LifeWheel.jsx';
import { ActivityIcon } from './activityIcons.jsx';
import { buildNotableFacts, countWeekDays } from '../utils/activityNotables.js';
import { TARGET_DEFINITIONS, describeTarget, evaluateTarget, normalizeActivityTargets, targetAmount } from '../utils/activityTargets.js';
import { exportWheelImage } from '../utils/wheelImage.js';
import {
  APP_TIMEZONE,
  buildActivityTallies,
  buildCategoryAnalysis,
  buildCategoryInsight,
  buildChronologicalActivityTimeline,
  buildDayActivityChart,
  buildJournalEntries,
  buildJournalMetrics,
  buildPointCategoryAnalysis,
  buildPeriodAnalysis,
  enrichLifeEventsWithJournalDetails,
  formatDuration,
  getActivityTallyRange,
  getActivityLabel,
  getDateIdInTimezone,
  getEventDisplayTitle,
  getEventEndTime,
  getEventReceivedTime,
  getEventTime,
  getEventSentTime,
  getIncompleteSessionMessage,
  getMeaningfulEventDetails,
  getLocalDateId,
  getPeriodBounds,
  groupPhotosByDate,
  shiftPeriodDate,
  toggleActivitySelection,
  toJsDate
} from '../utils/lifeEventUtils.js';

// The wheel itself lives in LifeWheel.jsx; re-exported so existing imports and tests keep working.
export { LifeWheel, MiniWheel };

const PERIODS = ['day', 'week', 'month', 'year'];
const TALLY_RANGES = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'This year' },
  { id: '30d', label: '30 days' },
  { id: '7d', label: '7 days' }
];
const HISTORY_PERIOD_COUNTS = { day: 14, week: 8, month: 6, year: 3 };
const LAYOUT_KEY = 'activityWheelLayout';
const COMPARE_KEY = 'activityWheelCompare';
const readPreference = (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key));
const writePreference = (key, value) => { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); };
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { timeZone: 'America/Toronto', weekday: 'short' });

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
});
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  month: 'short', day: 'numeric'
});
const tallyDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  month: 'short', day: 'numeric', year: 'numeric'
});
const monthFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  month: 'short'
});
const clockFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  hour: 'numeric', minute: '2-digit'
});

function queryBounds(bounds) {
  if (!bounds) return null;
  return {
    start: new Date(bounds.start.getTime() - (36 * 3600 * 1000)),
    end: new Date(bounds.end.getTime() + (36 * 3600 * 1000))
  };
}

function titleForPeriod(period, dateId, bounds, now) {
  const today = getLocalDateId(now);
  if (period === 'day') {
    if (dateId === today) return 'Today';
    if (dateId === shiftPeriodDate(today, 'day', -1)) return 'Yesterday';
    return dateFormatter.format(bounds.start);
  }
  if (period === 'week') {
    const thisWeek = getPeriodBounds('week', today).startDateId;
    if (bounds.startDateId === thisWeek) return 'This Week';
    if (bounds.startDateId === shiftPeriodDate(thisWeek, 'week', -1)) return 'Last Week';
    return `Week of ${shortDateFormatter.format(bounds.start)}`;
  }
  if (period === 'month') {
    return new Intl.DateTimeFormat(undefined, { timeZone: APP_TIMEZONE, month: 'long', year: 'numeric' }).format(bounds.start);
  }
  return String(new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric' }).format(bounds.start));
}

export default function ActivityDashboard({ active = true, calendar, onBack }) {
  const [mode, setMode] = useState('wheel');
  const [period, setPeriod] = useState('day');
  const [dateId, setDateId] = useState(() => getLocalDateId());
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [tallyRangeId, setTallyRangeId] = useState('all');
  const [now, setNow] = useState(() => new Date());
  const [theme, setTheme] = useState(() => (
    readPreference('activityDashboardTheme') === 'light' ? 'light' : 'dark'
  ));
  const [managedEntry, setManagedEntry] = useState(null);
  const [managementMessage, setManagementMessage] = useState('');
  const [managementError, setManagementError] = useState('');
  const [layout, setLayout] = useState(() => (readPreference(LAYOUT_KEY) === 'clock' ? 'clock' : 'share'));
  const [compare, setCompare] = useState(() => (['previous', 'normal'].includes(readPreference(COMPARE_KEY)) ? readPreference(COMPARE_KEY) : 'none'));
  const [untrackedPreference, setUntrackedPreference] = useState(null);
  const wheelSvgRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const bounds = useMemo(() => getPeriodBounds(period, dateId), [period, dateId]);
  const previousBounds = useMemo(() => (
    bounds ? getPeriodBounds(period, shiftPeriodDate(dateId, period, -1)) : null
  ), [bounds, dateId, period]);
  const currentQuery = useMemo(() => queryBounds(bounds), [bounds]);
  const historyQuery = useMemo(() => {
    if (!bounds) return null;
    const historyStart = getPeriodBounds(period, shiftPeriodDate(dateId, period, -HISTORY_PERIOD_COUNTS[period]));
    return {
      start: new Date(historyStart.start.getTime() - (36 * 3600 * 1000)),
      end: new Date(bounds.start.getTime() + (36 * 3600 * 1000))
    };
  }, [bounds, dateId, period]);
  const currentState = useLifeEvents(calendar.id, currentQuery?.start, currentQuery?.end, active && mode === 'wheel' && Boolean(bounds));
  const historyState = useLifeEvents(calendar.id, historyQuery?.start, historyQuery?.end, active && mode === 'wheel' && Boolean(historyQuery));
  const allLifeEventState = useAllLifeEvents(calendar.id, active && mode === 'totals');
  const sourceState = useConnectedSources(calendar.id, active);
  const journalState = useActivityJournalDetails(
    calendar.id,
    currentState.lifeEvents,
    active && mode === 'wheel' && !currentState.loading
  );
  const enrichedLifeEvents = useMemo(() => (
    enrichLifeEventsWithJournalDetails(currentState.lifeEvents, journalState.details)
  ), [currentState.lifeEvents, journalState.details]);

  const analysis = useMemo(() => buildPeriodAnalysis(enrichedLifeEvents, bounds, {
    includeActive: true,
    now
  }), [bounds, enrichedLifeEvents, now]);
  const recentHistory = useMemo(() => Array.from({ length: HISTORY_PERIOD_COUNTS[period] }, (_, index) => {
    const historyBounds = getPeriodBounds(period, shiftPeriodDate(dateId, period, -(index + 1)));
    return {
      bounds: historyBounds,
      analysis: buildPeriodAnalysis(historyState.lifeEvents, historyBounds, { includeActive: false, now })
    };
  }), [dateId, historyState.lifeEvents, now, period]);
  const previousAnalysis = recentHistory[0]?.analysis || buildPeriodAnalysis([], previousBounds);
  const selectedCategory = analysis.sessionCategories.find((category) => category.label === selectedLabel) || null;
  const selectedPointCategory = selectedCategory
    ? null
    : analysis.pointCategories.find((category) => category.label === selectedLabel) || null;
  const categoryAnalysis = useMemo(() => (
    buildCategoryAnalysis(selectedCategory, analysis, previousAnalysis, bounds, recentHistory.map((item) => item.analysis))
  ), [analysis, bounds, previousAnalysis, recentHistory, selectedCategory]);
  const pointAnalysis = useMemo(() => buildPointCategoryAnalysis(selectedPointCategory), [selectedPointCategory]);

  // What the comparison ring measures against: the previous period, or the recent normal
  // (the average of the loaded periods that had the category, at least two of them).
  const compareSeconds = useMemo(() => {
    if (compare === 'previous') return new Map(previousAnalysis.categories.map((category) => [category.label, category.seconds]));
    if (compare === 'normal') {
      return new Map(analysis.categories.map((category) => {
        const recent = recentHistory
          .map((item) => item.analysis.categories.find((candidate) => candidate.label === category.label)?.seconds)
          .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
        return [category.label, recent.length >= 2 ? recent.reduce((sum, seconds) => sum + seconds, 0) / recent.length : 0];
      }).filter(([, seconds]) => seconds > 0));
    }
    return null;
  }, [analysis.categories, compare, previousAnalysis.categories, recentHistory]);
  const showUntracked = untrackedPreference ?? period === 'day';

  const activityTargets = useMemo(() => normalizeActivityTargets(calendar.activityTargets), [calendar.activityTargets]);
  const targetMarks = useMemo(() => {
    const marks = new Map();
    analysis.categories.forEach((category) => {
      const activeDays = new Set(category.sessions.map((session) => getDateIdInTimezone(session.startAt, bounds.timezone))).size;
      const evaluation = evaluateTarget(activityTargets, {
        label: category.label,
        totalSeconds: category.seconds,
        sessionCount: category.sessions.length,
        activeDays,
        averageActiveDaySeconds: activeDays ? category.seconds / activeDays : 0
      }, period, bounds, { weekSessionCount: period === 'day' ? countWeekDays(category.label, analysis, recentHistory, dateId) : undefined });
      if (evaluation) marks.set(category.label, evaluation);
    });
    return marks;
  }, [activityTargets, analysis, bounds, dateId, period, recentHistory]);
  const selectedTarget = categoryAnalysis ? targetMarks.get(categoryAnalysis.label) || null : null;

  const facts = useMemo(() => buildNotableFacts({ analysis, history: recentHistory, period, bounds }), [analysis, bounds, period, recentHistory]);

  // Moments as beads on the rim: one point per grouped moment, coloured by its point category.
  const beads = useMemo(() => {
    const colors = new Map(analysis.pointCategories.map((category) => [category.label, category.color]));
    return analysis.momentGroups
      .filter((group) => colors.has(group.pointCategory))
      .map((group) => ({
        id: group.id,
        label: group.pointCategory,
        color: colors.get(group.pointCategory),
        at: group.firstAt,
        title: group.title,
        count: group.count,
        segmentLabel: group.category
      }));
  }, [analysis.momentGroups, analysis.pointCategories]);

  // Small multiples: the days of a week, or the weeks of a month, from the data already loaded.
  const miniWheels = useMemo(() => {
    if (period === 'week') {
      return Array.from({ length: 7 }, (_, index) => {
        const id = shiftPeriodDate(bounds.startDateId, 'day', index);
        const dayBounds = getPeriodBounds('day', id);
        return { id, period: 'day', label: weekdayFormatter.format(dayBounds.start), categories: buildPeriodAnalysis(enrichedLifeEvents, dayBounds, { includeActive: true, now }).categories };
      });
    }
    if (period === 'month') {
      const weeks = [];
      for (let cursor = getPeriodBounds('week', bounds.startDateId).startDateId; cursor <= bounds.endDateId; cursor = shiftPeriodDate(cursor, 'week', 1)) {
        const weekBounds = getPeriodBounds('week', cursor);
        weeks.push({ id: cursor, period: 'week', label: shortDateFormatter.format(weekBounds.start), categories: buildPeriodAnalysis(enrichedLifeEvents, weekBounds, { includeActive: true, now }).categories });
      }
      return weeks;
    }
    return [];
  }, [bounds, enrichedLifeEvents, now, period]);

  const tallyRange = useMemo(() => getActivityTallyRange(tallyRangeId, now), [now, tallyRangeId]);
  const tallies = useMemo(() => buildActivityTallies(allLifeEventState.lifeEvents, {
    calendarId: calendar.id,
    includeActive: true,
    now,
    ownerUid: calendar.ownerUid,
    range: tallyRange
  }), [allLifeEventState.lifeEvents, calendar.id, calendar.ownerUid, now, tallyRange]);

  const error = currentState.error || historyState.error || allLifeEventState.error || sourceState.error;
  const title = titleForPeriod(period, dateId, bounds, now);
  const accent = selectedCategory?.color || selectedPointCategory?.color || '#65d6ad';

  function chooseMode(nextMode) {
    setMode(nextMode);
    setSelectedLabel(null);
  }

  function choosePeriod(nextPeriod) {
    setPeriod(nextPeriod);
    setSelectedLabel(null);
  }

  function movePeriod(amount) {
    setDateId(shiftPeriodDate(dateId, period, amount));
    setSelectedLabel(null);
  }

  function toggleSelection(label) {
    setSelectedLabel((current) => toggleActivitySelection(current, label));
  }

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    writePreference('activityDashboardTheme', nextTheme);
  }

  function chooseLayout(nextLayout) {
    setLayout(nextLayout);
    writePreference(LAYOUT_KEY, nextLayout);
  }

  function chooseCompare(nextCompare) {
    setCompare(nextCompare);
    writePreference(COMPARE_KEY, nextCompare);
  }

  function flash(message) {
    setManagementMessage(message);
    window.setTimeout(() => setManagementMessage(''), 3500);
  }

  async function saveTarget(label, amount) {
    setManagementError('');
    const definition = TARGET_DEFINITIONS[label];
    if (!definition) return;
    const next = { ...activityTargets };
    if (amount) next[label] = { [definition.kind]: amount };
    else delete next[label];
    try {
      await saveActivityTargets(calendar.id, normalizeActivityTargets(next));
      flash(amount ? `Target saved: ${describeTarget(label, amount)}.` : `Target removed for ${label}.`);
    } catch (error) {
      setManagementError(error?.message || 'Unable to save this target.');
    }
  }

  async function exportWheel() {
    setManagementError('');
    const leading = analysis.categories.slice(0, 3).map((category) => `${category.label} ${formatDuration(category.seconds)}`).join(', ');
    const dateLabel = period === 'day' ? dateFormatter.format(bounds.start) : title;
    try {
      const fileName = await exportWheelImage({
        svg: wheelSvgRef.current,
        title: categoryAnalysis ? categoryAnalysis.label : title,
        total: formatDuration(categoryAnalysis ? categoryAnalysis.totalSeconds : analysis.timedSeconds),
        subtitle: categoryAnalysis ? `${categoryAnalysis.sessionCount} ${categoryAnalysis.sessionCount === 1 ? 'session' : 'sessions'}` : 'tracked time',
        caption: [dateLabel, formatDuration(analysis.timedSeconds), leading].filter(Boolean).join(' · '),
        theme,
        fileName: `time-wheel-${bounds.startDateId}${period === 'day' ? '' : `-${period}`}.png`
      });
      flash(`Saved ${fileName}.`);
    } catch (error) {
      setManagementError(error?.message || 'Unable to save the wheel image.');
    }
  }

  // Keyboard: arrows move the period, D W M Y pick one, T is today, Escape clears the selection.
  // Nothing fires while typing, while a dialog or the photo preview is open, or inside the wheel
  // (whose own arrow keys walk the slices).
  useEffect(() => {
    if (!active || mode !== 'wheel') return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
      if (document.querySelector('[role="dialog"]') || target?.closest?.('.life-wheel-slice')) return;
      const key = event.key.toLowerCase();
      if (event.key === 'ArrowLeft') movePeriod(-1);
      else if (event.key === 'ArrowRight') movePeriod(1);
      else if (event.key === 'Escape') setSelectedLabel(null);
      else if (key === 'd') choosePeriod('day');
      else if (key === 'w') choosePeriod('week');
      else if (key === 'm') choosePeriod('month');
      else if (key === 'y') choosePeriod('year');
      else if (key === 't') setDateId(getLocalDateId(now));
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function saveManagedEntry(data) {
    setManagementError('');
    try {
      await editActivityEntry({ calendarId: calendar.id, ...data });
      setManagedEntry(null);
      setManagementMessage('Activity updated.');
      window.setTimeout(() => setManagementMessage(''), 3500);
    } catch (error) {
      setManagementError(error?.message || 'Unable to update this activity.');
    }
  }

  async function removeManagedEntry(entry) {
    setManagementError('');
    try {
      await deleteActivityEntry(buildDeleteRequest(calendar.id, entry));
      setManagedEntry(null);
      setManagementMessage('Activity deleted.');
      window.setTimeout(() => setManagementMessage(''), 3500);
    } catch (error) {
      setManagementError(error?.message || 'Unable to delete this activity.');
    }
  }

  function inspectTally(tally) {
    setPeriod('day');
    setDateId(tally.latestDateId || getLocalDateId(now));
    setSelectedLabel(tally.detailLabel || tally.label);
    setMode('wheel');
  }

  return (
    <main className="activity-dashboard activity-cycle" data-theme={theme} hidden={!active} style={{ '--activity-focus': accent }}>
      <header className="cycle-header">
        <div className="cycle-brand">
          <p className="brand-row"><BrandLogo size={28} />Time Left To Live</p>
          <h1>Activity</h1>
        </div>
        <nav className="cycle-view-switcher" aria-label="Activity view">
          <button className={mode === 'wheel' ? 'selected' : ''} type="button" onClick={() => chooseMode('wheel')}>Time wheel</button>
          <button className={mode === 'totals' ? 'selected' : ''} type="button" onClick={() => chooseMode('totals')}>My totals</button>
        </nav>
        <div className="cycle-header-actions">
          <button className="cycle-text-button" type="button" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
          <PrimaryViewSwitcher currentView="activity" onCalendar={onBack} />
        </div>
      </header>

      {error && <div className="activity-alert" role="alert">Some activity data could not be loaded. {error}</div>}
      {managementMessage && <div className="activity-alert success" role="status">{managementMessage}</div>}
      {managementError && <div className="activity-alert" role="alert">{managementError}</div>}

      {mode === 'wheel' ? (
        <WheelView
          analysis={analysis}
          bounds={bounds}
          categoryAnalysis={categoryAnalysis}
          dateId={dateId}
          journalState={journalState}
          calendarId={calendar.id}
          loading={currentState.loading}
          now={now}
          onDateChange={setDateId}
          onMove={movePeriod}
          onPeriodChange={choosePeriod}
          onSelect={toggleSelection}
          onToday={() => setDateId(getLocalDateId(now))}
          period={period}
          pointAnalysis={pointAnalysis}
          previousAnalysis={previousAnalysis}
          recentHistory={recentHistory}
          selectedLabel={selectedLabel}
          title={title}
          onEdit={(entry) => setManagedEntry(entry)}
          onDelete={(entry) => setManagedEntry({ ...entry, confirmDelete: true })}
          theme={theme}
          layout={layout}
          onLayoutChange={chooseLayout}
          compare={compare}
          onCompareChange={chooseCompare}
          compareSeconds={compareSeconds}
          showUntracked={showUntracked}
          onToggleUntracked={() => setUntrackedPreference(!showUntracked)}
          beads={beads}
          targets={activityTargets}
          targetMarks={targetMarks}
          selectedTarget={selectedTarget}
          onSaveTarget={saveTarget}
          facts={facts}
          miniWheels={miniWheels}
          onExport={exportWheel}
          wheelSvgRef={wheelSvgRef}
        />
      ) : (
        <TotalsView
          loading={allLifeEventState.loading}
          onInspect={inspectTally}
          onRangeChange={setTallyRangeId}
          range={tallyRange}
          rangeId={tallyRangeId}
          tallies={tallies}
        />
      )}

      <details className="cycle-technical">
        <summary>Tracking status</summary>
        <p>{sourceState.connections.filter((connection) => connection.status === 'active').length} active connected sources. Technical delivery details are kept out of the reflection view.</p>
      </details>
      <RecentlyDeleted calendarId={calendar?.id} onRestored={() => setManagementMessage('Activity restored. It is back on the timeline and in the totals.')} />
      {managedEntry && <ActivityEntryDialog entry={managedEntry} onCancel={() => setManagedEntry(null)} onDelete={() => removeManagedEntry(managedEntry)} onSave={saveManagedEntry} />}
    </main>
  );
}

// What a recycled activity reads as in the "Recently deleted" list: its title, when it happened, when it
// was deleted. Exported for tests.
export function describeRecycledItem(item, now = new Date()) {
  const occurredAt = toJsDate(item?.startAt) || toJsDate(item?.occurredAt);
  const recycledAt = toJsDate(item?.recycledAt);
  const when = occurredAt ? `${shortDateFormatter.format(occurredAt)} ${clockFormatter.format(occurredAt)}` : 'Unknown time';
  const ago = recycledAt ? Math.max(0, Math.round((now.getTime() - recycledAt.getTime()) / 86400000)) : null;
  const deleted = ago === null ? '' : ago === 0 ? 'deleted today' : ago === 1 ? 'deleted yesterday' : `deleted ${ago} days ago`;
  const both = Array.isArray(item?.recycledWith) && item.recycledWith.length > 1;
  return { title: item?.title || 'Activity', when, deleted, both };
}

// Deleted activities wait 90 days in the recycle bin. Restoring one puts the event back and lifts the
// tombstone that stopped the phone from re-sending it (functions/src/activityEntries.js). The list is
// loaded when the panel is opened; `load` and `restore` are injectable for tests.
export function RecentlyDeleted({ calendarId, onRestored, load = listRecentlyDeleted, restore = restoreActivityEntry }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !calendarId) return undefined;
    let cancelled = false;
    setError('');
    load(calendarId).then((list) => { if (!cancelled) setItems(list); }).catch((loadError) => { if (!cancelled) setError(loadError?.message || 'Could not load recently deleted activities.'); });
    return () => { cancelled = true; };
  }, [open, calendarId, load]);

  async function bringBack(item) {
    setBusyId(item.id);
    setError('');
    try {
      const result = await restore({ calendarId, eventId: item.id });
      const restoredIds = new Set(result?.data?.ids || result?.ids || [item.id]);
      setItems((current) => (current || []).filter((entry) => !restoredIds.has(entry.id)));
      if (onRestored) onRestored(result);
    } catch (restoreError) {
      setError(restoreError?.message || 'Could not restore this activity.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <details className="cycle-technical cycle-recycle-bin" onToggle={(eventObject) => setOpen(eventObject.currentTarget.open)}>
      <summary>Recently deleted</summary>
      {error && <p className="cycle-error">{error}</p>}
      {items === null && !error && <p>Loading…</p>}
      {items && items.length === 0 && <p>Nothing deleted in the last 90 days.</p>}
      {items && items.length > 0 && (
        <ul>
          {items.map((item) => {
            const described = describeRecycledItem(item);
            return (
              <li key={item.id}>
                <div><strong>{described.title}</strong><span>{described.when}{described.deleted ? ` · ${described.deleted}` : ''}{described.both ? ' · with its pair' : ''}</span></div>
                <button type="button" disabled={busyId === item.id} onClick={() => bringBack(item)}>{busyId === item.id ? 'Restoring…' : 'Restore'}</button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

function WheelView({
  analysis,
  bounds,
  calendarId,
  categoryAnalysis,
  dateId,
  journalState,
  loading,
  now,
  onDateChange,
  onMove,
  onPeriodChange,
  onSelect,
  onToday,
  period,
  pointAnalysis,
  previousAnalysis,
  recentHistory,
  selectedLabel,
  title,
  onEdit,
  onDelete,
  theme,
  layout,
  onLayoutChange,
  compare,
  onCompareChange,
  compareSeconds,
  showUntracked,
  onToggleUntracked,
  beads,
  targets,
  targetMarks,
  selectedTarget,
  onSaveTarget,
  facts,
  miniWheels,
  onExport,
  wheelSvgRef
}) {
  const hasNormal = recentHistory.filter((item) => item.analysis.categories.length).length >= 2;
  return (
    <>
      <PeriodNavigation
        dateId={dateId}
        onDateChange={onDateChange}
        onMove={onMove}
        onPeriodChange={onPeriodChange}
        onToday={onToday}
        period={period}
        title={title}
      />

      <section className={`cycle-hero ${selectedLabel ? 'has-selection' : ''}`}>
        <div className="cycle-wheel-stage">
          <WheelControls
            period={period}
            layout={layout}
            onLayoutChange={onLayoutChange}
            compare={compare}
            onCompareChange={onCompareChange}
            hasNormal={hasNormal}
            showUntracked={showUntracked}
            onToggleUntracked={onToggleUntracked}
            onExport={onExport}
            canExport={!loading && analysis.categories.length > 0}
          />
          {loading ? (
            <LoadingState label="Building your time wheel…" />
          ) : analysis.categories.length ? (
            <LifeWheel
              analysis={analysis}
              bounds={bounds}
              categoryAnalysis={categoryAnalysis}
              now={now}
              onSelect={onSelect}
              period={period}
              pointAnalysis={pointAnalysis}
              selectedLabel={selectedLabel}
              title={title}
              theme={theme}
              layout={layout}
              compare={compare}
              compareSeconds={compareSeconds}
              showUntracked={showUntracked}
              beads={beads}
              targets={targetMarks}
              targetText={selectedTarget?.text || ''}
              svgRef={wheelSvgRef}
            />
          ) : (
            <EmptyWheel title={title} momentCount={analysis.momentGroups.length} incompleteCount={analysis.incompleteCount} />
          )}
        </div>

        <aside className="cycle-glance">
          {categoryAnalysis ? (
            <SelectedGlance analysis={categoryAnalysis} onClear={() => onSelect(categoryAnalysis.label)} target={selectedTarget} targets={targets} onSaveTarget={onSaveTarget} />
          ) : pointAnalysis ? (
            <PointGlance analysis={pointAnalysis} onClear={() => onSelect(pointAnalysis.label)} />
          ) : (
            <PeriodGlance analysis={analysis} bounds={bounds} title={title} facts={facts} />
          )}
          {miniWheels.length > 0 && (
            <div className="cycle-mini-wheels" aria-label={period === 'week' ? 'Each day of this week' : 'Each week of this month'}>
              {miniWheels.map((wheel) => (
                <MiniWheel
                  key={wheel.id}
                  categories={wheel.categories}
                  label={wheel.label}
                  onClick={() => {
                    onPeriodChange(wheel.period);
                    onDateChange(wheel.id);
                  }}
                />
              ))}
            </div>
          )}
          <CategoryLegend
            categories={analysis.sessionCategories}
            pointCategories={analysis.pointCategories}
            onSelect={onSelect}
            selectedLabel={selectedLabel}
          />
        </aside>
      </section>

      <ActivityStream
        analysis={analysis}
        bounds={bounds}
        now={now}
        onInspectDate={(nextDateId) => {
          onPeriodChange('day');
          onDateChange(nextDateId);
        }}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {period === 'day' && (
        <PhotoGallery
          calendarId={calendarId}
          dateId={bounds.startDateId}
          error={journalState.error}
          loading={journalState.loading}
          media={journalState.media}
        />
      )}

      {categoryAnalysis ? (
        <FocusedAnalysis
          analysis={categoryAnalysis}
          bounds={bounds}
          period={period}
          periodAnalysis={analysis}
          previousAnalysis={previousAnalysis}
          recentHistory={recentHistory}
        />
      ) : pointAnalysis?.label === 'Journal' ? (
        <JournalAnalysis
          bounds={bounds}
          calendarId={calendarId}
          events={analysis.events}
          journalState={journalState}
          period={period}
        />
      ) : pointAnalysis ? (
        <FocusedPointAnalysis analysis={pointAnalysis} bounds={bounds} period={period} />
      ) : null}
    </>
  );
}

function WheelControls({ period, layout, onLayoutChange, compare, onCompareChange, hasNormal, showUntracked, onToggleUntracked, onExport, canExport }) {
  return (
    <div className="cycle-wheel-tools">
      {period === 'day' && (
        <div className="cycle-segmented" role="group" aria-label="Wheel layout">
          <button type="button" aria-pressed={layout === 'share'} className={layout === 'share' ? 'selected' : ''} onClick={() => onLayoutChange('share')}>Share</button>
          <button type="button" aria-pressed={layout === 'clock'} className={layout === 'clock' ? 'selected' : ''} onClick={() => onLayoutChange('clock')}>Clock</button>
        </div>
      )}
      <div className="cycle-segmented" role="group" aria-label="Compare with">
        <span>Compare</span>
        <button type="button" aria-pressed={compare === 'none'} className={compare === 'none' ? 'selected' : ''} onClick={() => onCompareChange('none')}>None</button>
        <button type="button" aria-pressed={compare === 'previous'} className={compare === 'previous' ? 'selected' : ''} onClick={() => onCompareChange('previous')}>Previous</button>
        <button type="button" aria-pressed={compare === 'normal'} className={compare === 'normal' ? 'selected' : ''} disabled={!hasNormal} title={hasNormal ? '' : 'Needs two recent periods with activity'} onClick={() => onCompareChange('normal')}>Normal</button>
      </div>
      <button type="button" className={`cycle-tool-toggle ${showUntracked ? 'selected' : ''}`} aria-pressed={showUntracked} onClick={onToggleUntracked}>Untracked time</button>
      <button type="button" className="cycle-tool-action" disabled={!canExport} onClick={onExport}>Save as image</button>
    </div>
  );
}

function PeriodNavigation({ period, title, dateId, onPeriodChange, onMove, onDateChange, onToday }) {
  return (
    <nav className="cycle-period-nav" aria-label="Time period">
      <div className="cycle-period-tabs">
        {PERIODS.map((option) => (
          <button className={period === option ? 'selected' : ''} key={option} type="button" onClick={() => onPeriodChange(option)}>
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
      <div className="cycle-date-nav">
        <button type="button" onClick={() => onMove(-1)} aria-label="Previous period">‹</button>
        <strong>{title}</strong>
        <button type="button" onClick={() => onMove(1)} aria-label="Next period">›</button>
      </div>
      <div className="cycle-date-actions">
        <label><span>Choose date</span><input type="date" value={dateId} onChange={(event) => onDateChange(event.target.value)} /></label>
        <button type="button" onClick={onToday}>Today</button>
      </div>
    </nav>
  );
}

function CategoryLegend({ categories, pointCategories, selectedLabel, onSelect }) {
  const timedLabels = new Set(categories.map((category) => category.label));
  const selectablePoints = pointCategories.filter((category) => !timedLabels.has(category.label));
  return (
    <div className="cycle-legend" aria-label="Activity categories">
      {categories.map((category) => (
        <button className={selectedLabel === category.label ? 'selected' : ''} key={category.label} type="button" onClick={() => onSelect(category.label)}>
          <i style={{ background: category.color }} /><span><ActivityIcon label={category.label} size={16} /> {category.label}</span><strong>{category.seconds > 0 ? formatDuration(category.seconds) : 'Incomplete'}</strong>
        </button>
      ))}
      {selectablePoints.map((category) => (
        <button className={selectedLabel === category.label ? 'selected' : ''} key={`point-${category.label}`} type="button" onClick={() => onSelect(category.label)}>
          <i style={{ background: category.color }} /><span><ActivityIcon label={category.label} size={16} /> {category.label}</span><strong>{category.count} {category.count === 1 ? 'event' : 'events'}</strong>
        </button>
      ))}
    </div>
  );
}

function PeriodGlance({ analysis, bounds, title, facts = [] }) {
  const leading = analysis.categories[0];
  const coverage = bounds.period === 'day' ? Math.min(100, Math.round((analysis.timedSeconds / 86400) * 100)) : null;
  const reflection = leading
    ? `${leading.label} accounted for the largest share of tracked time at ${formatDuration(leading.seconds)}.${analysis.activeCount ? ` ${analysis.activeCount} session ${analysis.activeCount === 1 ? 'is' : 'are'} still in progress.` : ''}`
    : analysis.momentGroups.length
      ? `${analysis.momentGroups.length} ${analysis.momentGroups.length === 1 ? 'moment was' : 'moments were'} recorded, but there is no completed timed activity for this period.`
      : 'No activity has been recorded for this period yet.';
  return (
    <div className="cycle-glance-copy">
      <p className="cycle-eyebrow">At a glance</p>
      <h2>{title}</h2>
      <p className="cycle-reflection">{reflection}</p>
      <dl className="cycle-glance-metrics">
        <div><dt>Tracked</dt><dd>{formatDuration(analysis.timedSeconds)}</dd></div>
        {coverage !== null && <div><dt>Day covered</dt><dd>{coverage}%</dd></div>}
        <div><dt>Largest</dt><dd>{leading?.label || 'None yet'}</dd></div>
        <div><dt>Moments</dt><dd>{analysis.momentGroups.length}</dd></div>
      </dl>
      {facts.length > 0 && (
        <ul className="cycle-facts" aria-label="Worth noting">
          {facts.map((fact) => <li key={fact.id}><ActivityIcon label={fact.label} size={15} /><div><strong>{fact.text}</strong><span>{fact.detail}</span></div></li>)}
        </ul>
      )}
      {analysis.incompleteCount > 0 && <p className="cycle-caution">{analysis.incompleteCount} historical session {analysis.incompleteCount === 1 ? 'is' : 'are'} missing a finish and excluded from tracked time.</p>}
    </div>
  );
}

function SelectedGlance({ analysis, onClear, target = null, targets = {}, onSaveTarget }) {
  return (
    <div className="cycle-glance-copy selected">
      <p className="cycle-eyebrow">Focused view</p>
      <h2><ActivityIcon label={analysis.label} size={34} /> {analysis.label}</h2>
      <p className="cycle-reflection">{buildCategoryInsight(analysis)}</p>
      <dl className="cycle-glance-metrics">
        <div><dt>Total time</dt><dd>{formatDuration(analysis.totalSeconds)}</dd></div>
        <div><dt>{analysis.label === 'Gym/Fitness' ? 'Visits' : 'Sessions'}</dt><dd>{analysis.sessionCount}</dd></div>
        <div><dt>Active days</dt><dd>{analysis.activeDays}</dd></div>
        <div><dt>Average</dt><dd>{formatDuration(analysis.averageSessionSeconds)}</dd></div>
        {target && <div className={`cycle-target-metric ${target.met ? 'met' : 'missed'}`}><dt>Target</dt><dd>{target.text}</dd></div>}
      </dl>
      {TARGET_DEFINITIONS[analysis.label] && onSaveTarget && <TargetEditor label={analysis.label} amount={targetAmount(targets, analysis.label)} onSave={onSaveTarget} />}
      <button className="cycle-clear-selection" type="button" onClick={onClear}>Show all activities</button>
    </div>
  );
}

// Sets or clears one category's target. Time targets are entered as hours and minutes, visit
// targets as a count per week; the kind is fixed per category (see activityTargets.js).
export function TargetEditor({ label, amount, onSave }) {
  const definition = TARGET_DEFINITIONS[label];
  const timed = definition.kind !== 'sessionsPerWeek';
  const [hours, setHours] = useState(timed && amount ? Math.floor(amount / 3600) : 7);
  const [minutes, setMinutes] = useState(timed && amount ? Math.round((amount % 3600) / 60) : 0);
  const [count, setCount] = useState(!timed && amount ? amount : 3);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (timed && amount) {
      setHours(Math.floor(amount / 3600));
      setMinutes(Math.round((amount % 3600) / 60));
    }
    if (!timed && amount) setCount(amount);
  }, [amount, timed]);
  async function submit(event) {
    event.preventDefault();
    const next = timed ? Number(hours) * 3600 + Number(minutes) * 60 : Number(count);
    if (!(next > 0)) return;
    setSaving(true);
    try { await onSave(label, next); } finally { setSaving(false); }
  }
  async function clear() {
    setSaving(true);
    try { await onSave(label, null); } finally { setSaving(false); }
  }
  return (
    <details className="cycle-target-editor">
      <summary>{amount ? `Target: ${describeTarget(label, amount)}` : 'Set a target'}</summary>
      <form onSubmit={submit}>
        <span>{definition.kind === 'minSeconds' ? 'At least' : definition.kind === 'maxSeconds' ? 'At most' : 'At least'}</span>
        {timed ? (
          <>
            <label><input type="number" min="0" max="24" value={hours} onChange={(event) => setHours(event.target.value)} aria-label="Hours" /> h</label>
            <label><input type="number" min="0" max="59" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="Minutes" /> m</label>
            <span>{definition.noun}</span>
          </>
        ) : (
          <label><input type="number" min="1" max="50" value={count} onChange={(event) => setCount(event.target.value)} aria-label="Visits per week" /> {definition.verb} {definition.noun}</label>
        )}
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : amount ? 'Update' : 'Save target'}</button>
        {amount && <button type="button" className="cycle-text-button" disabled={saving} onClick={clear}>Remove</button>}
      </form>
    </details>
  );
}

function PointGlance({ analysis, onClear }) {
  return (
    <div className="cycle-glance-copy selected">
      <p className="cycle-eyebrow">Focused moments</p>
      <h2><ActivityIcon label={analysis.label} size={34} /> {analysis.label}</h2>
      <p className="cycle-reflection">
        {analysis.count} {analysis.count === 1 ? 'activity was' : 'activities were'} recorded in this period.
        {!analysis.reliableDuration && ' These are real occurrences, but their source did not supply a reliable duration.'}
      </p>
      <dl className="cycle-glance-metrics">
        <div><dt>Occurrences</dt><dd>{analysis.count}</dd></div>
        <div><dt>Listening time</dt><dd>{analysis.reliableDuration ? formatDuration(analysis.totalSeconds) : 'Not supplied'}</dd></div>
      </dl>
      <button className="cycle-clear-selection" type="button" onClick={onClear}>Show all activities</button>
    </div>
  );
}

function ActivityStream({ analysis, bounds, now, onInspectDate, onSelect, onEdit, onDelete }) {
  const [showAll, setShowAll] = useState(false);
  const timeline = useMemo(
    () => buildChronologicalActivityTimeline(analysis, bounds.timezone),
    [analysis, bounds.timezone]
  );
  const dayChart = useMemo(
    () => buildDayActivityChart(analysis, bounds, now),
    [analysis, bounds, now]
  );
  useEffect(() => setShowAll(false), [bounds.period, bounds.startDateId]);

  const today = getLocalDateId();
  const eyebrow = bounds.period !== 'day'
    ? 'Period activity'
    : bounds.startDateId === today
      ? 'Today’s activity'
      : bounds.startDateId === shiftPeriodDate(today, 'day', -1)
        ? 'Yesterday’s activity'
        : 'Selected day activity';
  const groupLimit = bounds.period === 'week' ? 7 : 12;
  const visibleGroups = showAll || bounds.period === 'day'
    ? timeline.groups
    : timeline.groups.slice(0, groupLimit).map((group) => ({ ...group, entries: group.entries.slice(0, 5) }));
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.entries.length, 0);
  if (!timeline.entries.length) return null;
  return (
    <section className="cycle-activity-stream">
      <header>
        <div><p className="cycle-eyebrow">{eyebrow}</p><h2>What happened</h2></div>
        <span>{timeline.entries.length} {timeline.entries.length === 1 ? 'activity' : 'activities'} · earliest first</span>
      </header>

      {dayChart && <DayActivityOverview chart={dayChart} onSelect={onSelect} />}

      <div className="cycle-linear-history">
        {visibleGroups.map((group) => bounds.period === 'day' ? (
          <TimelineEntryList entries={group.entries} key={group.dateId} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
        ) : (
          <details className="cycle-activity-day" key={group.dateId} open={bounds.period === 'week'}>
            <summary>
              <div><strong>{timelineDateLabel(group.dateId)}</strong><span>{group.entries.length} shown</span></div>
              <span>Open day</span>
            </summary>
            <button className="cycle-inspect-day" type="button" onClick={() => onInspectDate(group.dateId)}>View this day’s timeline</button>
            <TimelineEntryList entries={group.entries} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
          </details>
        ))}
      </div>

      {bounds.period !== 'day' && visibleCount < timeline.entries.length && (
        <button className="cycle-show-more" type="button" onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'Show concise view' : `Show all ${timeline.entries.length} activities`}
        </button>
      )}
      <p className="cycle-stream-note">Times run from morning to night in {bounds.timezone.replace('_', ' ')}. Point activities appear as moments and never add invented duration to the time wheel.</p>
    </section>
  );
}

function timelineDateLabel(dateId) {
  const day = getPeriodBounds('day', dateId);
  return day ? dateFormatter.format(day.start) : 'Date unavailable';
}

export function TimelineEntryList({ entries, onSelect, onEdit, onDelete }) {
  const allDay = entries.filter((entry) => entry.allDay);
  const timed = entries.filter((entry) => !entry.allDay && entry.timeRecorded);
  const untimed = entries.filter((entry) => !entry.allDay && !entry.timeRecorded);
  return (
    <ol className="cycle-linear-timeline">
      {allDay.map((entry) => <TimelineEntry entry={entry} key={entry.id} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />)}
      {timed.map((entry) => <TimelineEntry entry={entry} key={entry.id} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />)}
      {untimed.length > 0 && <li className="cycle-time-unrecorded"><span>Time not recorded</span></li>}
      {untimed.map((entry) => <TimelineEntry entry={entry} key={entry.id} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />)}
    </ol>
  );
}

function TimelineEntry({ entry, onSelect, onEdit, onDelete }) {
  const details = entry.details || getMeaningfulEventDetails(entry.event);
  const secondary = entry.type === 'session'
    ? [entry.location, entry.nested && entry.parentTitle ? `Inside ${entry.parentTitle}` : ''].filter(Boolean).join(' · ')
    : [details.artist, details.album, details.playlist, details.location, details.note]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(' · ');
  const selection = entry.pointCategory || entry.category;
  const title = details.track || entry.title;
  const canonicalEvent = entry.type === 'session' ? (entry.startEvent || entry.session?.event) : entry.event;
  const linkedEvent = entry.type === 'session' ? entry.endEvent : null;
  // A main-calendar day is changed in the main calendar, so it has no Edit or Delete here.
  const managed = canonicalEvent?.id && !entry.allDay ? {
    eventId: canonicalEvent.id,
    linkedEventId: linkedEvent?.id || '',
    event: { ...canonicalEvent, startAt: canonicalEvent.startAt || entry.at, endAt: canonicalEvent.endAt || entry.endAt },
    label: title,
    dateLabel: entry.at ? dateFormatter.format(entry.at) : 'date unavailable'
  } : null;
  return (
    <li className={`${entry.type} ${entry.nested ? 'nested' : ''}`} style={{ '--timeline-color': entry.color }}>
      <span className="cycle-timeline-marker" aria-hidden="true"><ActivityIcon label={entry.pointCategory || entry.category} size={15} /></span>
      <time dateTime={(entry.displayStartAt || entry.at)?.toISOString()}>{entry.at ? clockFormatter.format(entry.displayStartAt || entry.at) : entry.allDay ? 'All day' : 'No time'}</time>
      <article>
        <button type="button" onClick={() => onSelect(selection)} aria-label={`Open ${selection} activity: ${title}`}>
          <div>
            <strong>{title}</strong>
            {secondary && <p>{secondary}</p>}
            {entry.type === 'session' && <small>{timelineSessionRange(entry)}</small>}
            {entry.type === 'moment' && (entry.allDay
              ? <small>Main calendar</small>
              : <small>{entry.sourceApp || 'Moment'}{entry.sentAt && ` · Source sent ${clockFormatter.format(entry.sentAt)}`}</small>)}
          </div>
          {entry.type === 'session' ? (
            <b className={entry.active ? 'active' : entry.incomplete ? 'incomplete' : ''}>
              {entry.active ? 'In progress' : entry.incomplete ? entry.status : formatDuration(entry.durationSeconds)}
            </b>
          ) : entry.count > 1 ? <b>×{entry.count}</b> : <span aria-hidden="true">›</span>}
        </button>
        {managed && <div className="cycle-entry-actions"><button type="button" onClick={() => onEdit(managed)}>Edit</button><button type="button" className="danger" onClick={() => onDelete(managed)}>Delete</button></div>}
        {entry.type === 'session' && (
          <div className="cycle-timeline-boundaries">
            {entry.startedBeforeVisibleRange && !entry.wholeNight && <span><b>Continued into this period</b> The chart begins at the selected period boundary; the actual arrival is shown below.</span>}
            {entry.startEvent && <span><b>{getEventDisplayTitle(entry.startEvent)}</b> {timelineBoundaryLabel(entry.boundaryStartAt, entry.dateId)}{entry.startSentAt && <small> · sent {clockFormatter.format(entry.startSentAt)}</small>}</span>}
            {entry.endEvent && <span><b>{getEventDisplayTitle(entry.endEvent)}</b> {timelineBoundaryLabel(entry.boundaryEndAt, entry.dateId)}{entry.endSentAt && <small> · sent {clockFormatter.format(entry.endSentAt)}</small>}</span>}
            {entry.active && <span><b>Status</b> In progress</span>}
            {entry.statusDetail && <span className="incomplete"><b>Status</b> {entry.statusDetail}</span>}
          </div>
        )}
      </article>
    </li>
  );
}

function timelineBoundaryLabel(value, visibleDateId) {
  if (!value) return 'Time not recorded';
  const time = clockFormatter.format(value);
  return getDateIdInTimezone(value) === visibleDateId
    ? time
    : `${shortDateFormatter.format(value)} at ${time}`;
}

function timelineSessionRange(entry) {
  // A night is the wake-up day's own, from bedtime, so it never "continues" from the day before.
  const visibleStart = entry.startedBeforeVisibleRange
    ? entry.wholeNight
      ? timelineBoundaryLabel(entry.boundaryStartAt, entry.dateId)
      : `Continued from ${timelineBoundaryLabel(entry.boundaryStartAt, entry.dateId)}`
    : clockFormatter.format(entry.at);
  const visibleDuration = `${formatDuration(entry.durationSeconds)}${entry.startedBeforeVisibleRange && !entry.wholeNight ? ' shown in this period' : ''}`;
  if (entry.active) return `${visibleStart} – In progress · ${visibleDuration}`;
  if (entry.endAt) return `${visibleStart} – ${timelineBoundaryLabel(entry.boundaryEndAt || entry.endAt, entry.dateId)} · ${visibleDuration}`;
  if (entry.session?.missingBoundary === 'start') return `Finish recorded at ${clockFormatter.format(entry.at)} · Arrival not recorded`;
  return `${visibleStart} · Departure not recorded`;
}

function DayActivityOverview({ chart, onSelect }) {
  if (!chart.rows.length && !chart.moments.length) return null;
  return (
    <section className="cycle-day-overview" aria-label="24-hour activity timeline">
      <header>
        <div><p className="cycle-eyebrow">Your day in time</p><h3>24-hour timeline</h3></div>
        <span>{formatDuration(chart.trackedSeconds)} reliably tracked</span>
      </header>
      <div className="cycle-day-axis" aria-hidden="true">
        {chart.ticks.map((tick, index) => (
          <span
            className={index === 0 ? 'first' : index === chart.ticks.length - 1 ? 'last' : ''}
            key={tick.hour}
            style={{ left: `${tick.offset}%` }}
          >{tick.label}</span>
        ))}
      </div>
      <div className="cycle-day-rows">
        {chart.rows.map((row) => (
          <article className={row.nested ? 'nested' : ''} key={row.id}>
            <div><strong>{row.nested ? `↳ ${row.title}` : row.title}</strong><span>{row.active ? 'In progress' : row.incomplete ? row.status : formatDuration(row.durationSeconds)}</span></div>
            <div className="cycle-day-track">
              <DayTrackGuides chart={chart} />
              {chart.currentOffset !== null && <i className="current-time" style={{ left: `${chart.currentOffset}%` }} />}
              {row.hasReliableInterval ? (
                <button
                  className={`cycle-day-bar ${row.active ? 'active' : ''}`}
                  style={{ left: `${row.offset}%`, width: `${Math.max(row.width, 0.7)}%`, '--timeline-color': row.color }}
                  type="button"
                  title={timelineSessionRange(row)}
                  aria-label={`${row.title}: ${timelineSessionRange(row)}`}
                  onClick={() => onSelect(row.category)}
                />
              ) : row.offset !== null ? (
                <button
                  className="cycle-day-incomplete"
                  style={{ left: `${row.offset}%`, '--timeline-color': row.color }}
                  type="button"
                  title={`${row.title}: ${row.statusDetail || 'Incomplete session'}`}
                  aria-label={`${row.title}: ${row.statusDetail || 'Incomplete session'}`}
                  onClick={() => onSelect(row.category)}
                >!</button>
              ) : null}
            </div>
          </article>
        ))}
        {chart.moments.length > 0 && (
          <article className="moments">
            <div><strong>Moments</strong><span>{chart.moments.length} recorded</span></div>
            <div className="cycle-day-track">
              <DayTrackGuides chart={chart} />
              {chart.currentOffset !== null && <i className="current-time" style={{ left: `${chart.currentOffset}%` }} />}
              {chart.moments.map((moment) => (
                <button
                  className="cycle-day-moment"
                  key={moment.id}
                  style={{ left: `${moment.offset}%`, '--timeline-color': moment.color }}
                  type="button"
                  title={`${clockFormatter.format(moment.at)} · ${moment.title}`}
                  aria-label={`${moment.title} at ${clockFormatter.format(moment.at)}`}
                  onClick={() => onSelect(moment.pointCategory)}
                ><span aria-hidden="true"><ActivityIcon label={moment.pointCategory} size={11} /></span></button>
              ))}
            </div>
          </article>
        )}
      </div>
      <p className="cycle-chart-legend"><span><i className="session" /> Timed session</span><span><i className="moment" /> Point activity</span><span><i className="current" /> Current Toronto time</span>{chart.dayStartOffset > 0 && <span><i className="before-day" /> Evening before</span>}</p>
    </section>
  );
}

// Hour lines, and the evening before shaded up to midnight when last night is drawn from bedtime.
function DayTrackGuides({ chart }) {
  return (
    <>
      {chart.dayStartOffset > 0 && <i className="cycle-day-before" style={{ width: `${chart.dayStartOffset}%` }} />}
      {chart.ticks.slice(1, -1).map((tick) => (
        <i className={`cycle-day-gridline ${tick.dayStart ? 'midnight' : ''}`} key={tick.hour} style={{ left: `${tick.offset}%` }} />
      ))}
    </>
  );
}

function JournalAnalysis({ bounds, calendarId, events, journalState, period }) {
  const entries = useMemo(() => buildJournalEntries(events, journalState.media, bounds.timezone), [bounds.timezone, events, journalState.media]);
  const metrics = useMemo(() => buildJournalMetrics(entries, bounds.timezone), [bounds.timezone, entries]);
  const photoGroups = useMemo(() => groupPhotosByDate(journalState.media, bounds.timezone)
    .filter((group) => group.dateId >= bounds.startDateId && group.dateId <= bounds.endDateId), [bounds, journalState.media]);
  const photos = photoGroups.flatMap((group) => group.photos);
  const groupedEntries = entries.reduce((groups, entry) => {
    const dateId = entry.dateId || bounds.startDateId;
    const group = groups.get(dateId) || [];
    group.push(entry);
    groups.set(dateId, group);
    return groups;
  }, new Map());

  return (
    <section className="cycle-focus-panel cycle-journal-focus">
      <header>
        <div><p className="cycle-eyebrow">Journal reflection</p><h2>{metrics.entryCount} {metrics.entryCount === 1 ? 'entry' : 'entries'} in this {period}</h2></div>
        <p>Notes remain private to their authorized TimeLeft owner and source scope.</p>
      </header>
      <div className="cycle-focus-metrics cycle-journal-metrics">
        <Metric label="Entries" value={metrics.entryCount} />
        <Metric label="With photos" value={metrics.entriesWithPhotos} />
        <Metric label="Photos" value={photos.length} />
        {period !== 'day' && <Metric label="Journal days" value={metrics.activeDays} />}
        {metrics.firstAt && <Metric label="First entry" value={clockFormatter.format(metrics.firstAt)} />}
        {metrics.lastAt && <Metric label="Last entry" value={clockFormatter.format(metrics.lastAt)} />}
      </div>
      {period !== 'day' && photoGroups.length > 0 && (
        <section className="cycle-period-photo-groups">
          <header><div><p className="cycle-eyebrow">Photos in this period</p><h3>{photos.length} {photos.length === 1 ? 'photo' : 'photos'} across {photoGroups.length} {photoGroups.length === 1 ? 'day' : 'days'}</h3></div></header>
          {photoGroups.map((group) => (
            <details key={group.dateId}>
              <summary><strong>{dateFormatter.format(getPeriodBounds('day', group.dateId).start)}</strong><span>{group.photos.length} {group.photos.length === 1 ? 'photo' : 'photos'} · View photos</span></summary>
              <PhotoCollection calendarId={calendarId} compact photos={group.photos.slice(0, 12)} title={`Photos from ${group.dateId}`} />
              {group.photos.length > 12 && <p className="cycle-data-note">Showing 12 photos. Choose this day to view the complete gallery.</p>}
            </details>
          ))}
        </section>
      )}
      {journalState.loading ? <LoadingState label="Opening your journal…" /> : journalState.error ? (
        <p className="activity-state" role="alert">Journal details are protected and could not be loaded. {journalState.error}</p>
      ) : entries.length === 0 ? (
        <p className="activity-state">No complete journal notes were recorded for this period.</p>
      ) : (
        <div className="cycle-journal-days">
          {[...groupedEntries.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([dateId, dayEntries]) => (
            <section key={dateId}>
              {period !== 'day' && <h3>{dateFormatter.format(getPeriodBounds('day', dateId).start)}</h3>}
              <div className="cycle-journal-list">
                {dayEntries.map((entry) => <JournalCard calendarId={calendarId} entry={entry} key={entry.id} />)}
              </div>
            </section>
          ))}
        </div>
      )}
      {journalState.partial && <p className="cycle-data-note">This long period contains more journal records than the bounded detail view loads at once. Choose a shorter period to inspect every entry.</p>}
    </section>
  );
}

function JournalCard({ calendarId, entry }) {
  const preview = entry.note.length > 260 ? `${entry.note.slice(0, 257).trimEnd()}…` : entry.note;
  return (
    <details className="cycle-journal-card">
      <summary>
        <div className="cycle-journal-icon" aria-hidden="true"><ActivityIcon label="Journal" size={20} /></div>
        <div>
          <h3>{entry.title}</h3>
          <p className="cycle-journal-time">
            {entry.occurredAt ? clockFormatter.format(entry.occurredAt) : 'Time not recorded'}
            {entry.location ? ` · ${entry.location}` : ''}
          </p>
          {preview ? <p className="cycle-journal-preview">{preview}</p> : <p className="cycle-journal-missing">Note text was not supplied.</p>}
          <small>
            {entry.media.length ? `${entry.media.length} ${entry.media.length === 1 ? 'photo' : 'photos'} · ` : ''}
            {entry.sourceSentAt ? `Source sent ${clockFormatter.format(entry.sourceSentAt)}` : 'Source-sent time not supplied'}
          </small>
        </div>
        <span>Open</span>
      </summary>
      <div className="cycle-journal-detail">
        <dl>
          <div><dt>Entry time</dt><dd>{entry.occurredAt ? `${shortDateFormatter.format(entry.occurredAt)} · ${clockFormatter.format(entry.occurredAt)}` : `${entry.dateId || 'Date unavailable'} · Time not recorded`}</dd></div>
          <div><dt>Source sent</dt><dd>{entry.sourceSentAt ? `${shortDateFormatter.format(entry.sourceSentAt)} · ${clockFormatter.format(entry.sourceSentAt)}` : 'Not supplied'}</dd></div>
          <div><dt>Received by Time Left</dt><dd>{entry.receivedAt ? `${shortDateFormatter.format(entry.receivedAt)} · ${clockFormatter.format(entry.receivedAt)}` : 'Not supplied'}</dd></div>
          <div><dt>Location</dt><dd>{entry.location || 'Not supplied'}</dd></div>
        </dl>
        <div className="cycle-journal-body">{entry.note ? entry.note.split(/\r?\n/).map((paragraph, index) => <p key={`${entry.id}-paragraph-${index}`}>{paragraph || '\u00a0'}</p>) : <p>Note text was not supplied.</p>}</div>
        {entry.media.length > 0 && <PhotoCollection calendarId={calendarId} compact photos={entry.media} title={`Photos attached to ${entry.title}`} />}
        <details className="cycle-inline-technical">
          <summary>Troubleshooting details</summary>
          <p>Canonical Life event {entry.lifeEventId}. Source application {entry.sourceApp || 'not supplied'}. Authorized scope {entry.projectId || 'not supplied'}.</p>
        </details>
      </div>
    </details>
  );
}

function PhotoGallery({ calendarId, dateId, error, loading, media }) {
  const photos = useMemo(() => groupPhotosByDate(media).find((group) => group.dateId === dateId)?.photos || [], [dateId, media]);
  if (loading) return <section className="cycle-photo-gallery"><LoadingState label="Finding photos from this day…" /></section>;
  if (error) return <section className="cycle-photo-gallery"><header><div><p className="cycle-eyebrow">Photos from this day</p><h2>Gallery unavailable</h2></div></header><p className="activity-state">Photos remain protected because the authorized resolver could not be reached.</p></section>;
  if (!photos.length) return <section className="cycle-photo-gallery cycle-photo-empty"><header><div><p className="cycle-eyebrow">Photos from this day</p><h2>No photos recorded</h2></div></header><p>No authorized image was attached to this day.</p></section>;
  return (
    <section className="cycle-photo-gallery">
      <header><div><p className="cycle-eyebrow">Photos from this day</p><h2>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</h2></div><span>Private gallery</span></header>
      <PhotoCollection calendarId={calendarId} photos={photos} title="Photos from this day" />
    </section>
  );
}

function useAuthorizedPhoto(calendarId, media, enabled = true) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', url: '', message: '' });
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', url: '', message: '' });
      return undefined;
    }
    const controller = new AbortController();
    let objectUrl = '';
    setState({ status: 'loading', url: '', message: '' });
    loadAuthorizedActivityImage(calendarId, media, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl, message: '' });
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        const message = error.status === 403
          ? 'Permission denied'
          : error.status === 404
            ? 'Photo unavailable'
            : 'Could not load photo';
        setState({ status: 'error', url: '', message });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [calendarId, enabled, media]);
  return state;
}

function PhotoCollection({ calendarId, compact = false, photos, title }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const selected = selectedIndex === null ? null : photos[selectedIndex];
  useEffect(() => {
    if (!selected) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedIndex(null);
      if (event.key === 'ArrowLeft') setSelectedIndex((current) => (current + photos.length - 1) % photos.length);
      if (event.key === 'ArrowRight') setSelectedIndex((current) => (current + 1) % photos.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photos.length, selected]);
  return (
    <div className={`cycle-photo-collection ${compact ? 'compact' : ''}`}>
      <div className="cycle-photo-grid" aria-label={title}>
        {photos.map((photo, index) => <PhotoThumbnail calendarId={calendarId} key={photo.id} media={photo} onOpen={() => setSelectedIndex(index)} />)}
      </div>
      {selected && <PhotoLightbox calendarId={calendarId} index={selectedIndex} media={selected} onClose={() => setSelectedIndex(null)} onMove={(amount) => setSelectedIndex((selectedIndex + amount + photos.length) % photos.length)} total={photos.length} />}
    </div>
  );
}

function PhotoThumbnail({ calendarId, media, onOpen }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const photo = useAuthorizedPhoto(calendarId, media, visible);
  return (
    <article className="cycle-photo-thumb" ref={containerRef}>
      {photo.status === 'ready' ? (
        <button type="button" onClick={onOpen} aria-label={`Open ${media.caption || media.title || 'photo'}`}>
          <img alt={media.caption || media.title || 'Journal photo'} loading="lazy" src={photo.url} />
        </button>
      ) : <div className={`cycle-photo-placeholder ${photo.status}`} role={photo.status === 'error' ? 'alert' : 'status'}>{photo.status === 'error' ? photo.message : 'Loading photo…'}</div>}
      <div><strong>{media.caption || media.title || 'Photo'}</strong><small>{media.createdAt ? `${shortDateFormatter.format(new Date(media.createdAt))} · ${clockFormatter.format(new Date(media.createdAt))}` : 'Time not recorded'}{media.location ? ` · ${media.location}` : ''}</small></div>
    </article>
  );
}

function PhotoLightbox({ calendarId, index, media, onClose, onMove, total }) {
  const photo = useAuthorizedPhoto(calendarId, media, true);
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="cycle-photo-lightbox" role="dialog" aria-modal="true" aria-label="Photo preview">
      <button className="cycle-lightbox-close" ref={closeRef} type="button" onClick={onClose} aria-label="Close photo preview">×</button>
      {total > 1 && <button className="cycle-lightbox-previous" type="button" onClick={() => onMove(-1)} aria-label="Previous photo">‹</button>}
      <div className="cycle-lightbox-content">
        {photo.status === 'ready' ? <img alt={media.caption || media.title || 'Journal photo'} src={photo.url} /> : <div className="cycle-photo-placeholder">{photo.status === 'error' ? photo.message : 'Loading full-size photo…'}</div>}
        <div><strong>{media.caption || media.title || 'Photo'}</strong><p>{media.associationTitle ? `Attached to ${media.associationTitle}` : 'Standalone photo'}</p><small>{media.createdAt ? `${shortDateFormatter.format(new Date(media.createdAt))} · ${clockFormatter.format(new Date(media.createdAt))}` : 'Time not recorded'}{media.location ? ` · ${media.location}` : ''} · {index + 1} of {total}</small></div>
      </div>
      {total > 1 && <button className="cycle-lightbox-next" type="button" onClick={() => onMove(1)} aria-label="Next photo">›</button>}
    </div>
  );
}

function inputDateTime(value) {
  const date = value instanceof Date ? value : (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Returns the `location` value to send, or undefined when the field must be
// left out. The callable client encodes undefined as null, and null means
// "clear the location", so an unchanged location must be omitted from the
// payload rather than passed as undefined.
export function buildLocationPatch(location, label) {
  const previous = location?.label || '';
  const next = (label || '').trim();
  if (next === previous) return undefined;
  if (next) return { ...(location || {}), label: next };
  const { label: removedLabel, ...rest } = location || {};
  return Object.keys(rest).length ? rest : null;
}

// A paired session is an arrival and a departure event; both must be deleted
// together. The key is omitted (not undefined) for unpaired entries for the
// same encoding reason as above.
// An arrival or departure the phone recorded: deleting one leaves its session open-ended, and the
// source cannot re-create it (the delete writes a tombstone), so the dialog says so.
export function isBoundaryEvent(event) {
  return /^(?:arrive|leave|start|finish|stop)_/.test(String(event?.eventType || ''));
}

export function buildDeleteRequest(calendarId, entry) {
  return {
    calendarId,
    eventId: entry.eventId,
    ...(entry.linkedEventId ? { linkedEventId: entry.linkedEventId } : {})
  };
}

export function ActivityEntryDialog({ entry, onCancel, onDelete, onSave }) {
  const event = entry.event || {};
  const start = getEventTime(event);
  const end = getEventEndTime(event);
  const [form, setForm] = useState(() => ({
    activityFamily: event.activityFamily || getActivityLabel(event) || 'Other',
    categoryId: event.categoryId || '',
    eventType: event.eventType || '',
    title: event.title || entry.label || '',
    startAt: inputDateTime(event.startAt || start),
    endAt: inputDateTime(event.endAt || end),
    durationSeconds: event.durationSeconds ?? '',
    location: event.location?.label || '',
    description: event.description || event.metadata?.notes || event.metadata?.note || '',
    workoutDetails: event.metadata?.workoutDetails ? JSON.stringify(event.metadata.workoutDetails, null, 2) : ''
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(Boolean(entry.confirmDelete));

  async function submit(eventObject) {
    eventObject.preventDefault();
    setError('');
    const startDate = form.startAt ? new Date(form.startAt) : null;
    const endDate = form.endAt ? new Date(form.endAt) : null;
    if (startDate && endDate && endDate < startDate) {
      setError('End time cannot be earlier than start time.');
      return;
    }
    let workoutDetails;
    if (form.workoutDetails.trim()) {
      try { workoutDetails = JSON.parse(form.workoutDetails); } catch { setError('Workout details must be valid JSON.'); return; }
    }
    setSaving(true);
    try {
      const locationPatch = buildLocationPatch(event.location, form.location);
      await onSave({
        eventId: entry.eventId,
        linkedEventId: entry.linkedEventId,
        linkedEndAt: entry.linkedEventId ? (endDate?.toISOString() || null) : undefined,
        activityFamily: form.activityFamily,
        categoryId: form.categoryId,
        eventType: form.eventType,
        title: form.title,
        occurredAt: startDate?.toISOString() || null,
        startAt: startDate?.toISOString() || null,
        endAt: endDate?.toISOString() || null,
        durationSeconds: form.durationSeconds,
        ...(locationPatch === undefined ? {} : { location: locationPatch }),
        description: form.description,
        metadata: { ...(workoutDetails === undefined ? {} : { workoutDetails }) }
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="activity-dialog-backdrop" role="presentation" onMouseDown={(eventObject) => { if (eventObject.target === eventObject.currentTarget) onCancel(); }}>
      <section className="activity-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-dialog-title">
        {confirming ? (
          <>
            <header className="activity-dialog-header"><h2 id="activity-dialog-title">Delete this activity?</h2><button className="activity-dialog-close" type="button" aria-label="Close activity dialog" onClick={onCancel}>×</button></header>
            <p>This will remove <strong>{entry.label}</strong> from your timeline and all activity totals.</p>
            {isBoundaryEvent(event) && (
              <p className="activity-dialog-note">
                {entry.linkedEventId
                  ? 'Both the arrival and the departure the phone recorded will go, and the phone will not send them again.'
                  : 'This is an arrival or departure the phone recorded. Without it the session has no start or end here, and the phone will not send it again.'}
                {' '}If the session only looks wrong, edit its times instead. A deleted activity can be brought back from Recently deleted, at the bottom of the page, for 90 days.
              </p>
            )}
            <p>{entry.dateLabel}</p>
            <div className="activity-dialog-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="danger" type="button" disabled={saving} onClick={async () => { setSaving(true); try { await onDelete(); } finally { setSaving(false); } }}>{saving ? 'Deleting…' : 'Delete activity'}</button></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <header className="activity-dialog-header"><h2 id="activity-dialog-title">Edit activity</h2><button className="activity-dialog-close" type="button" aria-label="Close activity dialog" onClick={onCancel}>×</button></header>
            <p className="activity-dialog-context">{entry.label} · {entry.dateLabel}</p>
            <div className="activity-form-grid">
              <label>Activity/category<input value={form.activityFamily} onChange={(e) => setForm({ ...form, activityFamily: e.target.value })} required /></label>
              <label>Category ID<input value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} /></label>
              <label>Title or label<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label>Event type<input value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })} required /></label>
              <label>Start date and time<input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></label>
              <label>End date and time <small>(leave blank if active)</small><input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></label>
              <label>Duration (seconds)<input type="number" min="0" value={form.durationSeconds} onChange={(e) => setForm({ ...form, durationSeconds: e.target.value })} /></label>
              <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label className="wide">Notes or description<textarea rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label className="wide">Workout details <small>(JSON, when applicable)</small><textarea rows="4" value={form.workoutDetails} onChange={(e) => setForm({ ...form, workoutDetails: e.target.value })} /></label>
            </div>
            {error && <p className="activity-form-error" role="alert">{error}</p>}
            <div className="activity-dialog-actions"><button type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className="danger outline" type="button" onClick={() => setConfirming(true)} disabled={saving}>Delete</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}

function FocusedPointAnalysis({ analysis, bounds, period }) {
  const entries = [...analysis.entries].sort((left, right) => (left.firstAt?.getTime() || 0) - (right.firstAt?.getTime() || 0));
  return (
    <section className="cycle-focus-panel cycle-point-focus">
      <header>
        <div><p className="cycle-eyebrow">{analysis.label} history</p><h2>{analysis.count} recorded {analysis.count === 1 ? 'moment' : 'moments'}</h2></div>
        <p>{period[0].toUpperCase() + period.slice(1)} view · {bounds.startDateId}{bounds.endDateId !== bounds.startDateId ? ` to ${bounds.endDateId}` : ''}</p>
      </header>
      <div className="cycle-focus-metrics">
        <Metric label="Occurrences" value={analysis.count} />
        <Metric label="Reliable duration" value={analysis.reliableDuration ? formatDuration(analysis.totalSeconds) : 'Not supplied'} />
      </div>
      {!analysis.reliableDuration && (
        <p className="cycle-data-note">
          {analysis.id === 'Spotify'
            ? 'No listening duration was supplied, so these events are visible here without changing the time wheel.'
            : 'No reliable duration was supplied, so these moments remain visible without changing the time wheel.'}
        </p>
      )}
      <ol className="cycle-point-history">
        {entries.map((entry) => <PointHistoryEntry entry={entry} key={entry.id} />)}
      </ol>
    </section>
  );
}

function PointHistoryEntry({ entry }) {
  const event = entry.event;
  const details = entry.details || getMeaningfulEventDetails(event);
  const sentAt = entry.sentAt || getEventSentTime(event);
  return (
    <li>
      <span aria-hidden="true"><ActivityIcon label={entry.pointCategory || entry.category} size={16} /></span>
      <time>{entry.firstAt ? `${shortDateFormatter.format(entry.firstAt)} · ${clockFormatter.format(entry.firstAt)}` : ''}</time>
      <div>
        <strong>{details.track || entry.title}</strong>
        {details.artist && <p>{details.artist}{details.album ? ` · ${details.album}` : ''}{details.playlist ? ` · ${details.playlist}` : ''}</p>}
        {!details.artist && (details.album || details.playlist) && <p>{[details.album, details.playlist].filter(Boolean).join(' · ')}</p>}
        {details.note && details.note !== entry.title && <p>{details.note}</p>}
        {details.location && <small>{details.location}</small>}
        <small>{event?.sourceApp || 'Recorded activity'}{sentAt ? ` · Source sent ${clockFormatter.format(sentAt)}` : ''}</small>
      </div>
      {entry.count > 1 && <b>×{entry.count}</b>}
    </li>
  );
}

function FocusedAnalysis({ analysis, bounds, period, periodAnalysis, previousAnalysis, recentHistory }) {
  const rows = buildTrendRows(period, periodAnalysis, bounds, analysis.label);
  const previousCategory = previousAnalysis.categories.find((category) => category.label === analysis.label);
  const historyRows = buildRecentHistoryRows(recentHistory, period, analysis.label);
  return (
    <section className="cycle-focus-panel">
      <header>
        <div><p className="cycle-eyebrow">{analysis.label} analysis</p><h2>{buildFocusTitle(analysis)}</h2></div>
        {analysis.hasPrevious && <p>{formatDelta(analysis.deltaSeconds)} vs previous {period}</p>}
      </header>
      <div className="cycle-focus-metrics">
        <Metric label="Total" value={formatDuration(analysis.totalSeconds)} />
        <Metric label={analysis.label === 'Work' ? 'Workdays' : analysis.label === 'Gym/Fitness' ? 'Visits' : 'Sessions'} value={analysis.label === 'Work' ? analysis.activeDays : analysis.sessionCount} />
        <Metric label="Average" value={formatDuration(analysis.averageSessionSeconds)} />
        <Metric label="Longest" value={formatDuration(analysis.longestSeconds)} />
        {analysis.recentPeriodCount >= 2 && <Metric label="Recent normal" value={formatDuration(analysis.recentAverageSeconds)} detail={`${analysis.recentPeriodCount} active periods`} />}
        {analysis.label === 'Gym/Fitness' && <Metric label="Workouts" value={analysis.workoutCount} detail={formatDuration(analysis.totalWorkoutSeconds)} />}
        {analysis.label === 'Gym/Fitness' && analysis.locations[0] && <Metric label="Gym location" value={analysis.locations[0].label} />}
        {analysis.label === 'Sleep' && <Metric label="vs 7h goal" value={formatSleepGoal(analysis.averageSessionSeconds)} />}
      </div>
      {analysis.label === 'Work' && <WorkAttendance attendance={analysis.attendance} />}
      <div className="cycle-analysis-grid">
        <LargeTrendChart rows={rows} color={analysis.color} baseline={previousCategory?.seconds || 0} normal={analysis.recentAverageSeconds} period={period} />
        <LocationBreakdown locations={analysis.locations} color={analysis.color} />
      </div>
      {historyRows.length >= 2 && <RecentHistoryChart rows={historyRows} color={analysis.color} period={period} />}
      {analysis.label === 'Gym/Fitness' && analysis.workouts.length > 0 && <WorkoutSummary workouts={analysis.workouts} />}
      {analysis.label !== 'Work' && <SessionHistory sessions={analysis.sessions} />}
    </section>
  );
}

function buildFocusTitle(analysis) {
  if (analysis.activeSession) return `${analysis.label} is in progress`;
  if (analysis.label === 'Work') return `${formatDuration(analysis.totalSeconds)} across ${analysis.activeDays} workdays`;
  if (analysis.label === 'Gym/Fitness') return `${analysis.sessionCount} gym ${analysis.sessionCount === 1 ? 'visit' : 'visits'}`;
  if (analysis.label === 'Sleep') return `${formatDuration(analysis.averageSessionSeconds)} average sleep`;
  return `${formatDuration(analysis.totalSeconds)} of ${analysis.label.toLowerCase()}`;
}

function LargeTrendChart({ rows, color, baseline, normal, period }) {
  if (!rows.length) return <p className="activity-state">No complete sessions are available for this chart.</p>;
  if (period === 'day') return <DayTimeline rows={rows} color={color} />;
  const maximum = Math.max(...rows.map((row) => row.seconds), 1);
  return (
    <section className="cycle-chart" style={{ '--chart-color': color }}>
      <header><div><p className="cycle-eyebrow">Trend</p><h3>Time by period</h3></div><div className="cycle-chart-context">{normal > 0 && <small>Recent normal {formatDuration(normal)}</small>}{baseline > 0 && <small>Previous total {formatDuration(baseline)}</small>}</div></header>
      <div className={`cycle-chart-bars ${period}`}>
        {rows.map((row, index) => (
          <div className={`cycle-chart-column ${row.hasData ? '' : 'missing'}`} key={`${row.label}-${index}`} title={`${row.label}: ${row.hasData ? formatDuration(row.seconds) : 'No tracking data'}`}>
            <div>{row.hasData && <i style={{ height: `${Math.max(4, (row.seconds / maximum) * 100)}%` }} />}</div>
            <strong>{row.hasData ? formatDuration(row.seconds) : 'No data'}</strong><span>{row.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DayTimeline({ rows, color }) {
  return (
    <section className="cycle-chart cycle-day-chart" style={{ '--chart-color': color }}>
      <header><div><p className="cycle-eyebrow">Timeline</p><h3>When it happened</h3></div></header>
      <div className="cycle-timeline-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span></div>
      <div className="cycle-timeline-rows">{rows.map((row, index) => <article key={`${row.label}-${index}`}><div><strong>{row.title}</strong><span>{row.range}</span></div><div className="cycle-timeline-track">{row.segments.map((segment, segmentIndex) => <i key={segmentIndex} style={{ left: `${segment.offset}%`, width: `${Math.max(segment.width, 0.8)}%` }} />)}</div><b>{formatDuration(row.seconds)}</b></article>)}</div>
    </section>
  );
}

function RecentHistoryChart({ rows, color, period }) {
  const maximum = Math.max(...rows.map((row) => row.seconds), 1);
  return (
    <section className="cycle-recent-history" style={{ '--chart-color': color }}>
      <header><div><p className="cycle-eyebrow">Recent rhythm</p><h3>{period === 'day' ? 'Recent active days' : `Recent active ${period}s`}</h3></div><small>Only periods with recorded {rows[0]?.category.toLowerCase()} time are compared.</small></header>
      <div>{rows.map((row) => <article key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(2, (row.seconds / maximum) * 100)}%` }} /></i><strong>{formatDuration(row.seconds)}</strong></article>)}</div>
    </section>
  );
}

function LocationBreakdown({ locations, color }) {
  if (!locations.length) return (
    <section className="cycle-location-panel"><p className="cycle-eyebrow">Locations</p><h3>No location names recorded</h3><p>Sessions remain included in time totals without inventing a place.</p></section>
  );
  const maximum = Math.max(...locations.map((location) => location.seconds), 1);
  return (
    <section className="cycle-location-panel" style={{ '--chart-color': color }}>
      <p className="cycle-eyebrow">Locations</p><h3>Time by place</h3>
      <ol>{locations.map((location) => <li key={location.label}><div><strong>{location.label}</strong><span>{location.visits} {location.visits === 1 ? 'visit' : 'visits'}</span></div><b>{formatDuration(location.seconds)}</b><i style={{ width: `${(location.seconds / maximum) * 100}%` }} /></li>)}</ol>
    </section>
  );
}

function WorkAttendance({ attendance }) {
  if (!attendance.length) return (
    <section className="cycle-attendance"><p className="cycle-eyebrow">Attendance</p><h3>No Work boundary records</h3><p>No arrival or departure was recorded for this period.</p></section>
  );
  return (
    <section className="cycle-attendance">
      <header><div><p className="cycle-eyebrow">Work attendance</p><h3>Arrivals and departures</h3></div><span>{attendance.length} {attendance.length === 1 ? 'workday' : 'workdays'}</span></header>
      <div className="cycle-attendance-list">
        {attendance.map((row) => (
          <details className={row.status === 'In progress' ? 'active' : ''} key={row.id}>
            <summary>
              <div><strong>{row.title}</strong><time>{row.arrivedAt || row.leftAt ? shortDateFormatter.format(row.arrivedAt || row.leftAt) : row.dateId}</time></div>
              <dl>
                <div><dt>Arrived</dt><dd>{row.arrivedAt ? clockFormatter.format(row.arrivedAt) : 'Arrival not recorded'}</dd></div>
                <div><dt>Left</dt><dd>{row.status === 'In progress' ? 'Still at work' : row.leftAt ? clockFormatter.format(row.leftAt) : 'Departure not recorded'}</dd></div>
                <div><dt>{row.status === 'In progress' ? 'Time at work' : 'Total'}</dt><dd>{row.totalSeconds !== null ? formatDuration(row.totalSeconds) : 'Incomplete'}</dd></div>
                <div><dt>Status</dt><dd>{row.status}</dd></div>
              </dl>
              {row.statusDetail && <p className="cycle-boundary-note">{row.statusDetail}</p>}
            </summary>
            <div className="cycle-attendance-detail">
              <h4>Actual boundary events</h4>
              <ul>
                <li><strong>{row.arrivalEvent ? getEventDisplayTitle(row.arrivalEvent) : 'Arrival not recorded'}</strong>{row.arrivedAt && <time>{clockFormatter.format(row.arrivedAt)}</time>}{row.arrivalSentAt && <small>Source sent {clockFormatter.format(row.arrivalSentAt)}</small>}</li>
                <li><strong>{row.departureEvent ? getEventDisplayTitle(row.departureEvent) : row.status === 'In progress' ? 'Departure pending' : 'Departure not recorded'}</strong>{row.leftAt && <time>{clockFormatter.format(row.leftAt)}</time>}{row.departureSentAt && <small>Source sent {clockFormatter.format(row.departureSentAt)}</small>}</li>
              </ul>
              {row.notes.length > 0 && <div><h4>Work notes</h4>{row.notes.map((note) => <p key={note}>{note}</p>)}</div>}
              <details className="cycle-inline-technical"><summary>Technical details</summary><p>Received by Time Left To Live: arrival {row.arrivalReceivedAt ? clockFormatter.format(row.arrivalReceivedAt) : 'not recorded'}; departure {row.departureReceivedAt ? clockFormatter.format(row.departureReceivedAt) : 'not recorded'}.</p></details>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function WorkoutSummary({ workouts }) {
  return (
    <section className="cycle-workouts">
      <header><div><p className="cycle-eyebrow">Workouts inside gym visits</p><h3>Completed workouts</h3></div><span>{workouts.length} {workouts.length === 1 ? 'workout' : 'workouts'}</span></header>
      <div className="cycle-workout-list">{workouts.map((workout) => (
        <details key={workout.id}>
          <summary>
            <span aria-hidden="true">🏋</span>
            <div>
              <strong>{workout.title}</strong>
              <p>{formatWorkoutRange(workout)}{workout.location ? ` · ${workout.location}` : ''}</p>
              <small>{workout.exerciseCount} {workout.exerciseCount === 1 ? 'exercise' : 'exercises'} · {workout.setCount} recorded {workout.setCount === 1 ? 'set' : 'sets'}</small>
            </div>
            <b>{workout.durationSeconds !== null ? formatDuration(workout.durationSeconds) : 'Duration not supplied'}</b>
          </summary>
          <div className="cycle-workout-detail">
            <dl>
              <div><dt>Started</dt><dd>{workout.startAt ? clockFormatter.format(workout.startAt) : 'Start not recorded'}</dd></div>
              <div><dt>Finished</dt><dd>{workout.endAt ? clockFormatter.format(workout.endAt) : 'Finish not recorded'}</dd></div>
              <div><dt>Duration</dt><dd>{workout.durationSeconds !== null ? formatDuration(workout.durationSeconds) : 'Not supplied'}</dd></div>
              <div><dt>Source sent</dt><dd>{workout.sourceSentAt ? clockFormatter.format(workout.sourceSentAt) : 'Not supplied'}</dd></div>
            </dl>
            {workout.notes && <p className="cycle-workout-note">{workout.notes}</p>}
            {workout.exercises.length ? (
              <div className="cycle-exercises">
                {workout.exercises.map((exercise) => (
                  <article key={exercise.id}>
                    <header><strong>{exercise.name}</strong>{(exercise.bestWeight || exercise.bestReps) && <small>Best recorded: {[exercise.bestWeight && `${exercise.bestWeight} weight`, exercise.bestReps && `${exercise.bestReps} reps`].filter(Boolean).join(' · ')}</small>}</header>
                    <div className="cycle-set-table" role="table" aria-label={`${exercise.name} sets`}>
                      <div className="cycle-set-head" role="row"><span>Set</span><span>Weight</span><span>Reps</span><span>RPE</span><span>Status</span></div>
                      {exercise.sets.map((set) => (
                        <div role="row" key={`${exercise.id}-set-${set.number}`}>
                          <strong>{set.number}</strong>
                          <span>{set.bodyweight === true ? 'Bodyweight' : set.weight !== null && set.weight !== '' ? set.weight : '—'}</span>
                          <span>{set.reps !== null && set.reps !== '' ? set.reps : '—'}</span>
                          <span>{set.rpe !== null && set.rpe !== '' ? set.rpe : '—'}</span>
                          <span>{set.skipped === true ? 'Skipped' : set.completed === true ? 'Completed' : set.personalRecord === true ? 'Personal record' : 'Recorded'}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="cycle-data-note">This workout has start and finish boundaries, but no exercise or set details were supplied in its canonical LifeEvent.</p>}
            <details className="cycle-inline-technical"><summary>Technical details</summary><p>Received by Time Left To Live {workout.receivedAt ? clockFormatter.format(workout.receivedAt) : 'time not recorded'}. Stable workout identity is preserved but hidden from the reflection view.</p></details>
          </div>
        </details>
      ))}</div>
    </section>
  );
}

function SessionHistory({ sessions }) {
  return (
    <section className="cycle-session-history">
      <p className="cycle-eyebrow">History</p><h3>Sessions in this period</h3>
      <ol>{[...sessions].sort((left, right) => right.startAt - left.startAt).map((session) => {
        const sentAt = getEventSentTime(session.event);
        const incompleteMessage = getIncompleteSessionMessage(session);
        return <li key={session.id}><time>{shortDateFormatter.format(session.startAt)}</time><div><strong>{session.title}</strong><p>{formatSessionRange(session)}{session.location ? ` · ${session.location}` : ''}</p>{incompleteMessage && <small className="cycle-boundary-note">{incompleteMessage}</small>}{sentAt && <small>Source sent {clockFormatter.format(sentAt)}</small>}</div><b>{session.active ? 'In progress' : Number.isFinite(session.durationSeconds) ? formatDuration(session.durationSeconds) : 'Incomplete'}</b></li>;
      })}</ol>
    </section>
  );
}

function DefaultReflection({ analysis, bounds }) {
  if (!analysis.momentGroups.length) return null;
  return (
    <section className="cycle-moments">
      <header><div><p className="cycle-eyebrow">Moments</p><h2>Notes and occurrences</h2></div><span>{analysis.momentGroups.length} grouped</span></header>
      <div>{analysis.momentGroups.slice(0, 8).map((group) => <details key={group.id}><summary><time>{group.firstAt ? clockFormatter.format(group.firstAt) : ''}</time><strong>{group.title}</strong>{group.count > 1 && <b>×{group.count}</b>}</summary>{group.count > 1 && <p>{group.count} similar {group.category.toLowerCase()} were grouped on {getDateIdInTimezone(group.firstAt, bounds.timezone)}.</p>}</details>)}</div>
    </section>
  );
}

function formatTallyDate(dateId, fallback) {
  if (dateId) return tallyDateFormatter.format(getPeriodBounds('day', dateId).start);
  return fallback ? tallyDateFormatter.format(fallback) : '—';
}

function tallyRangeDetail(range) {
  if (!range.start || !range.end) return 'Your complete authorized activity history';
  return `${tallyDateFormatter.format(range.start)} – ${tallyDateFormatter.format(new Date(range.end.getTime() - 1))}`;
}

export function TotalsView({ tallies, loading, range, rangeId, onRangeChange, onInspect }) {
  return (
    <section className="cycle-totals-view">
      <header>
        <div><p className="cycle-eyebrow">A longer view</p><h2>My Totals</h2><p>Valid time, active days, sessions, and zero-duration Moments are derived from your canonical activity history.</p></div>
        <div className="cycle-total-controls">
          <div className="cycle-total-context" aria-live="polite"><span>Summarizing</span><strong>{range.label}</strong><small>{tallyRangeDetail(range)}</small></div>
          <div className="cycle-total-ranges" aria-label="Totals range">{TALLY_RANGES.map((option) => <button aria-pressed={rangeId === option.id} className={rangeId === option.id ? 'selected' : ''} key={option.id} type="button" onClick={() => onRangeChange(option.id)}>{option.label}</button>)}</div>
        </div>
      </header>
      {loading ? <LoadingState label="Calculating your totals…" /> : tallies.length === 0 ? <p className="activity-state">No qualifying activities or Moments were recorded for {range.label.toLowerCase()}.</p> : (
        <div className="cycle-total-grid">
          {tallies.map((tally) => (
            <article key={tally.label} style={{ '--total-color': tally.color }}>
              <span aria-hidden="true"><ActivityIcon label={tally.detailLabel || tally.label} size={24} /></span>
              <div>
                <h3>{tally.label}</h3>
                <strong>{tally.timed ? (tally.totalSeconds > 0 ? formatDuration(tally.totalSeconds) : 'No valid time') : `${tally.entryCount} ${tally.entryCount === 1 ? 'entry' : 'entries'}`}</strong>
                {!tally.timed && <small>Recorded as Moments · no duration added</small>}
                {tally.activeCount > 0 && <small>{tally.activeCount} in progress</small>}
              </div>
              <dl>
                <div><dt>Active days</dt><dd>{tally.dayCount}</dd></div>
                {tally.timed && <div><dt>{tally.label === 'Gym/Fitness' ? 'Valid visits' : 'Valid sessions'}</dt><dd>{tally.sessionCount}</dd></div>}
                {tally.timed && tally.entryCount > 0 && <div><dt>Entries</dt><dd>{tally.entryCount}</dd></div>}
                {tally.totalSeconds > 0 && <div><dt>Avg. valid session</dt><dd>{formatDuration(tally.averageSeconds)}</dd></div>}
                <div><dt>First</dt><dd>{formatTallyDate(tally.firstDateId, tally.firstAt)}</dd></div>
                <div><dt>Latest</dt><dd>{formatTallyDate(tally.latestDateId, tally.lastAt)}</dd></div>
              </dl>
              {tally.incompleteCount > 0 && <p className="cycle-total-note">{tally.incompleteCount} incomplete {tally.incompleteCount === 1 ? 'session is' : 'sessions are'} listed without uncertain duration.</p>}
              {tally.latestDateId && <button className="cycle-total-detail" type="button" onClick={() => onInspect(tally)}>View latest details</button>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyWheel({ title, momentCount, incompleteCount }) {
  return <div className="cycle-empty-wheel"><div><p>{title}</p><strong>No timed activity</strong><span>{momentCount ? `${momentCount} grouped moments were recorded.` : 'No activity was recorded for this period.'}</span>{incompleteCount > 0 && <small>{incompleteCount} incomplete session needs a finish event before its duration can be counted.</small>}</div></div>;
}

function LoadingState({ label }) {
  return <p className="activity-state" role="status">{label}</p>;
}

function Metric({ label, value, detail }) {
  return <article><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

// A night of sleep is shown from its bedtime even when that was the evening
// before, because the whole night counts on the day it ends (sleepInterval).
function sessionShownStart(session) {
  return session.nightStartAt || session.startAt;
}

function formatSessionRange(session) {
  if (session.missingBoundary === 'start') return `Arrival not recorded – ${clockFormatter.format(session.startAt)}`;
  return `${clockFormatter.format(sessionShownStart(session))} – ${session.active ? 'In progress' : session.endAt ? clockFormatter.format(session.endAt) : 'Departure not recorded'}`;
}

function formatWorkoutRange(workout) {
  const start = workout.startAt ? clockFormatter.format(workout.startAt) : 'Start not recorded';
  const end = workout.endAt ? clockFormatter.format(workout.endAt) : 'Finish not recorded';
  return `${start} – ${end}`;
}

function formatDelta(seconds) {
  if (!seconds) return 'No change';
  return `${seconds > 0 ? '+' : '−'}${formatDuration(Math.abs(seconds))}`;
}

function formatSleepGoal(seconds) {
  if (!seconds) return 'No average';
  const difference = seconds - (7 * 3600);
  if (Math.abs(difference) < 60) return 'At goal';
  return `${formatDuration(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'}`;
}

function buildTrendRows(period, analysis, bounds, categoryLabel) {
  const sessions = analysis.allocatedSessions.filter((session) => session.category === categoryLabel);
  if (period === 'day') {
    const periodMs = bounds.end - bounds.start;
    return sessions.map((session) => ({
      label: clockFormatter.format(sessionShownStart(session)),
      title: session.title,
      range: formatSessionRange(session),
      seconds: session.allocatedSeconds,
      segments: session.fragments.map((fragment) => ({
        offset: ((fragment.start - bounds.start.getTime()) / periodMs) * 100,
        width: ((fragment.end - fragment.start) / periodMs) * 100
      }))
    }));
  }
  const count = period === 'week' ? 7 : period === 'month' ? Math.ceil(Number(bounds.endDateId.slice(-2)) / 7) : 12;
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const sliceDateId = period === 'year'
      ? `${bounds.startDateId.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`
      : shiftPeriodDate(bounds.startDateId, 'day', period === 'month' ? index * 7 : index);
    const baseSlice = getPeriodBounds(period === 'year' ? 'month' : 'day', sliceDateId);
    const slice = period === 'month'
      ? { start: baseSlice.start, end: new Date(Math.min(bounds.end.getTime(), getPeriodBounds('day', shiftPeriodDate(sliceDateId, 'day', 7)).start.getTime())) }
      : baseSlice;
    const seconds = sessions.reduce((sum, session) => {
      const overlap = Math.max(0, Math.min(session.endAt.getTime(), slice.end.getTime()) - Math.max(session.startAt.getTime(), slice.start.getTime()));
      return sum + (overlap / 1000);
    }, 0);
    const hasData = seconds > 0 || analysis.events.some((event) => {
      const at = getEventTime(event);
      return at && at >= slice.start && at < slice.end;
    });
    const label = period === 'year'
      ? monthFormatter.format(slice.start)
      : period === 'week'
        ? new Intl.DateTimeFormat(undefined, { timeZone: APP_TIMEZONE, weekday: 'short' }).format(slice.start)
        : `${shortDateFormatter.format(slice.start)}–${new Intl.DateTimeFormat(undefined, { timeZone: APP_TIMEZONE, day: 'numeric' }).format(new Date(slice.end.getTime() - 1))}`;
    rows.push({ label, seconds, hasData });
  }
  return rows;
}

function buildRecentHistoryRows(recentHistory, period, categoryLabel) {
  return recentHistory
    .map(({ bounds, analysis }) => {
      const category = analysis.categories.find((candidate) => candidate.label === categoryLabel);
      if (!category) return null;
      let label = shortDateFormatter.format(bounds.start);
      if (period === 'week') label = `Week of ${shortDateFormatter.format(bounds.start)}`;
      if (period === 'month') label = new Intl.DateTimeFormat(undefined, { timeZone: APP_TIMEZONE, month: 'short', year: 'numeric' }).format(bounds.start);
      if (period === 'year') label = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric' }).format(bounds.start);
      return { label, seconds: category.seconds, category: categoryLabel };
    })
    .filter(Boolean)
    .reverse();
}

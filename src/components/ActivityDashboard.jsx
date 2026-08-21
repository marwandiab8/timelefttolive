import { useEffect, useMemo, useRef, useState } from 'react';
import { useAllLifeEvents, useActivityJournalDetails, useConnectedSources, useLifeEvents } from '../hooks/useCalendar.js';
import { loadAuthorizedActivityImage } from '../services/activityJournal.js';
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
  filterLifeEventsByRange,
  formatDuration,
  getActivityTallyRange,
  getDateIdInTimezone,
  getEventDisplayTitle,
  getEventReceivedTime,
  getEventTime,
  getEventSentTime,
  getIncompleteSessionMessage,
  getMeaningfulEventDetails,
  getLocalDateId,
  getPeriodBounds,
  groupPhotosByDate,
  shiftPeriodDate,
  toggleActivitySelection
} from '../utils/lifeEventUtils.js';

const PERIODS = ['day', 'week', 'month', 'year'];
const TALLY_RANGES = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'This year' },
  { id: '30d', label: '30 days' },
  { id: '7d', label: '7 days' }
];
const HISTORY_PERIOD_COUNTS = { day: 14, week: 8, month: 6, year: 3 };

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
});
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  month: 'short', day: 'numeric'
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

export default function ActivityDashboard({ calendar, onBack }) {
  const [mode, setMode] = useState('wheel');
  const [period, setPeriod] = useState('day');
  const [dateId, setDateId] = useState(() => getLocalDateId());
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [tallyRangeId, setTallyRangeId] = useState('all');
  const [now, setNow] = useState(() => new Date());
  const [theme, setTheme] = useState(() => (
    localStorage.getItem('activityDashboardTheme') === 'light' ? 'light' : 'dark'
  ));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
  const currentState = useLifeEvents(calendar.id, currentQuery?.start, currentQuery?.end, mode === 'wheel' && Boolean(bounds));
  const historyState = useLifeEvents(calendar.id, historyQuery?.start, historyQuery?.end, mode === 'wheel' && Boolean(historyQuery));
  const allLifeEventState = useAllLifeEvents(calendar.id, mode === 'totals');
  const sourceState = useConnectedSources(calendar.id);
  const journalState = useActivityJournalDetails(
    calendar.id,
    currentState.lifeEvents,
    mode === 'wheel' && !currentState.loading
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

  const tallyRange = useMemo(() => getActivityTallyRange(tallyRangeId, now), [now, tallyRangeId]);
  const tallyEvents = useMemo(() => (
    filterLifeEventsByRange(allLifeEventState.lifeEvents, tallyRange)
  ), [allLifeEventState.lifeEvents, tallyRange]);
  const tallies = useMemo(() => buildActivityTallies(tallyEvents, {
    includeActive: true,
    now
  }), [now, tallyEvents]);

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
    localStorage.setItem('activityDashboardTheme', nextTheme);
  }

  return (
    <main className="activity-dashboard activity-cycle" data-theme={theme} style={{ '--activity-focus': accent }}>
      <header className="cycle-header">
        <div className="cycle-brand">
          <p>Time Left To Live</p>
          <h1>Activity</h1>
        </div>
        <nav className="cycle-view-switcher" aria-label="Activity view">
          <button className={mode === 'wheel' ? 'selected' : ''} type="button" onClick={() => chooseMode('wheel')}>Time wheel</button>
          <button className={mode === 'totals' ? 'selected' : ''} type="button" onClick={() => chooseMode('totals')}>My totals</button>
        </nav>
        <div className="cycle-header-actions">
          <button className="cycle-text-button" type="button" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
          <button className="cycle-back-button" type="button" onClick={onBack}>Back to calendar</button>
        </div>
      </header>

      {error && <div className="activity-alert" role="alert">Some activity data could not be loaded. {error}</div>}

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
        />
      ) : (
        <TotalsView
          loading={allLifeEventState.loading}
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
    </main>
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
  title
}) {
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
          {loading ? (
            <LoadingState label="Building your time wheel…" />
          ) : analysis.categories.length ? (
            <LifeWheel
              analysis={analysis}
              categoryAnalysis={categoryAnalysis}
              now={now}
              onSelect={onSelect}
              period={period}
              pointAnalysis={pointAnalysis}
              selectedLabel={selectedLabel}
              title={title}
            />
          ) : (
            <EmptyWheel title={title} momentCount={analysis.momentGroups.length} incompleteCount={analysis.incompleteCount} />
          )}
        </div>

        <aside className="cycle-glance">
          {categoryAnalysis ? (
            <SelectedGlance analysis={categoryAnalysis} onClear={() => onSelect(categoryAnalysis.label)} />
          ) : pointAnalysis ? (
            <PointGlance analysis={pointAnalysis} onClear={() => onSelect(pointAnalysis.label)} />
          ) : (
            <PeriodGlance analysis={analysis} bounds={bounds} title={title} />
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

function LifeWheel({ analysis, categoryAnalysis, now, onSelect, period, pointAnalysis, selectedLabel, title }) {
  let cursor = 0;
  const segments = analysis.categories.map((category) => {
    const percentage = analysis.timedSeconds ? (category.seconds / analysis.timedSeconds) * 100 : 0;
    const segment = { ...category, percentage, offset: cursor, midpoint: cursor + (percentage / 2) };
    cursor += percentage;
    return segment;
  });
  const centerSession = categoryAnalysis?.activeSession
    || (period === 'day' ? categoryAnalysis?.sessions[0] : null);

  return (
    <div className="life-wheel" data-testid="life-wheel">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${title} time allocation`}>
        <circle className="life-wheel-track" cx="50" cy="50" r="39" pathLength="100" />
        {segments.map((segment) => (
          <circle
            aria-label={`${segment.label}, ${formatDuration(segment.seconds)}`}
            className={`life-wheel-segment ${selectedLabel && selectedLabel !== segment.label ? 'faded' : ''} ${selectedLabel === segment.label ? 'selected' : ''}`}
            cx="50" cy="50" key={segment.label} pathLength="100" r="39" role="button"
            stroke={segment.color}
            strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`}
            strokeDashoffset={-segment.offset}
            tabIndex="0"
            onClick={() => onSelect(segment.label)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(segment.label);
              }
            }}
          >
            <title>{segment.label}: {formatDuration(segment.seconds)}</title>
          </circle>
        ))}
      </svg>
      <WheelLabels segments={segments} onSelect={onSelect} selectedLabel={selectedLabel} />
      <div className="life-wheel-center" aria-live="polite">
        {categoryAnalysis ? (
          <>
            <span className="life-wheel-icon" aria-hidden="true">{categoryAnalysis.icon}</span>
            <h2>{categoryAnalysis.label}</h2>
            {centerSession?.location && <p>{centerSession.location}</p>}
            {centerSession ? (
              <time>{clockFormatter.format(centerSession.startAt)} – {centerSession.active ? 'In progress' : clockFormatter.format(centerSession.endAt)}</time>
            ) : (
              <p>{categoryAnalysis.sessionCount} {categoryAnalysis.sessionCount === 1 ? 'session' : 'sessions'}</p>
            )}
            <strong>{formatDuration(centerSession?.durationSeconds ?? categoryAnalysis.totalSeconds)}</strong>
          </>
        ) : pointAnalysis ? (
          <>
            <span className="life-wheel-icon" aria-hidden="true">{pointAnalysis.icon}</span>
            <h2>{pointAnalysis.label}</h2>
            <p>{pointAnalysis.count} {pointAnalysis.count === 1 ? 'event' : 'events'}</p>
            <strong>{pointAnalysis.reliableDuration ? formatDuration(pointAnalysis.totalSeconds) : 'Moments'}</strong>
            {!pointAnalysis.reliableDuration && <span>No duration supplied</span>}
          </>
        ) : (
          <>
            <p>{title}</p>
            <strong>{formatDuration(analysis.timedSeconds)}</strong>
            <span>tracked time</span>
            {analysis.activeCount > 0 && <small>{analysis.activeCount} in progress · updated {clockFormatter.format(now)}</small>}
          </>
        )}
      </div>
    </div>
  );
}

function WheelLabels({ segments, selectedLabel, onSelect }) {
  return (
    <div className="life-wheel-labels" aria-hidden="true">
      {segments.filter((segment) => segment.percentage >= 4).map((segment) => {
        const angle = ((segment.midpoint / 100) * 360) - 90;
        const radians = angle * (Math.PI / 180);
        const left = 50 + (42 * Math.cos(radians));
        const top = 50 + (42 * Math.sin(radians));
        return (
          <button
            className={selectedLabel === segment.label ? 'selected' : ''}
            key={segment.label}
            style={{ left: `${left}%`, top: `${top}%`, '--label-color': segment.color }}
            type="button"
            tabIndex="-1"
            onClick={() => onSelect(segment.label)}
          >
            <span>{segment.icon}</span><b>{segment.label}</b><small>{formatDuration(segment.seconds)}</small>
          </button>
        );
      })}
    </div>
  );
}

function CategoryLegend({ categories, pointCategories, selectedLabel, onSelect }) {
  const timedLabels = new Set(categories.map((category) => category.label));
  const selectablePoints = pointCategories.filter((category) => !timedLabels.has(category.label));
  return (
    <div className="cycle-legend" aria-label="Activity categories">
      {categories.map((category) => (
        <button className={selectedLabel === category.label ? 'selected' : ''} key={category.label} type="button" onClick={() => onSelect(category.label)}>
          <i style={{ background: category.color }} /><span>{category.icon} {category.label}</span><strong>{category.seconds > 0 ? formatDuration(category.seconds) : 'Incomplete'}</strong>
        </button>
      ))}
      {selectablePoints.map((category) => (
        <button className={selectedLabel === category.label ? 'selected' : ''} key={`point-${category.label}`} type="button" onClick={() => onSelect(category.label)}>
          <i style={{ background: category.color }} /><span>{category.icon} {category.label}</span><strong>{category.count} {category.count === 1 ? 'event' : 'events'}</strong>
        </button>
      ))}
    </div>
  );
}

function PeriodGlance({ analysis, bounds, title }) {
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
      {analysis.incompleteCount > 0 && <p className="cycle-caution">{analysis.incompleteCount} historical session {analysis.incompleteCount === 1 ? 'is' : 'are'} missing a finish and excluded from tracked time.</p>}
    </div>
  );
}

function SelectedGlance({ analysis, onClear }) {
  return (
    <div className="cycle-glance-copy selected">
      <p className="cycle-eyebrow">Focused view</p>
      <h2>{analysis.icon} {analysis.label}</h2>
      <p className="cycle-reflection">{buildCategoryInsight(analysis)}</p>
      <dl className="cycle-glance-metrics">
        <div><dt>Total time</dt><dd>{formatDuration(analysis.totalSeconds)}</dd></div>
        <div><dt>{analysis.label === 'Gym/Fitness' ? 'Visits' : 'Sessions'}</dt><dd>{analysis.sessionCount}</dd></div>
        <div><dt>Active days</dt><dd>{analysis.activeDays}</dd></div>
        <div><dt>Average</dt><dd>{formatDuration(analysis.averageSessionSeconds)}</dd></div>
      </dl>
      <button className="cycle-clear-selection" type="button" onClick={onClear}>Show all activities</button>
    </div>
  );
}

function PointGlance({ analysis, onClear }) {
  return (
    <div className="cycle-glance-copy selected">
      <p className="cycle-eyebrow">Focused moments</p>
      <h2>{analysis.icon} {analysis.label}</h2>
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

function ActivityStream({ analysis, bounds, now, onInspectDate, onSelect }) {
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
          <TimelineEntryList entries={group.entries} key={group.dateId} onSelect={onSelect} />
        ) : (
          <details className="cycle-activity-day" key={group.dateId} open={bounds.period === 'week'}>
            <summary>
              <div><strong>{timelineDateLabel(group.dateId)}</strong><span>{group.entries.length} shown</span></div>
              <span>Open day</span>
            </summary>
            <button className="cycle-inspect-day" type="button" onClick={() => onInspectDate(group.dateId)}>View this day’s timeline</button>
            <TimelineEntryList entries={group.entries} onSelect={onSelect} />
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

function TimelineEntryList({ entries, onSelect }) {
  const timed = entries.filter((entry) => entry.timeRecorded);
  const untimed = entries.filter((entry) => !entry.timeRecorded);
  return (
    <ol className="cycle-linear-timeline">
      {timed.map((entry) => <TimelineEntry entry={entry} key={entry.id} onSelect={onSelect} />)}
      {untimed.length > 0 && <li className="cycle-time-unrecorded"><span>Time not recorded</span></li>}
      {untimed.map((entry) => <TimelineEntry entry={entry} key={entry.id} onSelect={onSelect} />)}
    </ol>
  );
}

function TimelineEntry({ entry, onSelect }) {
  const details = entry.details || getMeaningfulEventDetails(entry.event);
  const secondary = entry.type === 'session'
    ? [entry.location, entry.nested && entry.parentTitle ? `Inside ${entry.parentTitle}` : ''].filter(Boolean).join(' · ')
    : [details.artist, details.album, details.playlist, details.location, details.note]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(' · ');
  const selection = entry.pointCategory || entry.category;
  const title = details.track || entry.title;
  return (
    <li className={`${entry.type} ${entry.nested ? 'nested' : ''}`} style={{ '--timeline-color': entry.color }}>
      <span className="cycle-timeline-marker" aria-hidden="true">{entry.icon}</span>
      <time dateTime={entry.at?.toISOString()}>{entry.at ? clockFormatter.format(entry.at) : 'No time'}</time>
      <article>
        <button type="button" onClick={() => onSelect(selection)} aria-label={`Open ${selection} activity: ${title}`}>
          <div>
            <strong>{title}</strong>
            {secondary && <p>{secondary}</p>}
            {entry.type === 'session' && <small>{timelineSessionRange(entry)}</small>}
            {entry.type === 'moment' && <small>{entry.sourceApp || 'Moment'}{entry.sentAt && ` · Source sent ${clockFormatter.format(entry.sentAt)}`}</small>}
          </div>
          {entry.type === 'session' ? (
            <b className={entry.active ? 'active' : entry.incomplete ? 'incomplete' : ''}>
              {entry.active ? 'In progress' : entry.incomplete ? entry.status : formatDuration(entry.durationSeconds)}
            </b>
          ) : entry.count > 1 ? <b>×{entry.count}</b> : <span aria-hidden="true">›</span>}
        </button>
        {entry.type === 'session' && (
          <div className="cycle-timeline-boundaries">
            {entry.startedBeforeVisibleRange && <span><b>Continued into this period</b> The chart begins at the selected period boundary; the actual arrival is shown below.</span>}
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
  const visibleStart = entry.startedBeforeVisibleRange
    ? `Continued from ${timelineBoundaryLabel(entry.boundaryStartAt, entry.dateId)}`
    : clockFormatter.format(entry.at);
  const visibleDuration = `${formatDuration(entry.durationSeconds)}${entry.startedBeforeVisibleRange ? ' shown in this period' : ''}`;
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
      <div className="cycle-day-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span></div>
      <div className="cycle-day-rows">
        {chart.rows.map((row) => (
          <article className={row.nested ? 'nested' : ''} key={row.id}>
            <div><strong>{row.nested ? `↳ ${row.title}` : row.title}</strong><span>{row.active ? 'In progress' : row.incomplete ? row.status : formatDuration(row.durationSeconds)}</span></div>
            <div className="cycle-day-track">
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
                ><span aria-hidden="true">{moment.icon}</span></button>
              ))}
            </div>
          </article>
        )}
      </div>
      <p className="cycle-chart-legend"><span><i className="session" /> Timed session</span><span><i className="moment" /> Point activity</span><span><i className="current" /> Current Toronto time</span></p>
    </section>
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
        <div className="cycle-journal-icon" aria-hidden="true">✎</div>
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
      <span aria-hidden="true">{entry.icon}</span>
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

function TotalsView({ tallies, loading, range, rangeId, onRangeChange }) {
  return (
    <section className="cycle-totals-view">
      <header><div><p className="cycle-eyebrow">A longer view</p><h2>My Totals</h2><p>Only meaningful timed activities appear here. Notes, reports, coordinates, and attachments stay with Moments.</p></div><div className="cycle-total-ranges">{TALLY_RANGES.map((option) => <button className={rangeId === option.id ? 'selected' : ''} key={option.id} type="button" onClick={() => onRangeChange(option.id)}>{option.label}</button>)}</div></header>
      {loading ? <LoadingState label="Calculating your totals…" /> : tallies.length === 0 ? <p className="activity-state">No complete timed sessions were recorded for {range.label.toLowerCase()}.</p> : <div className="cycle-total-grid">{tallies.map((tally) => <article key={tally.label} style={{ '--total-color': tally.color }}><span>{tally.icon}</span><div><h3>{tally.label}</h3><strong>{formatDuration(tally.totalSeconds)}</strong></div><dl><div><dt>Days</dt><dd>{tally.dayCount}</dd></div><div><dt>Sessions</dt><dd>{tally.sessionCount}</dd></div><div><dt>Average</dt><dd>{formatDuration(tally.averageSeconds)}</dd></div><div><dt>First</dt><dd>{tally.firstAt ? shortDateFormatter.format(tally.firstAt) : '—'}</dd></div><div><dt>Latest</dt><dd>{tally.lastAt ? shortDateFormatter.format(tally.lastAt) : '—'}</dd></div></dl></article>)}</div>}
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

function formatSessionRange(session) {
  if (session.missingBoundary === 'start') return `Arrival not recorded – ${clockFormatter.format(session.startAt)}`;
  return `${clockFormatter.format(session.startAt)} – ${session.active ? 'In progress' : session.endAt ? clockFormatter.format(session.endAt) : 'Departure not recorded'}`;
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
      label: clockFormatter.format(session.startAt),
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

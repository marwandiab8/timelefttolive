import { useMemo, useState } from 'react';
import { useAllLifeEvents, useConnectedSources, useLifeEvents } from '../hooks/useCalendar.js';
import {
  APP_TIMEZONE,
  buildActivityTallies,
  buildComparison,
  buildDailyInsight,
  buildPeriodAnalysis,
  filterLifeEventsByRange,
  formatDuration,
  getActivityLabel,
  getDateIdInTimezone,
  getEventTime,
  getLocalDateId,
  getPeriodBounds,
  getActivityTallyRange,
  shiftPeriodDate
} from '../utils/lifeEventUtils.js';

const PERIODS = ['day', 'week', 'month', 'year'];
const TALLY_RANGES = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'This year' },
  { id: '30d', label: '30 days' },
  { id: '7d', label: '7 days' }
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  month: 'long', day: 'numeric', year: 'numeric'
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIMEZONE,
  weekday: 'short', month: 'short', day: 'numeric'
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

function periodTitle(period, dateId, bounds) {
  if (period === 'day') {
    const today = getLocalDateId();
    if (dateId === today) return 'Today';
    if (dateId === shiftPeriodDate(today, 'day', -1)) return 'Yesterday';
    return dateFormatter.format(bounds.start);
  }
  if (period === 'week') return `Week of ${dateFormatter.format(bounds.start)}`;
  if (period === 'month') return dateFormatter.format(bounds.start).replace(/\s+\d{1,2},\s+/, ' ');
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric' }).format(bounds.start);
}

export default function ActivityDashboard({ calendar, onBack }) {
  const [period, setPeriod] = useState('day');
  const [dateId, setDateId] = useState(() => getLocalDateId());
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [tallyRangeId, setTallyRangeId] = useState('all');
  const [selectedTally, setSelectedTally] = useState(null);
  const [theme, setTheme] = useState(() => (
    localStorage.getItem('activityDashboardTheme') === 'light' ? 'light' : 'dark'
  ));

  const bounds = useMemo(() => getPeriodBounds(period, dateId), [period, dateId]);
  const previousBounds = useMemo(() => (
    bounds ? getPeriodBounds(period, shiftPeriodDate(dateId, period, -1)) : null
  ), [bounds, dateId, period]);
  const currentQuery = useMemo(() => queryBounds(bounds), [bounds]);
  const previousQuery = useMemo(() => queryBounds(previousBounds), [previousBounds]);
  const currentState = useLifeEvents(calendar.id, currentQuery?.start, currentQuery?.end, Boolean(bounds));
  const previousState = useLifeEvents(calendar.id, previousQuery?.start, previousQuery?.end, Boolean(previousBounds));
  const allLifeEventState = useAllLifeEvents(calendar.id);
  const sourceState = useConnectedSources(calendar.id);

  const analysis = useMemo(
    () => buildPeriodAnalysis(currentState.lifeEvents, bounds),
    [bounds, currentState.lifeEvents]
  );
  const previous = useMemo(
    () => buildPeriodAnalysis(previousState.lifeEvents, previousBounds),
    [previousBounds, previousState.lifeEvents]
  );
  const comparison = useMemo(() => buildComparison(analysis, previous), [analysis, previous]);
  const tallyRange = useMemo(() => getActivityTallyRange(tallyRangeId), [tallyRangeId]);
  const tallyEvents = useMemo(
    () => filterLifeEventsByRange(allLifeEventState.lifeEvents, tallyRange),
    [allLifeEventState.lifeEvents, tallyRange]
  );
  const tallies = useMemo(() => buildActivityTallies(tallyEvents), [tallyEvents]);
  const selectedPeriodCategory = analysis.categories.find((category) => category.label === selectedCategory);
  const selectedTallyData = tallies.find((tally) => tally.label === selectedTally);
  const visibleSessions = selectedPeriodCategory
    ? selectedPeriodCategory.sessions
    : analysis.allocatedSessions;
  const error = currentState.error || previousState.error || allLifeEventState.error || sourceState.error;
  const activeConnections = sourceState.connections.filter((connection) => connection.status === 'active').length;

  function movePeriod(amount) {
    setDateId(shiftPeriodDate(dateId, period, amount));
    setSelectedCategory(null);
  }

  function choosePeriod(nextPeriod) {
    setPeriod(nextPeriod);
    setSelectedCategory(null);
  }

  function chooseTallyRange(nextRange) {
    setTallyRangeId(nextRange);
    setSelectedTally(null);
  }

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('activityDashboardTheme', nextTheme);
  }

  return (
    <main className="activity-dashboard" data-theme={theme}>
      <header className="activity-header">
        <div>
          <p className="activity-kicker">Time Left To Live · Owner activity</p>
          <h1>Activity dashboard</h1>
          <p className="activity-subtitle">A clearer view of how your time was spent.</p>
        </div>
        <div className="activity-header-actions">
          <button className="activity-button" type="button" onClick={toggleTheme}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button className="activity-button activity-button-primary" type="button" onClick={onBack}>
            Back to life calendar
          </button>
        </div>
      </header>

      <nav className="activity-period-nav" aria-label="Activity period">
        <div className="activity-period-tabs">
          {PERIODS.map((option) => (
            <button
              className={period === option ? 'selected' : ''}
              key={option}
              type="button"
              onClick={() => choosePeriod(option)}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
        <div className="activity-period-controls">
          <button className="activity-icon-button" type="button" onClick={() => movePeriod(-1)} aria-label="Previous period">←</button>
          <strong>{periodTitle(period, dateId, bounds)}</strong>
          <button className="activity-icon-button" type="button" onClick={() => movePeriod(1)} aria-label="Next period">→</button>
          <input type="date" value={dateId} onChange={(event) => setDateId(event.target.value)} aria-label="Choose activity date" />
          {period === 'day' && (
            <button className="activity-button" type="button" onClick={() => setDateId(getLocalDateId())}>Today</button>
          )}
        </div>
      </nav>

      {error && <div className="activity-alert" role="alert">Activity data could not be fully loaded. {error}</div>}

      <section className="activity-summary-grid" aria-label="Period summary">
        <SummaryCard
          label="Tracked time"
          value={currentState.loading ? '—' : formatDuration(analysis.timedSeconds)}
          detail={period === 'day' ? `${Math.round(analysis.timedSeconds / 864)}% of the day classified` : `${analysis.coveredDays} active days`}
        />
        <SummaryCard label="Sessions" value={currentState.loading ? '—' : analysis.allocatedSessions.length.toLocaleString()} detail={`${analysis.incompleteCount} active or incomplete`} />
        <SummaryCard label="Moments" value={currentState.loading ? '—' : analysis.moments.length.toLocaleString()} detail="Point-in-time activities" />
        <SummaryCard label="Change" value={currentState.loading || !comparison.hasPrevious ? '—' : signedDuration(comparison.deltaSeconds)} detail={comparison.hasPrevious ? `vs previous ${period}` : 'More history needed'} />
      </section>

      <section className="activity-card activity-tally-card">
        <div className="activity-tally-heading">
          <SectionHeading eyebrow="Hours, days, sessions, and moments" title="Activity tallies" />
          <div className="activity-range-switcher" aria-label="Activity tally period">
            {TALLY_RANGES.map((range) => (
              <button
                aria-pressed={tallyRangeId === range.id}
                className={tallyRangeId === range.id ? 'selected' : ''}
                key={range.id}
                type="button"
                onClick={() => chooseTallyRange(range.id)}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        {allLifeEventState.loading ? (
          <LoadingState label="Calculating activity totals…" />
        ) : tallies.length === 0 ? (
          <EmptyState>No activities were recorded during {tallyRange.label.toLowerCase()}.</EmptyState>
        ) : (
          <div className="activity-tally-grid">
            {tallies.map((tally) => (
              <ActivityTallyCard
                key={tally.label}
                tally={tally}
                selected={selectedTally === tally.label}
                onSelect={() => setSelectedTally(selectedTally === tally.label ? null : tally.label)}
              />
            ))}
          </div>
        )}
        {selectedTallyData && (
          <div className="activity-tally-detail">
            <SectionHeading eyebrow={`${tallyRange.label} history`} title={selectedTallyData.label} />
            {selectedTallyData.sessions.length ? (
              <SessionList sessions={selectedTallyData.sessions.slice(-50)} />
            ) : (
              <EmptyState>This activity contains moments, but no complete timed sessions.</EmptyState>
            )}
          </div>
        )}
      </section>

      <div className="activity-main-grid">
        <section className="activity-card activity-donut-card">
          <SectionHeading eyebrow="Time allocation" title={selectedCategory ? `${selectedCategory} selected` : 'Where your time went'} />
          {currentState.loading ? (
            <LoadingState label="Loading activity mix…" />
          ) : analysis.categories.length === 0 ? (
            <EmptyState>No complete timed sessions were recorded for this period.</EmptyState>
          ) : (
            <>
              <InteractiveDonut categories={analysis.categories} selected={selectedCategory} onSelect={setSelectedCategory} total={analysis.timedSeconds} />
              <div className="activity-legend">
                {analysis.categories.map((category) => (
                  <button
                    className={selectedCategory === category.label ? 'selected' : ''}
                    key={category.label}
                    type="button"
                    onClick={() => setSelectedCategory(selectedCategory === category.label ? null : category.label)}
                  >
                    <i style={{ background: category.color }} />
                    <span>{category.label}</span>
                    <strong>{formatDuration(category.seconds)}</strong>
                    <b aria-hidden="true">›</b>
                  </button>
                ))}
              </div>
              {selectedPeriodCategory && (
                <CategoryReflection
                  category={selectedPeriodCategory}
                  previous={previous.categories.find((category) => category.label === selectedCategory)}
                  bounds={bounds}
                  onClear={() => setSelectedCategory(null)}
                />
              )}
            </>
          )}
        </section>

        <section className="activity-card activity-timeline-card">
          <SectionHeading eyebrow={period === 'day' ? 'Chronological view' : `${periodTitle(period, dateId, bounds)} sessions`} title="Activity timeline" />
          {currentState.loading ? (
            <LoadingState label="Loading sessions…" />
          ) : visibleSessions.length === 0 ? (
            <EmptyState>No timed sessions in this period.</EmptyState>
          ) : (
            <SessionList sessions={visibleSessions} />
          )}
          {analysis.moments.length > 0 && <Moments events={analysis.moments} />}
        </section>
      </div>

      <TrendChart period={period} analysis={analysis} previous={previous} bounds={bounds} />

      <div className="activity-bottom-grid">
        <section className="activity-card">
          <SectionHeading eyebrow={`${activeConnections} active of ${sourceState.connections.length}`} title="Connected sources" />
          {sourceState.loading ? (
            <LoadingState label="Checking connections…" />
          ) : sourceState.connections.length === 0 ? (
            <EmptyState>No connected sources are registered yet.</EmptyState>
          ) : (
            <div className="activity-source-list">
              {sourceState.connections.map((connection) => (
                <div className="activity-source-item" key={connection.id}>
                  <i className={`activity-status-dot ${connection.status || 'unknown'}`} />
                  <div><strong>{connection.sourceApp || 'Connected source'}</strong><p>{connection.status || 'unknown'} · source status</p></div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="activity-card activity-insight-card">
          <SectionHeading eyebrow="Life reflection" title="What stands out" />
          {currentState.loading ? <LoadingState label="Building reflection…" /> : <p>{buildDailyInsight(currentState.lifeEvents, bounds)}</p>}
        </section>
      </div>
    </main>
  );
}

function ActivityTallyCard({ tally, selected, onSelect }) {
  return (
    <button className={`activity-tally-item ${selected ? 'selected' : ''}`} type="button" onClick={onSelect} aria-expanded={selected}>
      <span className="activity-tally-glyph" style={{ '--activity-tally-color': tally.color }} aria-hidden="true">•</span>
      <div className="activity-tally-title"><strong>{tally.label}</strong><small>{tally.sourceCount} {tally.sourceCount === 1 ? 'source' : 'sources'}</small></div>
      <div className="activity-tally-total"><strong>{tally.totalSeconds ? formatDuration(tally.totalSeconds) : 'Moments'}</strong><small>Total tracked time</small></div>
      <dl>
        <div><dt>Days</dt><dd>{tally.dayCount}</dd></div>
        <div><dt>Sessions</dt><dd>{tally.sessionCount}</dd></div>
        <div><dt>Events</dt><dd>{tally.eventCount}</dd></div>
        <div><dt>Average</dt><dd>{tally.averageSeconds ? formatDuration(tally.averageSeconds) : '—'}</dd></div>
      </dl>
      <b aria-hidden="true">›</b>
    </button>
  );
}

function InteractiveDonut({ categories, selected, onSelect, total }) {
  let cursor = 0;
  const segments = categories.map((category) => {
    const percentage = total ? (category.seconds / total) * 100 : 0;
    const segment = { ...category, percentage, offset: cursor };
    cursor += percentage;
    return segment;
  });
  const selectedData = categories.find((category) => category.label === selected);
  return (
    <div className="activity-donut-layout">
      <div className="activity-donut-graphic">
        <svg viewBox="0 0 100 100" role="img" aria-label="Time allocation donut">
          <circle className="activity-donut-track" cx="50" cy="50" r="40" pathLength="100" />
          {segments.map((segment) => (
            <circle
              aria-label={`${segment.label}, ${formatDuration(segment.seconds)}`}
              className={`activity-donut-segment ${selected && selected !== segment.label ? 'faded' : ''} ${selected === segment.label ? 'selected' : ''}`}
              cx="50" cy="50" key={segment.label} pathLength="100" r="40" role="button"
              stroke={segment.color}
              strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`}
              strokeDashoffset={-segment.offset}
              tabIndex="0"
              onClick={() => onSelect(selected === segment.label ? null : segment.label)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(selected === segment.label ? null : segment.label);
                }
              }}
            >
              <title>{segment.label}: {formatDuration(segment.seconds)}</title>
            </circle>
          ))}
        </svg>
        <div className="activity-donut-center" aria-hidden="true">
          <strong>{formatDuration(selectedData?.seconds ?? total)}</strong>
          <span>{selected || 'tracked time'}</span>
          <small>{selected ? 'Select again to clear' : 'Select a category'}</small>
        </div>
      </div>
    </div>
  );
}

function CategoryReflection({ category, previous, bounds, onClear }) {
  const delta = previous ? category.seconds - previous.seconds : null;
  const activeDays = new Set(category.sessions.map((session) => (
    getDateIdInTimezone(session.startAt, bounds.timezone)
  ))).size;
  const longest = category.sessions.reduce((maximum, session) => Math.max(maximum, session.durationSeconds || 0), 0);
  return (
    <div className="activity-category-reflection">
      <div><strong>{formatDuration(category.seconds)}</strong><span>{category.sessions.length} sessions · {activeDays} active days · average {formatDuration(category.seconds / Math.max(1, category.sessions.length))}</span></div>
      <p>
        {delta === null ? `${category.label} was recorded across ${activeDays} active ${activeDays === 1 ? 'day' : 'days'}.` : `That is ${signedDuration(delta)} compared with the previous period.`}
        {longest ? ` Longest session: ${formatDuration(longest)}.` : ''}
        {category.nestedSessions.length ? ` Includes ${category.nestedSessions.length} nested ${category.nestedSessions.length === 1 ? 'activity' : 'activities'} without double-counting their minutes.` : ''}
      </p>
      <button type="button" onClick={onClear}>Clear selection</button>
    </div>
  );
}

function SessionList({ sessions }) {
  return (
    <ol className="activity-session-list">
      {[...sessions].sort((left, right) => left.startAt - right.startAt).map((session) => (
        <li key={session.id}>
          <time>{clockFormatter.format(session.startAt)}{session.endAt ? `–${clockFormatter.format(session.endAt)}` : ' · in progress'}</time>
          <div><strong>{session.title}</strong><p>{session.category}{session.event?.location?.label ? ` · ${session.event.location.label}` : ''}</p></div>
          <b>{session.durationSeconds ? formatDuration(session.durationSeconds) : 'Active'}</b>
        </li>
      ))}
    </ol>
  );
}

function Moments({ events }) {
  return (
    <section className="activity-moments">
      <h3>Moments & occurrences</h3>
      <p>{events.length} point-in-time {events.length === 1 ? 'activity' : 'activities'} do not affect tracked duration.</p>
      <ul>
        {events.slice(0, 20).map((event) => (
          <li key={event.id}><time>{getEventTime(event) ? clockFormatter.format(getEventTime(event)) : 'Time unavailable'}</time><span>{event.title || getActivityLabel(event)}</span></li>
        ))}
      </ul>
    </section>
  );
}

function TrendChart({ period, analysis, previous, bounds }) {
  const rows = period === 'day' ? analysis.allocatedSessions.map((session) => ({ label: clockFormatter.format(session.startAt), seconds: session.allocatedSeconds })) : buildTrendRows(period, analysis, bounds);
  if (!rows.length) return null;
  const maximum = Math.max(...rows.map((row) => row.seconds), 1);
  return (
    <section className="activity-card activity-trend-card">
      <SectionHeading eyebrow={period === 'day' ? 'Start, finish, and duration' : 'Compared across the period'} title={period === 'day' ? 'Day timeline' : `${period[0].toUpperCase() + period.slice(1)} trend`} />
      <div className="activity-bars">
        {rows.map((row, index) => (
          <div className="activity-bar-row" key={`${row.label}-${index}`}>
            <span>{row.label}</span><div><i style={{ width: `${Math.max(2, (row.seconds / maximum) * 100)}%` }} /></div><strong>{formatDuration(row.seconds)}</strong>
          </div>
        ))}
      </div>
      {previous.timedSeconds > 0 && <small className="activity-chart-note">Previous equivalent period: {formatDuration(previous.timedSeconds)}</small>}
    </section>
  );
}

function buildTrendRows(period, analysis, bounds) {
  const count = period === 'week' ? 7 : period === 'month' ? Number(bounds.endDateId.slice(-2)) : 12;
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const sliceDateId = period === 'year'
      ? `${bounds.startDateId.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`
      : shiftPeriodDate(bounds.startDateId, 'day', index);
    const slice = getPeriodBounds(period === 'year' ? 'month' : 'day', sliceDateId);
    const seconds = analysis.allocatedSessions.reduce((sum, session) => {
      const overlap = Math.max(0, Math.min(session.endAt.getTime(), slice.end.getTime()) - Math.max(session.startAt.getTime(), slice.start.getTime()));
      return sum + (overlap / 1000);
    }, 0);
    rows.push({ label: period === 'year' ? monthFormatter.format(slice.start) : dayFormatter.format(slice.start), seconds });
  }
  return rows;
}

function SummaryCard({ label, value, detail }) {
  return <article className="activity-summary-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function SectionHeading({ eyebrow, title }) {
  return <header className="activity-section-heading"><p>{eyebrow}</p><h2>{title}</h2></header>;
}

function LoadingState({ label }) {
  return <p className="activity-state" role="status">{label}</p>;
}

function EmptyState({ children }) {
  return <p className="activity-state">{children}</p>;
}

function signedDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds === 0) return 'no change';
  return `${seconds > 0 ? '+' : '−'}${formatDuration(Math.abs(seconds))}`;
}

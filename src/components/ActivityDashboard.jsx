import { useEffect, useMemo, useState } from 'react';
import { useAllLifeEvents, useConnectedSources, useLifeEvents } from '../hooks/useCalendar.js';
import {
  buildActivityAnalysis,
  buildActivityBreakdown,
  buildActivityTallies,
  buildDailyInsight,
  filterLifeEvents,
  filterLifeEventsByRange,
  formatDuration,
  getActivityLabel,
  getActivityTallyRange,
  getDailySummary,
  getDeliveryLatencySeconds,
  getEventDurationSeconds,
  getEventEndTime,
  getEventReceivedTime,
  getEventSentTime,
  getEventTime,
  getLocalDateId,
  getLocalDayBounds,
  sortLifeEvents,
  toJsDate
} from '../utils/lifeEventUtils.js';

const DATE_HEADING_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const HIDDEN_DETAIL_KEY = /(authorization|token|secret|password|credential|api.?key|hash|owner.?uid|calendar.?id|connection.?id|integration.?id|idempotency|source.?record.?id|source.?event.?id|exercises|exercise.?summaries|migration)/i;

const TALLY_RANGES = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'This year' },
  { id: '30d', label: '30 days' },
  { id: '7d', label: '7 days' }
];

function timeOptions(event, options = {}) {
  const output = { ...options };
  if (!event?.timezone) return output;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: event.timezone }).format(new Date());
    output.timeZone = event.timezone;
  } catch (_error) {
    // Keep the browser timezone when a legacy record has an invalid timezone.
  }
  return output;
}

function formatClock(value, event) {
  const date = toJsDate(value);
  if (!date) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, timeOptions(event, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })).format(date);
}

function formatDelay(seconds) {
  if (!Number.isFinite(seconds)) return 'Delay unavailable';
  if (seconds < 1) return 'under 1 second later';
  if (seconds < 60) return `${Math.round(seconds)}s later`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return remainder ? `${minutes}m ${remainder}s later` : `${minutes}m later`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m later` : `${hours}h later`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.round((seconds % 86400) / 3600);
  return hours ? `${days}d ${hours}h later` : `${days}d later`;
}

function humanize(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityGlyph(label) {
  const value = String(label || '').toLowerCase();
  if (value.includes('workout') || value.includes('gym')) return '🏋';
  if (value.includes('location')) return '⌖';
  if (value.includes('work')) return '◆';
  if (value.includes('home')) return '⌂';
  if (value.includes('spotify') || value.includes('music')) return '♫';
  if (value.includes('report') || value.includes('journal')) return '≡';
  if (value.includes('image') || value.includes('picture') || value.includes('media')) return '▣';
  return '•';
}

export default function ActivityDashboard({ calendar, onBack }) {
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateId());
  const [theme, setTheme] = useState(() => (localStorage.getItem('activityDashboardTheme') === 'light' ? 'light' : 'dark'));
  const [drilldown, setDrilldown] = useState(null);
  const [tallyRangeId, setTallyRangeId] = useState('all');
  const dayBounds = useMemo(() => getLocalDayBounds(selectedDate), [selectedDate]);
  const lifeEventState = useLifeEvents(calendar.id, dayBounds?.start, dayBounds?.end, Boolean(dayBounds));
  const allLifeEventState = useAllLifeEvents(calendar.id);
  const sourceState = useConnectedSources(calendar.id);
  const summary = useMemo(() => getDailySummary(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const breakdown = useMemo(() => buildActivityBreakdown(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const timeline = useMemo(() => sortLifeEvents(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const tallyRange = useMemo(() => getActivityTallyRange(tallyRangeId), [tallyRangeId]);
  const tallyEvents = useMemo(
    () => filterLifeEventsByRange(allLifeEventState.lifeEvents, tallyRange),
    [allLifeEventState.lifeEvents, tallyRange]
  );
  const tallies = useMemo(() => buildActivityTallies(tallyEvents), [tallyEvents]);
  const selectedEvents = useMemo(
    () => filterLifeEvents(drilldown?.scope === 'tally' ? tallyEvents : lifeEventState.lifeEvents, drilldown),
    [drilldown, lifeEventState.lifeEvents, tallyEvents]
  );
  const insight = useMemo(() => buildDailyInsight(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const error = lifeEventState.error || allLifeEventState.error || sourceState.error;

  useEffect(() => {
    setDrilldown(null);
  }, [selectedDate]);

  useEffect(() => {
    if (!drilldown) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setDrilldown(null);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drilldown]);

  function changeTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('activityDashboardTheme', nextTheme);
  }

  function moveDate(amount) {
    if (!dayBounds) return;
    const next = new Date(dayBounds.start);
    next.setDate(next.getDate() + amount);
    setSelectedDate(getLocalDateId(next));
  }

  function openCategory(item) {
    setDrilldown({ kind: 'category', value: item.label, label: item.label, color: item.color });
  }

  function openSource(sourceApp) {
    setDrilldown({ kind: 'source', value: sourceApp, label: sourceApp, color: '#65d6ad' });
  }

  function openEvent(event) {
    setDrilldown({
      kind: 'event',
      value: event.id,
      label: event.title || getActivityLabel(event),
      color: '#4f8cff'
    });
  }

  function openTally(tally) {
    setDrilldown({
      kind: 'category',
      scope: 'tally',
      tally: true,
      value: tally.label,
      label: tally.label,
      color: tally.color
    });
  }

  const activeConnections = sourceState.connections.filter((connection) => connection.status === 'active').length;
  const dateLabel = dayBounds ? DATE_HEADING_FORMAT.format(dayBounds.start) : selectedDate;

  return (
    <main className="activity-dashboard" data-theme={theme}>
      <header className="activity-header">
        <div>
          <p className="activity-kicker">Time Left To Live · Owner activity</p>
          <h1>Activity dashboard</h1>
          <p className="activity-subtitle">A daily view of canonical life events for {calendar.firstName} {calendar.lastName}.</p>
        </div>
        <div className="activity-header-actions">
          <button className="activity-button" type="button" onClick={changeTheme} aria-pressed={theme === 'light'}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button className="activity-button activity-button-primary" type="button" onClick={onBack}>Back to life calendar</button>
        </div>
      </header>

      <nav className="activity-date-nav" aria-label="Dashboard date">
        <button className="activity-icon-button" type="button" onClick={() => moveDate(-1)} aria-label="Previous day">←</button>
        <div>
          <span>Daily activity</span>
          <strong>{dayBounds ? DATE_HEADING_FORMAT.format(dayBounds.start) : 'Choose a date'}</strong>
        </div>
        <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} aria-label="Activity date" />
        <button className="activity-button" type="button" onClick={() => setSelectedDate(getLocalDateId())}>Today</button>
        <button className="activity-icon-button" type="button" onClick={() => moveDate(1)} aria-label="Next day">→</button>
      </nav>

      {error && (
        <div className="activity-alert" role="alert">
          Some activity data could not be loaded. {error}
        </div>
      )}

      <section className="activity-summary-grid" aria-label="Daily summary">
        <DailySummaryCard label="Life events" value={lifeEventState.loading ? '—' : summary.eventCount.toLocaleString()} detail="Canonical events received" />
        <DailySummaryCard label="Tracked time" value={lifeEventState.loading ? '—' : formatDuration(summary.activeSeconds)} detail="Duration reported by sources" />
        <DailySummaryCard label="Sources today" value={lifeEventState.loading ? '—' : summary.sourceCount.toLocaleString()} detail="Unique source apps" />
        <DailySummaryCard label="Completed" value={lifeEventState.loading ? '—' : summary.completedCount.toLocaleString()} detail="Completed activities" />
      </section>

      <section className="activity-card activity-tally-card">
        <div className="activity-tally-heading">
          <SectionHeading eyebrow="Hours, days, sessions, and events" title="Activity tallies" />
          <div className="activity-range-switcher" aria-label="Activity tally period">
            {TALLY_RANGES.map((range) => (
              <button
                aria-pressed={tallyRangeId === range.id}
                className={tallyRangeId === range.id ? 'selected' : ''}
                key={range.id}
                onClick={() => setTallyRangeId(range.id)}
                type="button"
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
              <ActivityTallyCard key={tally.label} onSelect={() => openTally(tally)} tally={tally} />
            ))}
          </div>
        )}
      </section>

      <div className="activity-main-grid">
        <section className="activity-card activity-donut-card">
          <SectionHeading eyebrow="Click any colour to investigate" title="Interactive activity mix" />
          {lifeEventState.loading ? (
            <LoadingState label="Loading activity mix…" />
          ) : breakdown.length === 0 ? (
            <EmptyState>No activity categories were recorded for this day.</EmptyState>
          ) : (
            <div className="activity-donut-layout">
              <InteractiveDonut breakdown={breakdown} eventCount={summary.eventCount} onSelect={openCategory} selection={drilldown} />
              <div className="activity-legend">
                {breakdown.map((item) => (
                  <button
                    className={drilldown?.kind === 'category' && drilldown.value === item.label ? 'selected' : ''}
                    key={item.label}
                    type="button"
                    onClick={() => openCategory(item)}
                    aria-haspopup="dialog"
                  >
                    <i style={{ background: item.color }} />
                    <span>{item.label}</span>
                    <strong>{item.usesDuration ? formatDuration(item.seconds) : item.count}</strong>
                    <b aria-hidden="true">›</b>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="activity-card activity-timeline-card">
          <SectionHeading eyebrow="Click an activity for complete timing" title="Daily Life Event timeline" />
          {lifeEventState.loading ? (
            <LoadingState label="Loading the daily timeline…" />
          ) : timeline.length === 0 ? (
            <EmptyState>No canonical life events were recorded on this day.</EmptyState>
          ) : (
            <ol className="activity-timeline">
              {timeline.map((event) => <TimelineEvent event={event} key={event.id} onSelect={() => openEvent(event)} />)}
            </ol>
          )}
        </section>
      </div>

      <div className="activity-bottom-grid">
        <section className="activity-card">
          <SectionHeading
            eyebrow={sourceState.loading ? 'Checking connections' : `${activeConnections} active of ${sourceState.connections.length} · Click a source for its day`}
            title="Connected-source status"
          />
          {sourceState.loading ? (
            <LoadingState label="Loading connected sources…" />
          ) : sourceState.connections.length === 0 ? (
            <EmptyState>No connected sources are registered for this calendar yet.</EmptyState>
          ) : (
            <div className="activity-source-list">
              {sourceState.connections.map((connection) => (
                <SourceStatus
                  connection={connection}
                  eventCount={timeline.filter((event) => (
                    String(event.sourceApp || '').toLowerCase() === String(connection.sourceApp || '').toLowerCase()
                  )).length}
                  key={connection.id}
                  onSelect={() => openSource(connection.sourceApp || connection.sourceFirebaseProjectId || connection.integrationId)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="activity-card activity-insight-card">
          <SectionHeading eyebrow="Your day at a glance" title="Daily insight" />
          {lifeEventState.loading ? <LoadingState label="Building today’s insight…" /> : <p>{insight}</p>}
        </section>
      </div>

      {drilldown && (
        <ActivityDetailPanel
          dateLabel={drilldown.scope === 'tally' ? tallyRange.label : dateLabel}
          events={selectedEvents}
          onClose={() => setDrilldown(null)}
          selection={drilldown}
        />
      )}
    </main>
  );
}

function ActivityTallyCard({ tally, onSelect }) {
  return (
    <button className="activity-tally-item" type="button" onClick={onSelect} aria-haspopup="dialog">
      <span className="activity-tally-glyph" style={{ '--activity-tally-color': tally.color }} aria-hidden="true">
        {activityGlyph(tally.label)}
      </span>
      <div className="activity-tally-title">
        <strong>{tally.label}</strong>
        <small>{tally.sourceCount} {tally.sourceCount === 1 ? 'source' : 'sources'} · Click for complete history</small>
      </div>
      <div className="activity-tally-total">
        <strong>{tally.totalSeconds > 0 ? formatDuration(tally.totalSeconds) : '—'}</strong>
        <small>Total tracked time</small>
      </div>
      <dl>
        <div><dt>Days</dt><dd>{tally.dayCount}</dd></div>
        <div><dt>Sessions</dt><dd>{tally.sessionCount}</dd></div>
        <div><dt>Events</dt><dd>{tally.eventCount}</dd></div>
        <div><dt>Average</dt><dd>{tally.averageSeconds > 0 ? formatDuration(tally.averageSeconds) : '—'}</dd></div>
      </dl>
      <b aria-hidden="true">›</b>
    </button>
  );
}

function InteractiveDonut({ breakdown, eventCount, onSelect, selection }) {
  const total = breakdown.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const segments = breakdown.map((item) => {
    const percentage = total ? (item.value / total) * 100 : 0;
    const segment = { ...item, percentage, offset: cursor };
    cursor += percentage;
    return segment;
  });

  function selectWithKeyboard(event, item) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(item);
    }
  }

  return (
    <div className="activity-donut-graphic">
      <svg viewBox="0 0 100 100" aria-label={`Activity distribution across ${breakdown.length} categories`}>
        <circle className="activity-donut-track" cx="50" cy="50" r="40" pathLength="100" />
        {segments.map((item) => (
          <circle
            aria-label={`${item.label}: ${item.count} ${item.count === 1 ? 'event' : 'events'}`}
            className={selection?.kind === 'category' && selection.value === item.label ? 'activity-donut-segment selected' : 'activity-donut-segment'}
            cx="50"
            cy="50"
            key={item.label}
            onClick={() => onSelect(item)}
            onKeyDown={(event) => selectWithKeyboard(event, item)}
            pathLength="100"
            r="40"
            role="button"
            stroke={item.color}
            strokeDasharray={`${item.percentage} ${100 - item.percentage}`}
            strokeDashoffset={-item.offset}
            tabIndex="0"
          >
            <title>{item.label}: {item.count} {item.count === 1 ? 'event' : 'events'}</title>
          </circle>
        ))}
      </svg>
      <div className="activity-donut-center" aria-hidden="true">
        <strong>{eventCount}</strong>
        <span>{eventCount === 1 ? 'event' : 'events'}</span>
        <small>Click to explore</small>
      </div>
    </div>
  );
}

function DailySummaryCard({ label, value, detail }) {
  return (
    <article className="activity-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function SectionHeading({ eyebrow, title }) {
  return (
    <header className="activity-section-heading">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
    </header>
  );
}

function TimelineEvent({ event, onSelect }) {
  const start = getEventTime(event);
  const end = getEventEndTime(event);
  const duration = getEventDurationSeconds(event);
  const sent = getEventSentTime(event);
  const received = getEventReceivedTime(event);
  const delivery = sent || received;
  const deliveryLabel = sent ? 'Sent' : 'Received';
  const latency = getDeliveryLatencySeconds(event);
  return (
    <li>
      <button className="activity-timeline-event" type="button" onClick={onSelect} aria-haspopup="dialog">
        <time dateTime={start?.toISOString()}>
          <small>{event.startAt ? 'Start' : 'Event'}</small>
          {start ? formatClock(start, event) : 'Time unavailable'}
        </time>
        <div className="activity-timeline-copy">
          <strong>{event.title || event.eventType || 'Life event'}</strong>
          <p>{event.sourceApp || 'Unknown source'} · {getActivityLabel(event)}</p>
          <small className="activity-timeline-delivery">
            {end && `Finished ${formatClock(end, event)} · `}
            {delivery ? `${deliveryLabel} ${formatClock(delivery, event)}${Number.isFinite(latency) ? ` · ${formatDelay(latency)}` : ''}` : 'Delivery time unavailable'}
          </small>
        </div>
        <span>{Number.isFinite(duration) && duration > 0 ? formatDuration(duration) : 'Details'}</span>
        <b aria-hidden="true">›</b>
      </button>
    </li>
  );
}

function SourceStatus({ connection, eventCount, onSelect }) {
  const status = connection.status || 'unknown';
  const statusClass = ['active', 'paused', 'error', 'revoked'].includes(status) ? status : 'unknown';
  const lastSynced = toJsDate(connection.lastSyncedAt);
  return (
    <button className="activity-source-item" type="button" onClick={onSelect} aria-haspopup="dialog">
      <i className={`activity-status-dot ${statusClass}`} />
      <div>
        <strong>{connection.sourceApp || 'Connected source'}</strong>
        <p>{eventCount} {eventCount === 1 ? 'event' : 'events'} on this day · Click for breakdown</p>
      </div>
      <span>
        {status}
        <small>{lastSynced ? `Last sync ${lastSynced.toLocaleString()}` : 'No sync reported'}</small>
      </span>
      <b aria-hidden="true">›</b>
    </button>
  );
}

function ActivityDetailPanel({ selection, events, dateLabel, onClose }) {
  const analysis = buildActivityAnalysis(events);
  const timeWindow = analysis.firstAt && analysis.lastAt
    ? `${formatClock(analysis.firstAt, events[0])}–${formatClock(analysis.lastAt, events.at(-1))}`
    : 'Unavailable';

  function closeBackdrop(event) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="activity-detail-backdrop" onMouseDown={closeBackdrop}>
      <section className="activity-detail-panel" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title">
        <header className="activity-detail-header">
          <div className="activity-detail-title-row">
            <span className="activity-detail-glyph" style={{ '--activity-detail-color': selection.color }} aria-hidden="true">
              {activityGlyph(selection.label)}
            </span>
            <div>
              <p>{selection.kind === 'source' ? 'Source analysis' : selection.kind === 'event' ? 'Activity details' : 'Category analysis'}</p>
              <h2 id="activity-detail-title">{selection.label}</h2>
              <small>{dateLabel}</small>
            </div>
          </div>
          <button className="activity-detail-close" type="button" onClick={onClose} aria-label="Close activity analysis">×</button>
        </header>

        {events.length === 0 ? (
          <div className="activity-detail-empty">
            <strong>No matching activity on this day</strong>
            <p>{selection.label} is connected, but it did not send a canonical Life Event for {dateLabel}.</p>
          </div>
        ) : (
          <>
            <p className="activity-analysis-lead">{buildAnalysisSentence(selection.label, analysis)}</p>

            <section className="activity-analysis-grid" aria-label={`${selection.label} analysis`}>
              <AnalysisMetric label="Active days" value={analysis.activityDayCount.toLocaleString()} detail="Distinct calendar days" />
              <AnalysisMetric label="Total time" value={analysis.trackedSeconds > 0 ? formatDuration(analysis.trackedSeconds) : '—'} detail="Reliable timed sessions" />
              <AnalysisMetric label="Sessions" value={analysis.sessionCount.toLocaleString()} detail={`${analysis.eventCount} canonical ${analysis.eventCount === 1 ? 'event' : 'events'}`} />
              <AnalysisMetric label="Average session" value={analysis.averageSessionSeconds > 0 ? formatDuration(analysis.averageSessionSeconds) : '—'} detail={`${analysis.sourceCount} ${analysis.sourceCount === 1 ? 'source' : 'sources'}`} />
              <AnalysisMetric label="Time window" value={timeWindow} detail={analysis.spanSeconds > 0 ? `${formatDuration(analysis.spanSeconds)} span` : 'Single point in time'} />
              <AnalysisMetric
                label="Average delivery"
                value={Number.isFinite(analysis.averageDeliverySeconds) ? formatDelay(analysis.averageDeliverySeconds).replace(/ later$/, '') : '—'}
                detail={`${analysis.deliveredCount} timestamped ${analysis.deliveredCount === 1 ? 'delivery' : 'deliveries'}`}
              />
            </section>

            {analysis.eventTypes.length > 0 && (
              <div className="activity-type-chips" aria-label="Event type counts">
                {analysis.eventTypes.map((type) => <span key={type.label}>{humanize(type.label)} <strong>{type.count}</strong></span>)}
              </div>
            )}

            {analysis.sessions.length > 0 && (
              <section className="activity-session-section">
                <SectionHeading eyebrow="Calculated from start and finish boundaries" title="Timed sessions" />
                <div className="activity-session-list">
                  {analysis.sessions.map((session) => (
                    <article key={session.id}>
                      <span className="activity-session-line" aria-hidden="true" />
                      <div>
                        <strong>{session.title}</strong>
                        <p>{session.sourceApp || 'Unknown source'} · {session.kind === 'paired' ? 'Paired boundary events' : 'Reported start and finish'}</p>
                      </div>
                      <time>{formatClock(session.startAt, events[0])}–{formatClock(session.endAt, events[0])}</time>
                      <b>{formatDuration(session.durationSeconds)}</b>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="activity-event-breakdown">
              <SectionHeading eyebrow="Every matching canonical event" title={`${events.length} ${events.length === 1 ? 'activity' : 'activities'}`} />
              <div className="activity-detail-events">
                {sortLifeEvents(events).map((event, index) => <DetailEventCard event={event} index={index} key={event.id} />)}
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function AnalysisMetric({ label, value, detail }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function buildAnalysisSentence(label, analysis) {
  const events = `${analysis.eventCount} ${analysis.eventCount === 1 ? 'event' : 'events'}`;
  const timing = analysis.sessionCount > 0
    ? `I found ${analysis.sessionCount} timed ${analysis.sessionCount === 1 ? 'session' : 'sessions'} across ${analysis.activityDayCount} active ${analysis.activityDayCount === 1 ? 'day' : 'days'}, totalling ${formatDuration(analysis.trackedSeconds)}.`
    : 'These activities were recorded as points in time rather than timed sessions.';
  const delivery = Number.isFinite(analysis.averageDeliverySeconds)
    ? `The average delivery delay was ${formatDelay(analysis.averageDeliverySeconds).replace(/ later$/, '')}.`
    : 'No reliable delivery-delay comparison was available.';
  return `${label} produced ${events} from ${analysis.sourceCount} ${analysis.sourceCount === 1 ? 'source' : 'sources'}. ${timing} ${delivery}`;
}

function DetailEventCard({ event, index }) {
  const start = getEventTime(event);
  const end = getEventEndTime(event);
  const sent = getEventSentTime(event);
  const received = getEventReceivedTime(event);
  const latency = getDeliveryLatencySeconds(event);
  const duration = getEventDurationSeconds(event);
  const exercises = extractWorkoutExercises(event);
  const detailRows = buildHumanDetailRows(event);
  return (
    <details className="activity-detail-event" open={index === 0 && !event.startAt && !event.endAt}>
      <summary>
        <span className="activity-event-glyph" aria-hidden="true">{activityGlyph(getActivityLabel(event))}</span>
        <div>
          <strong>{event.title || event.eventType || 'Life event'}</strong>
          <p>{event.sourceApp || 'Unknown source'} · {getActivityLabel(event)}</p>
          <small>
            {start ? `${event.startAt ? 'Started' : 'Occurred'} ${formatClock(start, event)}` : 'Start unavailable'}
            {end ? ` · Finished ${formatClock(end, event)}` : ''}
          </small>
        </div>
        <span>{Number.isFinite(duration) && duration > 0 ? formatDuration(duration) : 'Instant'}</span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="activity-detail-event-body">
        <div className="activity-event-facts">
          <EventFact label={event.startAt ? 'Started' : 'Event time'} value={start ? formatClock(start, event) : 'Unavailable'} />
          <EventFact label="Finished" value={end ? formatClock(end, event) : 'Not supplied'} />
          <EventFact label="Duration" value={Number.isFinite(duration) && duration > 0 ? formatDuration(duration) : 'Not supplied'} />
          <EventFact label="Source sent" value={sent ? formatClock(sent, event) : 'Not supplied by source'} />
          <EventFact label="Received by TimeLeft" value={received ? formatClock(received, event) : 'Unavailable'} />
          <EventFact label="Delivery delay" value={Number.isFinite(latency) ? formatDelay(latency) : 'Unavailable'} />
        </div>

        {event.location?.label && (
          <div className="activity-location-detail">
            <span aria-hidden="true">⌖</span>
            <div>
              <strong>{event.location.label}</strong>
              <small>{Number.isFinite(Number(event.location.accuracyMeters)) ? `Location accuracy ±${Math.round(Number(event.location.accuracyMeters))} m` : 'Location attached to this activity'}</small>
            </div>
          </div>
        )}

        {exercises.length > 0 && (
          <section className="activity-workout-details">
            <h3>Workout breakdown</h3>
            <div>
              {exercises.map((exercise, exerciseIndex) => (
                <article key={`${exercise.name}-${exerciseIndex}`}>
                  <strong>{exercise.name}</strong>
                  <small>{exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}</small>
                  {exercise.sets.length > 0 && (
                    <ol>
                      {exercise.sets.map((set, setIndex) => <li key={`${setIndex}-${set}`}>{set}</li>)}
                    </ol>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {detailRows.length > 0 && (
          <dl className="activity-human-details">
            {detailRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

function EventFact({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function extractWorkoutExercises(event) {
  const candidates = [
    event?.metrics?.exercises,
    event?.metadata?.exercises,
    event?.metadata?.workout?.exercises,
    event?.metrics?.exerciseSummaries,
    event?.metadata?.exerciseSummaries
  ];
  const exercises = candidates.find((candidate) => Array.isArray(candidate));
  if (!exercises) return [];
  const unit = event?.metadata?.unit || event?.metrics?.unit || '';
  return exercises.slice(0, 50).map((exercise, index) => {
    const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
    return {
      name: String(exercise?.name || exercise?.exerciseName || `Exercise ${index + 1}`),
      sets: sets.slice(0, 25).map((set, setIndex) => formatWorkoutSet(set, setIndex, unit))
    };
  });
}

function formatWorkoutSet(set, index, unit) {
  if (set == null) return `Set ${index + 1}`;
  if (typeof set !== 'object') return String(set);
  const weight = set.weight ?? set.load;
  const reps = set.reps ?? set.repetitions;
  const rpe = set.rpe;
  const parts = [];
  if (weight !== undefined && weight !== '') parts.push(`${weight}${unit ? ` ${unit}` : ''}`);
  if (reps !== undefined && reps !== '') parts.push(`${reps} reps`);
  if (rpe !== undefined && rpe !== '') parts.push(`RPE ${rpe}`);
  return parts.length ? parts.join(' · ') : `Set ${index + 1}`;
}

function buildHumanDetailRows(event) {
  const rows = [];
  const seen = new Set();
  function visit(value, prefix = '', depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2 || rows.length >= 18) return;
    Object.entries(value).forEach(([key, child]) => {
      if (rows.length >= 18 || HIDDEN_DETAIL_KEY.test(key)) return;
      const label = prefix ? `${prefix} · ${humanize(key)}` : humanize(key);
      if (child == null || child === '') return;
      if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
        if (seen.has(label)) return;
        seen.add(label);
        rows.push({ label, value: String(child).slice(0, 300) });
        return;
      }
      if (Array.isArray(child)) {
        const primitives = child.filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
        if (primitives.length && primitives.length === child.length && !seen.has(label)) {
          seen.add(label);
          rows.push({ label, value: primitives.join(', ').slice(0, 300) });
        }
        return;
      }
      visit(child, label, depth + 1);
    });
  }
  visit(event?.metrics, 'Metric');
  visit(event?.metadata, 'Detail');
  return rows;
}

function LoadingState({ label }) {
  return <p className="activity-state" role="status">{label}</p>;
}

function EmptyState({ children }) {
  return <p className="activity-state">{children}</p>;
}

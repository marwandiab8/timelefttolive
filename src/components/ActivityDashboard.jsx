import { useMemo, useState } from 'react';
import { useConnectedSources, useLifeEvents } from '../hooks/useCalendar.js';
import {
  buildActivityBreakdown,
  buildDailyInsight,
  formatDuration,
  getDailySummary,
  getDonutBackground,
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

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit'
});

export default function ActivityDashboard({ calendar, onBack }) {
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateId());
  const [theme, setTheme] = useState(() => (localStorage.getItem('activityDashboardTheme') === 'light' ? 'light' : 'dark'));
  const dayBounds = useMemo(() => getLocalDayBounds(selectedDate), [selectedDate]);
  const lifeEventState = useLifeEvents(calendar.id, dayBounds?.start, dayBounds?.end, Boolean(dayBounds));
  const sourceState = useConnectedSources(calendar.id);
  const summary = useMemo(() => getDailySummary(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const breakdown = useMemo(() => buildActivityBreakdown(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const timeline = useMemo(() => sortLifeEvents(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const insight = useMemo(() => buildDailyInsight(lifeEventState.lifeEvents), [lifeEventState.lifeEvents]);
  const error = lifeEventState.error || sourceState.error;

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

  const activeConnections = sourceState.connections.filter((connection) => connection.status === 'active').length;

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

      <div className="activity-main-grid">
        <section className="activity-card activity-donut-card">
          <SectionHeading eyebrow="Daily mix" title="Activity donut" />
          {lifeEventState.loading ? (
            <LoadingState label="Loading activity mix…" />
          ) : breakdown.length === 0 ? (
            <EmptyState>No activity categories were recorded for this day.</EmptyState>
          ) : (
            <div className="activity-donut-layout">
              <div
                className="activity-donut"
                role="img"
                aria-label={`Activity distribution across ${breakdown.length} categories`}
                style={{ background: getDonutBackground(breakdown) }}
              >
                <div>
                  <strong>{summary.eventCount}</strong>
                  <span>{summary.eventCount === 1 ? 'event' : 'events'}</span>
                </div>
              </div>
              <div className="activity-legend">
                {breakdown.map((item) => (
                  <div key={item.label}>
                    <i style={{ background: item.color }} />
                    <span>{item.label}</span>
                    <strong>{item.usesDuration ? formatDuration(item.seconds) : item.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="activity-card activity-timeline-card">
          <SectionHeading eyebrow="Chronological record" title="Daily Life Event timeline" />
          {lifeEventState.loading ? (
            <LoadingState label="Loading the daily timeline…" />
          ) : timeline.length === 0 ? (
            <EmptyState>No canonical life events were recorded on this day.</EmptyState>
          ) : (
            <ol className="activity-timeline">
              {timeline.map((event) => <TimelineEvent event={event} key={event.id} />)}
            </ol>
          )}
        </section>
      </div>

      <div className="activity-bottom-grid">
        <section className="activity-card">
          <SectionHeading
            eyebrow={sourceState.loading ? 'Checking connections' : `${activeConnections} active of ${sourceState.connections.length}`}
            title="Connected-source status"
          />
          {sourceState.loading ? (
            <LoadingState label="Loading connected sources…" />
          ) : sourceState.connections.length === 0 ? (
            <EmptyState>No connected sources are registered for this calendar yet.</EmptyState>
          ) : (
            <div className="activity-source-list">
              {sourceState.connections.map((connection) => <SourceStatus connection={connection} key={connection.id} />)}
            </div>
          )}
        </section>

        <section className="activity-card activity-insight-card">
          <SectionHeading eyebrow="Your day at a glance" title="Daily insight" />
          {lifeEventState.loading ? <LoadingState label="Building today’s insight…" /> : <p>{insight}</p>}
        </section>
      </div>
    </main>
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

function TimelineEvent({ event }) {
  const time = getEventTime(event);
  const duration = Number(event.durationSeconds);
  return (
    <li>
      <time dateTime={time?.toISOString()}>{time ? TIME_FORMAT.format(time) : 'Time unavailable'}</time>
      <div>
        <strong>{event.title || event.eventType || 'Life event'}</strong>
        <p>{event.sourceApp || 'Unknown source'} · {(event.activityFamily || event.eventClass || event.eventType || 'Activity').replace(/[_-]+/g, ' ')}</p>
      </div>
      {Number.isFinite(duration) && duration > 0 && <span>{formatDuration(duration)}</span>}
    </li>
  );
}

function SourceStatus({ connection }) {
  const status = connection.status || 'unknown';
  const statusClass = ['active', 'paused', 'error', 'revoked'].includes(status) ? status : 'unknown';
  const lastSynced = toJsDate(connection.lastSyncedAt);
  return (
    <article>
      <i className={`activity-status-dot ${statusClass}`} />
      <div>
        <strong>{connection.sourceApp || 'Connected source'}</strong>
        <p>{connection.sourceFirebaseProjectId || connection.integrationId || 'Connection registered'}</p>
      </div>
      <span>
        {status}
        <small>{lastSynced ? `Last sync ${lastSynced.toLocaleString()}` : 'No sync reported'}</small>
      </span>
    </article>
  );
}

function LoadingState({ label }) {
  return <p className="activity-state" role="status">{label}</p>;
}

function EmptyState({ children }) {
  return <p className="activity-state">{children}</p>;
}

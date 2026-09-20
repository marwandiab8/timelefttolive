import DayDetailView from './DayDetailView.jsx';
import {
  eventIntersectsDate,
  eventIntersectsMonth,
  eventIntersectsWeek,
  formatDateId,
  getDaysForWeekRange,
  getLifeYearRange,
  getMonthsForLifeYear,
  getWeeksForRange,
  isCurrentWeek,
  isDateInRange,
  parseDateId
} from '../utils/dateUtils.js';
import { buildWedgeGradient, isSafeColor, pickWeekWedges } from '../utils/eventWedges.js';
import { useRangeEntries } from '../hooks/useCalendar.js';
import { useRangeExternalItems } from '../services/externalSources/externalDailyItems.js';

export function YearDetailView({ calendar, age, events, role, onNavigate }) {
  const lifeYear = getLifeYearRange(calendar.birthDate, age);
  const months = getMonthsForLifeYear(calendar.birthDate, age);
  const entryState = useRangeEntries(calendar.id, formatDateId(lifeYear.start), formatDateId(lifeYear.end), role);
  const externalState = useRangeExternalItems(calendar.id, formatDateId(lifeYear.start), formatDateId(lifeYear.end), role, calendar.ownerUid);

  return (
    <section className="detail-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Life year</p>
          <h2>Age {age}</h2>
          <p className="muted">{formatDateId(lifeYear.start)} to {formatDateId(lifeYear.end)}</p>
        </div>
      </div>
      {(entryState.error || externalState.error) && <p className="error">{entryState.error || externalState.error}</p>}
      <div className="month-grid">
        {months.map((month) => {
          const monthEvents = events.filter((event) => eventIntersectsMonth(event, month.rangeStart, month.rangeEnd));
          const monthEntries = entryState.entries.filter((entry) => isDateInRange(entry.dateId, month.rangeStart, month.rangeEnd));
          const monthExternal = externalState.items.filter((item) => isDateInRange(item.dateId, month.rangeStart, month.rangeEnd));
          const hasJournal = monthEntries.some((entry) => entry.journalText || entry.notes);
          return (
            <button className="month-card" key={month.id} type="button" onClick={() => onNavigate({ view: 'month', age, monthId: month.id })}>
              <span className="eyebrow">{month.name}</span>
              <strong>{formatDateId(month.rangeStart)} to {formatDateId(month.rangeEnd)}</strong>
              <span>{count(monthEvents.length, 'event')}{monthExternal.length > 0 ? `, ${count(monthExternal.length, 'linked item')}` : ''}</span>
              <span>{hasJournal ? 'Journal activity' : 'No journal entries'}</span>
              <span className="mini-strip">
                {Array.from({ length: 12 }, (_, index) => <i key={index} className={index < monthEntries.length ? 'active' : ''} />)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function MonthDetailView({ calendar, age, monthId, events, role, onNavigate }) {
  const selectedMonth = getMonthsForLifeYear(calendar.birthDate, age).find((month) => month.id === monthId);
  const monthStart = selectedMonth?.rangeStart || parseDateId(monthId);
  const monthEnd = selectedMonth?.rangeEnd || monthStart;
  const weeks = getWeeksForRange(monthStart, monthEnd);
  const entryState = useRangeEntries(calendar.id, formatDateId(monthStart), formatDateId(monthEnd), role);
  const externalState = useRangeExternalItems(calendar.id, formatDateId(monthStart), formatDateId(monthEnd), role, calendar.ownerUid);

  return (
    <section className="detail-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Month</p>
          <h2>{monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <p className="muted">Age {age} · {formatDateId(monthStart)} to {formatDateId(monthEnd)}</p>
        </div>
      </div>
      {(entryState.error || externalState.error) && <p className="error">{entryState.error || externalState.error}</p>}
      <div className="week-card-grid">
        {weeks.map((week) => {
          const weekEvents = events.filter((event) => eventIntersectsWeek(event, week));
          const weekEntries = entryState.entries.filter((entry) => isDateInRange(entry.dateId, week.start, week.end));
          const weekExternal = externalState.items.filter((item) => isDateInRange(item.dateId, week.start, week.end));
          const current = isCurrentWeek(week);
          return (
            <button
              className={`drill-card week-nav-card ${current ? 'current' : ''}`}
              key={week.dateId}
              type="button"
              aria-label={`Week of ${formatDateId(week.start)}`}
              onClick={() => onNavigate({ view: 'week', age, monthId, weekStart: week.dateId, weekEnd: formatDateId(week.end) })}
            >
              <span className="drill-card-head">
                <strong>{shortDate(week.start)} to {shortDate(week.end)}</strong>
                {current && <span className="today-badge">This week</span>}
              </span>
              <WeekStrip days={week.days} events={events} monthStart={monthStart} monthEnd={monthEnd} />
              <span className="drill-card-foot">
                <span>{weekEvents.length ? count(weekEvents.length, 'event') : 'No events'}</span>
                {weekEntries.length > 0 && <span>{count(weekEntries.length, 'saved day')}</span>}
                {weekExternal.length > 0 && <span>{count(weekExternal.length, 'linked item')}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WeekDetailView({ calendar, age, monthId, weekStart, weekEnd, events, role, onNavigate }) {
  // The heatmap's weeks start on the birth date's weekday, so use the exact days of
  // the week that was opened instead of snapping to Sunday.
  const days = getDaysForWeekRange(weekStart, weekEnd);
  const startId = formatDateId(days[0]);
  const endId = formatDateId(days.at(-1));
  const todayId = formatDateId(new Date());
  const entryState = useRangeEntries(calendar.id, startId, endId, role);
  const externalState = useRangeExternalItems(calendar.id, startId, endId, role, calendar.ownerUid);

  return (
    <section className="detail-surface">
      <div className="section-heading">
        <div>
          <h2>{shortDate(days[0])} to {shortDate(days.at(-1), true)}</h2>
          <p className="muted">{startId} to {endId}</p>
        </div>
      </div>
      {(entryState.error || externalState.error) && <p className="error">{entryState.error || externalState.error}</p>}
      <div className="day-card-grid">
        {days.map((day) => {
          const dateId = formatDateId(day);
          const dayEvents = events.filter((event) => eventIntersectsDate(event, dateId));
          const entry = entryState.entries.find((item) => item.dateId === dateId);
          const dayExternal = externalState.items.filter((item) => item.dateId === dateId);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const isToday = dateId === todayId;
          return (
            <button
              className={`drill-card day-nav-card ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`}
              key={dateId}
              type="button"
              onClick={() => onNavigate({ view: 'day', age, monthId, weekStart, weekEnd, dateId })}
            >
              <span className="drill-card-head">
                <strong>{day.toLocaleDateString(undefined, { weekday: 'long' })}</strong>
                {isToday && <span className="today-badge">Today</span>}
              </span>
              <time className="drill-card-date" dateTime={dateId}>{shortDate(day)}</time>
              <EventList events={dayEvents} />
              <span className="drill-card-foot">
                <span>{entry?.journalText || entry?.notes ? 'Journal saved' : 'No journal yet'}</span>
                {dayExternal.length > 0 && <span>{count(dayExternal.length, 'linked item')}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DayDrilldownView(props) {
  return <DayDetailView {...props} />;
}

const DEFAULT_EVENT_COLOR = '#7c9cff';

function shortDate(date, withYear = false) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

function count(value, noun) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

// The week as seven small squares: days with events show the same wedges as the
// life calendar, today is ringed, and days outside the month are dimmed.
function WeekStrip({ days, events, monthStart, monthEnd }) {
  const todayId = formatDateId(new Date());
  return (
    <span className="week-strip" aria-hidden="true">
      {days.map((day) => {
        const dateId = formatDateId(day);
        const { wedges } = pickWeekWedges(events.filter((event) => eventIntersectsDate(event, dateId)), DEFAULT_EVENT_COLOR);
        const outside = day < monthStart || day > monthEnd;
        return (
          <span className={`week-strip-day ${dateId === todayId ? 'today' : ''} ${outside ? 'outside' : ''}`} key={dateId}>
            <small>{day.toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
            <i style={wedges.length ? { background: buildWedgeGradient(wedges.map((wedge) => wedge.color)) } : undefined} />
            <b>{day.getDate()}</b>
          </span>
        );
      })}
    </span>
  );
}

// Up to three events by name, so a day says what is on it, not just how many.
function EventList({ events }) {
  if (!events.length) return <span className="drill-card-empty">No events</span>;
  return (
    <span className="drill-card-events">
      {events.slice(0, 3).map((event) => (
        <span className="drill-card-event" key={event.id}>
          <i style={{ background: isSafeColor(event.color) ? event.color : DEFAULT_EVENT_COLOR }} />
          {event.title || 'Event'}
        </span>
      ))}
      {events.length > 3 && <b>+{events.length - 3} more</b>}
    </span>
  );
}

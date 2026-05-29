import DayDetailView from './DayDetailView.jsx';
import {
  eventIntersectsDate,
  eventIntersectsMonth,
  eventIntersectsWeek,
  formatDateId,
  getDaysForWeek,
  getLifeYearRange,
  getMonthsForLifeYear,
  getWeeksForRange,
  isDateInRange,
  parseDateId
} from '../utils/dateUtils.js';
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
              <span>{monthEvents.length} events · {monthExternal.length} linked items</span>
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
          return (
            <button className="drill-card" key={week.dateId} type="button" onClick={() => onNavigate({ view: 'week', age, monthId, weekStart: week.dateId })}>
              <strong>Week of {formatDateId(week.start)}</strong>
              <span>{formatDateId(week.start)} to {formatDateId(week.end)}</span>
              <span>{week.days.map((day) => day.getDate()).join(' · ')}</span>
              <span>{weekEvents.length} events · {weekEntries.length} saved days · {weekExternal.length} linked items</span>
              <EventDots events={weekEvents} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WeekDetailView({ calendar, age, monthId, weekStart, events, role, onNavigate }) {
  const days = getDaysForWeek(weekStart);
  const startId = formatDateId(days[0]);
  const endId = formatDateId(days.at(-1));
  const entryState = useRangeEntries(calendar.id, startId, endId, role);
  const externalState = useRangeExternalItems(calendar.id, startId, endId, role, calendar.ownerUid);

  return (
    <section className="detail-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Week</p>
          <h2>{startId} to {endId}</h2>
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
          return (
            <button className={`drill-card day-nav-card ${isWeekend ? 'weekend' : ''}`} key={dateId} type="button" onClick={() => onNavigate({ view: 'day', age, monthId, weekStart, dateId })}>
              <strong>{day.toLocaleDateString(undefined, { weekday: 'long' })}</strong>
              <span>{dateId}</span>
              <span>{dayEvents.length} events · {dayExternal.length} linked items</span>
              <span>{entry?.journalText || entry?.notes ? 'Journal saved' : 'No journal yet'}</span>
              <EventDots events={dayEvents} />
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

function EventDots({ events }) {
  return (
    <span className="event-dot-row">
      {events.slice(0, 5).map((event) => <i key={event.id} style={{ background: event.color }} />)}
      {events.length > 5 && <b>+{events.length - 5}</b>}
    </span>
  );
}

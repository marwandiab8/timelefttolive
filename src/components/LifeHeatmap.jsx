import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import {
  eventIntersectsWeek,
  formatDateId,
  getLifeYearsWeeks,
  isCurrentWeek
} from '../utils/dateUtils.js';

const LifeHeatmap = forwardRef(function LifeHeatmap({ calendar, events, onSelectWeek }, ref) {
  const rows = useMemo(() => getLifeYearsWeeks(calendar.birthDate, calendar.targetAge), [calendar.birthDate, calendar.targetAge]);
  const cellRefs = useRef(new Map());
  const settings = calendar.settings || {};

  useImperativeHandle(ref, () => ({
    scrollToCurrentWeek() {
      const current = rows.flatMap((row) => row.weeks).find((week) => isCurrentWeek(week));
      const element = current && cellRefs.current.get(current.dateId);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      element?.classList.add('pulse');
      setTimeout(() => element?.classList.remove('pulse'), 1400);
    }
  }), [rows]);

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
      <div className="heatmap-scroll">
        <div className="heatmap">
          {rows.map((row) => (
            <div className="year-row" key={row.age}>
              <div className="year-label">{row.label}</div>
              <div className="week-row">
                {row.weeks.map((week) => {
                  const state = getWeekState(week);
                  const weekEvents = events.filter((event) => eventIntersectsWeek(event, week));
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

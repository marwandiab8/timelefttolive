import { useMemo } from 'react';
import { useLifeEventsOnDays, useWeekAttachments, useWeekEntries } from '../hooks/useCalendar.js';
import { buildPeriodAnalysis, getLocalDayBounds } from '../utils/lifeEventUtils.js';
import { buildOnThisDay, onThisDayDates, onThisDayHeadline } from '../utils/onThisDay.js';

/** The years that had something on this day, as one line that opens into a short list. Nothing shows when none did. */
export function OnThisDayList({ groups, onOpenDay }) {
  const headline = onThisDayHeadline(groups);
  if (!headline) return null;
  return (
    <details className="on-this-day">
      <summary>{headline}</summary>
      <div className="on-this-day-years">
        {groups.map((group) => (
          <section key={group.dateId} aria-label={group.heading}>
            <h3>
              {onOpenDay
                ? <button className="on-this-day-open" type="button" onClick={() => onOpenDay(group.dateId)}>{group.heading}</button>
                : group.heading}
            </h3>
            <ul>
              {group.items.map((item, index) => <li key={`${item.kind}-${index}`} className={`on-this-day-${item.kind}`}>{item.text}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * "On this day": what happened 1, 2, 5 and 10 years ago today, from day notes, calendar events, saved photos and
 * files, that week's review and (for the owner) tracked activity. A viewer sees only what is shared with viewers.
 */
export default function OnThisDay({ calendar, today, role, events, reviews, onOpenDay }) {
  const dateIds = useMemo(() => onThisDayDates(today, { birthDate: calendar.birthDate }).map((day) => day.dateId), [today, calendar.birthDate]);
  const { entries } = useWeekEntries(calendar.id, dateIds, role);
  const { attachments } = useWeekAttachments(calendar.id, dateIds, role);
  const { byDay } = useLifeEventsOnDays(calendar.id, dateIds, role === 'owner');

  const groups = useMemo(() => {
    const activity = Object.fromEntries(Object.entries(byDay).map(([dateId, dayEvents]) => [
      dateId,
      buildPeriodAnalysis(dayEvents, getLocalDayBounds(dateId), { includeActive: false }).categories
    ]));
    return buildOnThisDay({ todayId: today, birthDate: calendar.birthDate, events, entries, attachments, reviews, activity });
  }, [attachments, byDay, calendar.birthDate, entries, events, reviews, today]);

  return <OnThisDayList groups={groups} onOpenDay={onOpenDay} />;
}

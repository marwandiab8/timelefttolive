import { currentGrade, gradeLabel } from '../utils/childInfo.js';
import { getCustodyStats } from '../utils/custodyUtils.js';
import { getAge, parseDateId } from '../utils/dateUtils.js';

const number = (value) => Number(value).toLocaleString();
const dayLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dateLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Who has the kids now, in words, kept apart from the markup so it can be tested. The profile form uses it too, to
 * show what the start date it is given works out to.
 */
export function describeCustodyStatus(status, day = dayLabel) {
  if (!status) return null;
  if (status.always) return { headline: 'With you every week', sentence: '' };
  if (status.withYou) {
    return {
      headline: 'With you this week',
      sentence: `${day(status.start)} to ${day(status.end)}. They go to their other parent ${day(status.changeDate)} and are back with you ${day(status.nextStart)}.`
    };
  }
  return {
    headline: 'With their other parent this week',
    sentence: `Until ${day(status.end)}. Back with you ${day(status.changeDate)}.`
  };
}

/** One child's card: who they are, what's noted about them, and, if they are on the schedule, the time left. */
export function describeChild(child, time, untilAge, now, date = dateLabel) {
  const meta = [
    child.birthDate ? `Age ${getAge(child.birthDate, now)}` : '',
    gradeLabel(currentGrade(child, now)),
    child.school || ''
  ].filter(Boolean);
  let weeks = null;
  if (time && parseDateId(time.untilDate) <= now) {
    weeks = { number: '0', unit: 'weeks left with you', note: `Turned ${untilAge} on ${date(time.untilDate)}.` };
  } else if (time) {
    weeks = {
      number: number(time.weeksRemaining),
      unit: time.weeksRemaining === 1 ? 'week left with you' : 'weeks left with you',
      note: `${number(time.daysRemaining)} ${time.daysRemaining === 1 ? 'day' : 'days'}, until ${untilAge} on ${date(time.untilDate)}.`
    };
  }
  return {
    id: child.id,
    name: child.name || 'Unnamed child',
    meta,
    weeks,
    details: (child.details || []).filter((detail) => detail.label || detail.value)
  };
}

export default function FamilyTimePanel({ calendar, today, canEdit, onEdit }) {
  const now = parseDateId(today);
  const stats = getCustodyStats(calendar, now);
  const status = describeCustodyStatus(stats?.status);
  const times = new Map((stats?.children || []).map((time) => [time.id, time]));
  const children = (calendar.children || []).map((child) => describeChild(child, times.get(child.id), stats?.untilAge, now));

  return (
    <section className="family-time-panel" aria-label="Time with my boys">
      <div className="family-time-head">
        <div>
          <p className="family-time-label">Time with my boys</p>
          {status && <h2>{status.headline}</h2>}
          {status?.sentence && <p className="muted">{status.sentence}</p>}
        </div>
        {canEdit && <button className="secondary" type="button" onClick={onEdit}>Edit kids and schedule</button>}
      </div>
      <ul className="kid-cards">
        {children.map((child) => (
          <li className="kid-card" key={child.id}>
            <h3>{child.name}</h3>
            {child.meta.length > 0 && <p className="kid-meta">{child.meta.join(' · ')}</p>}
            {child.weeks && (
              <>
                <p className="kid-weeks"><strong>{child.weeks.number}</strong> {child.weeks.unit}</p>
                <p className="kid-note">{child.weeks.note}</p>
              </>
            )}
            {child.details.length > 0 && (
              <dl className="kid-details">
                {child.details.map((detail) => (
                  <div key={detail.id}>
                    {detail.label && <dt>{detail.label}</dt>}
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

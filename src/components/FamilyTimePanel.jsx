import { currentGrade, gradeLabel } from '../utils/childInfo.js';
import { defaultCustodySchedule, getCustodyStats, getCustodyWeekStatus } from '../utils/custodyUtils.js';
import { formatDateId, getAge, parseDateId } from '../utils/dateUtils.js';
import { getChildAhead, getNextBirthday } from '../utils/whatsLeft.js';

const number = (value) => Number(value).toLocaleString();
const counted = (count, one, many) => `${number(count)}\u00a0${count === 1 ? one : many}`;
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

/**
 * One child's card: who they are, what's noted about them, what is still ahead before `untilAge`, their next birthday
 * (and whose week it falls in, when `custody` is given), and, if they are on the schedule, the time left with you.
 */
export function describeChild(child, { time, untilAge, custody }, now, date = dateLabel) {
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
  let ahead = '';
  let nextBirthday = '';
  if (child.birthDate) {
    if (getAge(child.birthDate, now) < untilAge) {
      const left = getChildAhead(child, untilAge, now);
      ahead = `Before ${untilAge}: ${counted(left.summers, 'summer', 'summers')} · ${counted(left.christmases, 'Christmas', 'Christmases')} · ${counted(left.birthdays, 'birthday', 'birthdays')}`;
    }
    const birthday = getNextBirthday(child.birthDate, now);
    const when = birthday.dateId === formatDateId(now) ? 'today' : `on ${date(birthday.dateId)}`;
    const status = custody ? getCustodyWeekStatus(custody, parseDateId(birthday.dateId)) : null;
    const week = status ? (status.withYou ? ', in your week' : ", in their other parent's week") : '';
    nextBirthday = `Turns ${birthday.age} ${when}${week}.`;
  }
  return {
    id: child.id,
    name: child.name || 'Unnamed child',
    meta,
    ahead,
    nextBirthday,
    weeks,
    details: (child.details || []).filter((detail) => detail.label || detail.value)
  };
}

export default function FamilyTimePanel({ calendar, today, canEdit, onEdit }) {
  const now = parseDateId(today);
  const stats = getCustodyStats(calendar, now);
  const status = describeCustodyStatus(stats?.status);
  const times = new Map((stats?.children || []).map((time) => [time.id, time]));
  const untilAge = Number(calendar.custodySchedule?.countUntilChildAge || defaultCustodySchedule.countUntilChildAge);
  const children = (calendar.children || []).map((child) => describeChild(child, {
    time: times.get(child.id),
    untilAge,
    custody: times.has(child.id) ? calendar.custodySchedule : null
  }, now));

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
            {(child.ahead || child.nextBirthday) && (
              <p className="kid-ahead">
                {child.ahead}
                {child.ahead && child.nextBirthday && <br />}
                {child.nextBirthday}
              </p>
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

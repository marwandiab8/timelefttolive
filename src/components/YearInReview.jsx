import { useMemo } from 'react';
import { useLifeEvents, useRangeEntries } from '../hooks/useCalendar.js';
import { buildPeriodAnalysis, formatDuration } from '../utils/lifeEventUtils.js';
import { KIDS_COLOR, RATING_COLORS } from '../utils/livedWeeks.js';
import { RATINGS, lifeWeekBounds, ratingLabel } from '../utils/weeklyReview.js';
import { buildYearInReview, summarizeYearActivity, yearHeadline } from '../utils/yearInReview.js';

// Activity that started the evening before the year (a night's sleep) still counts on its first morning.
const PADDING_MS = 36 * 3600 * 1000;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The year's 52 squares, coloured by rating, with a band under each for the days with the boys. */
function WeekStrip({ weeks, showKids }) {
  const size = 12;
  const gap = 2;
  const height = showKids ? size + 7 : size;
  const rated = weeks.filter((week) => week.rating).length;
  return (
    <svg
      className="year-review-strip"
      viewBox={`0 0 ${weeks.length * (size + gap) - gap} ${height}`}
      role="img"
      aria-label={`${plural(weeks.filter((week) => week.lived).length, 'week')} lived, ${rated} rated`}
    >
      {weeks.map((week, index) => {
        const x = index * (size + gap);
        return (
          <g key={week.start}>
            <rect
              x={x}
              y={0}
              width={size}
              height={size}
              rx={2}
              className={week.lived ? (week.rating ? 'rated' : 'lived') : 'ahead'}
              style={week.rating ? { fill: RATING_COLORS[week.rating] } : undefined}
            >
              <title>{`Week of ${week.start}${week.rating ? `: ${ratingLabel(week.rating).toLowerCase()}` : ''}${week.daysWithKids ? `, ${plural(week.daysWithKids, 'day')} with the boys` : ''}`}</title>
            </rect>
            {showKids && week.daysWithKids > 0 && (
              <rect x={x} y={size + 3} width={size} height={4} rx={1} style={{ fill: KIDS_COLOR, opacity: 0.35 + (week.daysWithKids / 7) * 0.65 }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** How many weeks got each rating, best at the top. */
function RatingBars({ counts }) {
  const max = Math.max(1, ...Object.values(counts));
  const rows = [...RATINGS].reverse();
  const row = 18;
  return (
    <svg className="year-review-bars" viewBox={`0 0 300 ${rows.length * row}`} role="img" aria-label={rows.map((rating) => `${rating.label}: ${counts[rating.value]}`).join(', ')}>
      {rows.map((rating, index) => {
        const y = index * row;
        const width = (counts[rating.value] / max) * 200;
        return (
          <g key={rating.value}>
            <text x={0} y={y + 12} className="year-review-bar-label">{rating.label}</text>
            <rect x={56} y={y + 3} width={Math.max(width, counts[rating.value] ? 3 : 0)} height={11} rx={2} style={{ fill: RATING_COLORS[rating.value] }} />
            <text x={56 + width + 6} y={y + 12} className="year-review-bar-count">{counts[rating.value]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The page itself, from a buildYearInReview result. `onOpenWeek(weekStart)` opens a week; `onPrint` prints. */
export function YearInReviewPage({ review, onOpenWeek, onPrint }) {
  const { ratings, kids, activity } = review;
  const showKids = Boolean(kids);
  return (
    <section className="detail-surface year-review">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Year in review</p>
          <h2>{review.title}</h2>
          <p className="muted">{review.range}{review.soFar ? ' · so far' : ''}</p>
        </div>
        {onPrint && !review.future && <button className="secondary year-review-print" type="button" onClick={onPrint}>Print</button>}
      </div>
      <p className="year-review-headline">{yearHeadline(review)}</p>

      {!review.future && (
        <>
          <section className="year-review-section" aria-labelledby="year-review-weeks">
            <h3 id="year-review-weeks">The weeks</h3>
            <WeekStrip weeks={review.weeks} showKids={showKids} />
            <ul className="year-review-legend">
              {RATINGS.map((rating) => <li key={rating.value}><i style={{ background: RATING_COLORS[rating.value] }} />{rating.label}</li>)}
              <li><i className="lived" />Not rated</li>
              {showKids && <li><i style={{ background: KIDS_COLOR }} />With the boys</li>}
            </ul>
            {ratings.rated > 0 ? (
              <div className="year-review-ratings">
                <RatingBars counts={ratings.counts} />
                <p>
                  {plural(ratings.reviewed, 'week')} reviewed of {review.livedWeekCount}.
                  {ratings.average ? ` On average ${ratingLabel(Math.round(ratings.average)).toLowerCase()} (${ratings.average} of 5).` : ''}
                  {ratings.intentions.set ? ` Intentions kept: ${ratings.intentions.yes} of ${ratings.intentions.set}${ratings.intentions.partly ? `, ${ratings.intentions.partly} partly` : ''}.` : ''}
                </p>
              </div>
            ) : <p className="muted">No weeks rated this year.</p>}
          </section>

          {review.bestWeeks.length > 0 && (
            <section className="year-review-section" aria-labelledby="year-review-best">
              <h3 id="year-review-best">Best weeks</h3>
              <ul className="year-review-list">
                {review.bestWeeks.map((week) => (
                  <li key={week.start}>
                    {onOpenWeek
                      ? <button type="button" className="year-review-link" onClick={() => onOpenWeek(week.start)}>{week.label}</button>
                      : <span className="year-review-when">{week.label}</span>}
                    <span>{week.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {kids && (
            <section className="year-review-section" aria-labelledby="year-review-kids">
              <h3 id="year-review-kids">With the boys</h3>
              <p>{kids.days ? `${kids.days} of ${plural(kids.of, 'day')}${kids.scheduleBegan ? ' since the schedule began' : ''}${review.soFar ? ' so far' : ''}.` : 'No days with the boys on the schedule this year.'}</p>
            </section>
          )}

          {review.done.length > 0 && (
            <section className="year-review-section" aria-labelledby="year-review-done">
              <h3 id="year-review-done">Done</h3>
              <ul className="year-review-list">
                {review.done.map((plan) => <li key={`${plan.title}-${plan.doneOn}`}><span className="year-review-when">{plan.when}</span><span>{plan.title}</span></li>)}
              </ul>
            </section>
          )}

          {(review.events.count > 0 || review.writtenDays > 0) && (
            <section className="year-review-section" aria-labelledby="year-review-events">
              <h3 id="year-review-events">What happened</h3>
              {review.writtenDays > 0 && <p>Something written down on {plural(review.writtenDays, 'day')}.</p>}
              {review.events.named.length > 0 && (
                <ul className="year-review-list">
                  {review.events.named.map((event) => <li key={`${event.title}-${event.startDate}`}><span className="year-review-when">{event.when}</span><span>{event.title}</span></li>)}
                </ul>
              )}
              {review.events.count > review.events.named.length && <p className="muted">And {plural(review.events.count - review.events.named.length, 'more event')}.</p>}
            </section>
          )}

          {review.heights.length > 0 && (
            <section className="year-review-section" aria-labelledby="year-review-heights">
              <h3 id="year-review-heights">Growing</h3>
              <ul className="year-review-list">
                {review.heights.map((child) => (
                  <li key={child.childId}>
                    <span className="year-review-when">{child.name}</span>
                    <span>{child.latest} on {child.latestOn}{child.change ? ` (${child.change} since ${child.since})` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activity && (
            <section className="year-review-section" aria-labelledby="year-review-activity">
              <h3 id="year-review-activity">Tracked time</h3>
              <p>{formatDuration(activity.trackedSeconds)} tracked in all.</p>
              <ul className="year-review-activity">
                {activity.categories.map((category) => (
                  <li key={category.label}>
                    <span className="year-review-swatch" style={{ background: category.color || 'var(--card-accent)' }} />
                    <strong>{category.label}</strong>
                    <span>{formatDuration(category.seconds)}</span>
                    <span className="muted">{plural(category.sessions, 'session')} on {plural(category.days, 'day')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Year in review for life year `age`, from what the reader can see: a viewer gets only what's shared with viewers,
 * and no tracked time.
 */
export default function YearInReview({ calendar, age, today, role, events, reviews, plans, measurements, onOpenWeek }) {
  const base = useMemo(() => buildYearInReview({ calendar, age, today }), [calendar, age, today]);
  const lastDay = base.soFar ? today : base.end;
  const bounds = useMemo(() => (base.future ? null : lifeWeekBounds({ start: base.start, end: lastDay })), [base.future, base.start, lastDay]);
  const entryState = useRangeEntries(calendar.id, base.start, lastDay, role);
  const activityState = useLifeEvents(
    calendar.id,
    bounds ? new Date(bounds.start.getTime() - PADDING_MS) : null,
    bounds ? new Date(bounds.end.getTime() + PADDING_MS) : null,
    role === 'owner' && Boolean(bounds)
  );
  const activity = useMemo(
    () => (role === 'owner' && bounds && activityState.lifeEvents.length ? summarizeYearActivity(buildPeriodAnalysis(activityState.lifeEvents, bounds, { includeActive: false })) : null),
    [activityState.lifeEvents, bounds, role]
  );
  const review = useMemo(() => buildYearInReview({
    calendar, age, today, reviews, events, entries: entryState.entries, plans, measurements, activity
  }), [calendar, age, today, reviews, events, entryState.entries, plans, measurements, activity]);
  const error = entryState.error || activityState.error;

  return (
    <>
      {error && <p className="error">{error}</p>}
      {role === 'owner' && activityState.loading && <p className="muted year-review-loading">Adding up the year’s tracked time…</p>}
      <YearInReviewPage review={review} onOpenWeek={onOpenWeek} onPrint={() => window.print()} />
    </>
  );
}

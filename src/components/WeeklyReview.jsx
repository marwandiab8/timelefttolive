import { useEffect, useMemo, useState } from 'react';
import { saveWeeklyReview, useLifeEvents, useRangeEntries } from '../hooks/useCalendar.js';
import { isJournalOrMediaLifeEvent } from '../services/activityJournal.js';
import { buildPeriodAnalysis, getDateIdInTimezone, getEventTime } from '../utils/lifeEventUtils.js';
import {
  INTENTION_OUTCOMES,
  RATINGS,
  buildReviewDocument,
  carriedIntention,
  describeWeekNumbers,
  isReviewEmpty,
  lifeWeekFor,
  lifeWeekBounds,
  previousLifeWeek,
  ratingLabel,
  reviewDue,
  reviewStreak,
  summarizeWeek,
  weekRangeLabel
} from '../utils/weeklyReview.js';

const SKIPPED_KEY = 'weeklyReviewSkipped';
const PADDING_MS = 36 * 3600 * 1000;

function readSkipped() {
  try {
    const value = JSON.parse(localStorage.getItem(SKIPPED_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeSkipped(weekStart) {
  const next = [...readSkipped().filter((start) => start !== weekStart), weekStart].slice(-12);
  try {
    localStorage.setItem(SKIPPED_KEY, JSON.stringify(next));
  } catch {
    // A private window: the card comes back on reload, which is fine.
  }
  return next;
}

/**
 * What the card says, kept apart from the markup so it can be tested: a prompt when a week is waiting for its review,
 * otherwise the intention you're carrying this week and how many weeks in a row you've reviewed.
 */
export function describeReviewCard({ birthDate, today, reviews, skipped }) {
  const due = reviewDue({ birthDate, today, reviews, skipped });
  if (due) {
    const intention = carriedIntention(birthDate, due.week, reviews);
    return {
      state: 'due',
      week: due.week,
      headline: due.when === 'last' ? 'How was last week?' : 'This week ends today. How was it?',
      lines: [
        weekRangeLabel(due.week, new Date(`${today}T12:00:00`)),
        intention ? `You meant to: ${intention.text}` : ''
      ].filter(Boolean)
    };
  }
  const now = new Date(`${today}T12:00:00`);
  const streakLine = (streak) => `${streak} ${streak === 1 ? 'week' : 'weeks'} reviewed in a row`;
  const current = lifeWeekFor(birthDate, today);
  const thisReview = current && reviews[current.start];
  // This week already reviewed (on its last day): what it was, and what you're taking into the next one.
  if (thisReview) {
    return {
      state: 'done',
      week: current,
      headline: thisReview.intention ? `Next week: ${thisReview.intention}` : `This week was ${ratingLabel(thisReview.rating).toLowerCase() || 'reviewed'}`,
      lines: [streakLine(reviewStreak(birthDate, today, reviews))]
    };
  }
  const last = previousLifeWeek(birthDate, current);
  const lastReview = last && reviews[last.start];
  if (!lastReview) return null; // skipped: nothing to carry
  return {
    state: 'done',
    week: last,
    headline: lastReview.intention ? `This week: ${lastReview.intention}` : `Last week was ${ratingLabel(lastReview.rating).toLowerCase() || 'reviewed'}`,
    lines: [
      lastReview.rating && lastReview.intention ? `Last week, ${weekRangeLabel(last, now)}, was ${ratingLabel(lastReview.rating).toLowerCase()}` : '',
      streakLine(reviewStreak(birthDate, today, reviews))
    ].filter(Boolean)
  };
}

export function WeeklyReviewCard({ calendar, today, reviews, onOpen }) {
  const [skipped, setSkipped] = useState(readSkipped);
  const card = describeReviewCard({ birthDate: calendar.birthDate, today, reviews, skipped });
  if (!card) return null;
  return (
    <section className={`weekly-review-card ${card.state}`} aria-label="Weekly review">
      <div>
        <p className="weekly-review-label">Your week</p>
        <h2>{card.headline}</h2>
        {card.lines.map((line) => <p className="muted" key={line}>{line}</p>)}
      </div>
      <div className="weekly-review-actions">
        {card.state === 'due' ? (
          <>
            <button className="primary" type="button" onClick={() => onOpen(card.week)}>Review the week</button>
            <button className="quiet-button" type="button" onClick={() => setSkipped(writeSkipped(card.week.start))}>Skip</button>
          </>
        ) : (
          card.week && <button className="quiet-button" type="button" onClick={() => onOpen(card.week)}>Edit the review</button>
        )}
        <a className="quiet-button" href="#digest">Sunday digest</a>
      </div>
    </section>
  );
}

/** The week's numbers, live: tracked time and targets from activity, days with the kids, and days with something written. */
function useWeekNumbers(calendar, week) {
  const bounds = useMemo(() => lifeWeekBounds(week), [week]);
  const lifeEventState = useLifeEvents(
    calendar.id,
    bounds ? new Date(bounds.start.getTime() - PADDING_MS) : null,
    bounds ? new Date(bounds.end.getTime() + PADDING_MS) : null,
    Boolean(bounds)
  );
  const entryState = useRangeEntries(calendar.id, week?.start, week?.end, 'owner');
  const numbers = useMemo(() => {
    if (!bounds || lifeEventState.loading) return null;
    const analysis = buildPeriodAnalysis(lifeEventState.lifeEvents, bounds, { includeActive: false, now: new Date() });
    const journalDateIds = [
      ...entryState.entries.filter((entry) => String(entry.notes || entry.journalText || '').trim()).map((entry) => entry.dateId),
      ...lifeEventState.lifeEvents.filter(isJournalOrMediaLifeEvent).map((event) => getDateIdInTimezone(getEventTime(event), bounds.timezone))
    ];
    return summarizeWeek({ analysis, bounds, targets: calendar.activityTargets, custodySchedule: calendar.custodySchedule, week, journalDateIds });
  }, [bounds, calendar.activityTargets, calendar.custodySchedule, entryState.entries, lifeEventState.lifeEvents, lifeEventState.loading, week]);
  return { numbers, error: lifeEventState.error || entryState.error };
}

const formFrom = (review) => ({
  rating: review?.rating || '',
  mattered: review?.mattered || '',
  moment: review?.moment || '',
  intention: review?.intention || '',
  intentionKept: review?.intentionKept || '',
  shareWithViewers: review?.visibility === 'viewers'
});

export function WeeklyReviewDialog({ calendar, week, reviews, onClose }) {
  const existing = reviews[week.start] || null;
  const [form, setForm] = useState(() => formFrom(existing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { numbers, error: loadError } = useWeekNumbers(calendar, week);
  const carried = carriedIntention(calendar.birthDate, week, reviews);
  const lines = describeWeekNumbers(numbers || existing?.numbers);
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isReviewEmpty(form)) return setError('Give the week a rating or a few words first.');
    setSaving(true);
    setError('');
    try {
      await saveWeeklyReview(calendar.id, buildReviewDocument(form, week, numbers || existing?.numbers || null), existing);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="panel modal weekly-review-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-review-title">
        <header className="panel-header">
          <div>
            <p className="weekly-review-label">Week {week.weekIndex + 1} of age {week.age}</p>
            <h2 id="weekly-review-title">{weekRangeLabel(week)}</h2>
          </div>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>

        <ul className="weekly-review-numbers" aria-label="The week in numbers">
          {lines.length ? lines.map((line) => <li key={line}>{line}</li>) : <li className="muted">Counting the week…</li>}
        </ul>
        {loadError && <p className="error">{loadError}</p>}

        <form className="stack" onSubmit={handleSubmit}>
          {carried && (
            <fieldset className="weekly-review-choice">
              <legend>You meant to: {carried.text}</legend>
              <div className="chip-row">
                {INTENTION_OUTCOMES.map((outcome) => (
                  <label className={`choice-chip ${form.intentionKept === outcome.value ? 'selected' : ''}`} key={outcome.value}>
                    <input type="radio" name="intentionKept" value={outcome.value} checked={form.intentionKept === outcome.value} onChange={update('intentionKept')} />
                    {outcome.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="weekly-review-choice">
            <legend>How was the week?</legend>
            <div className="chip-row">
              {RATINGS.map((rating) => (
                <label className={`choice-chip ${Number(form.rating) === rating.value ? 'selected' : ''}`} key={rating.value}>
                  <input type="radio" name="rating" value={rating.value} checked={Number(form.rating) === rating.value} onChange={update('rating')} />
                  {rating.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>What mattered</span>
            <textarea value={form.mattered} onChange={update('mattered')} placeholder="The people, the work, the hours that counted" />
          </label>
          <label className="field">
            <span>One moment to keep</span>
            <textarea value={form.moment} onChange={update('moment')} placeholder="Something you'd want to remember in ten years" />
          </label>
          <label className="field">
            <span>One intention for next week</span>
            <input value={form.intention} onChange={update('intention')} placeholder="Gym three times, call Mom on Sunday…" maxLength={500} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.shareWithViewers} onChange={(event) => setForm({ ...form, shareWithViewers: event.target.checked })} />
            Share this review with viewers
          </label>

          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Save the review'}</button>
            <button className="secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}

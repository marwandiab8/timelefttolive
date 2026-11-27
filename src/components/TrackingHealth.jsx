import { useEffect, useMemo, useState } from 'react';
import { createActivityEntry } from '../services/activityEntries.js';
import { buildTrackingIssues, openIssues } from '../utils/trackingHealth.js';

const DISMISSED_KEY = 'activityIssuesDismissed';

function readDismissed() {
  try {
    const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys) {
  const next = keys.slice(-300);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Not remembered in a private window; it is still hidden for now.
  }
  return next;
}

/** The entry the existing edit dialog expects, for a session that is missing one end. */
export function entryForSession(session) {
  const event = session.startEvent || session.endEvent || session.event || {};
  const at = session.startAt || session.endAt;
  const dateLabel = at ? new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return { event, eventId: event.id, linkedEventId: null, label: session.title || session.category || 'Activity', dateLabel };
}

/**
 * "Needs attention": the gaps in the period on screen, each with one thing to do about it: correct a session that is
 * missing an end, add what's missing on a thinly tracked day, or open the day. "This is fine" hides an item on this
 * device.
 */
export function NeedsAttention({ analysis, bounds, now, onOpenDay, onEditSession, onAdd }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const issues = useMemo(() => openIssues(buildTrackingIssues({ analysis, bounds, now }), dismissed), [analysis, bounds, dismissed, now]);
  if (!issues.length) return null;
  const shown = issues.slice(0, 12);
  return (
    <section className="needs-attention" aria-label="Needs attention">
      <header>
        <p className="cycle-eyebrow">Tracking health</p>
        <h3>Needs attention</h3>
        <span>{issues.length} {issues.length === 1 ? 'thing' : 'things'} in this period</span>
      </header>
      <ul>
        {shown.map((issue) => (
          <li className={issue.kind} key={issue.key}>
            <span>{issue.text}</span>
            <span className="needs-attention-actions">
              {issue.action === 'edit' && <button type="button" onClick={() => onEditSession(entryForSession(issue.session))}>Fix the times</button>}
              {issue.action === 'add' && <button type="button" onClick={() => onAdd(issue.dateId)}>Add what's missing</button>}
              {issue.dateId && <button type="button" onClick={() => onOpenDay(issue.dateId)}>Open the day</button>}
              <button type="button" onClick={() => setDismissed(writeDismissed([...dismissed, issue.key]))}>This is fine</button>
            </span>
          </li>
        ))}
      </ul>
      {issues.length > shown.length && <p className="needs-attention-more">And {issues.length - shown.length} more. A shorter period shows them all.</p>}
    </section>
  );
}

export const MANUAL_CATEGORIES = ['Sleep', 'Work', 'Home', 'Gym/Fitness', 'Reading', 'Meals', 'Transportation', 'Darts', 'Music', 'Other'];

const pad = (value) => String(value).padStart(2, '0');
const localInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The form's opening times: an hour on the day asked for, or the last hour. */
export function defaultTimes(dateId, now = new Date()) {
  if (dateId) return { startAt: `${dateId}T09:00`, endAt: `${dateId}T10:00` };
  const end = new Date(now);
  end.setSeconds(0, 0);
  return { startAt: localInput(new Date(end.getTime() - 3600000)), endAt: localInput(end) };
}

/** Add an activity by hand: what, when, and a note. It is saved as an owner-only life event from "manual". */
export function AddActivityDialog({ calendarId, dateId = '', onCancel, onAdded }) {
  const [form, setForm] = useState(() => ({ category: 'Reading', name: '', title: '', note: '', ...defaultTimes(dateId) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit(event) {
    event.preventDefault();
    const start = form.startAt ? new Date(form.startAt) : null;
    const end = form.endAt ? new Date(form.endAt) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return setError('Give it a start and an end.');
    if (end <= start) return setError('The end has to be after the start.');
    if (form.category === 'Other' && !form.name.trim()) return setError('Give the activity a name.');
    setSaving(true);
    setError('');
    try {
      await createActivityEntry({
        calendarId,
        category: form.category,
        name: form.name,
        title: form.title,
        note: form.note,
        startAt: start.toISOString(),
        endAt: end.toISOString()
      });
      onAdded();
    } catch (err) {
      setError(err?.message || 'Unable to add this activity.');
      setSaving(false);
    }
  }

  return (
    <div className="activity-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="activity-dialog" role="dialog" aria-modal="true" aria-labelledby="add-activity-title">
        <header className="activity-dialog-header">
          <h2 id="add-activity-title">Add an activity</h2>
          <button className="activity-dialog-close" type="button" aria-label="Close" onClick={onCancel}>×</button>
        </header>
        <form onSubmit={submit}>
          <div className="activity-form-grid">
          <label>What
            <select value={form.category} onChange={set('category')}>
              {MANUAL_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          {form.category === 'Other' && <label>Name<input value={form.name} onChange={set('name')} placeholder="Hockey" maxLength={60} /></label>}
          <label>Title (optional)<input value={form.title} onChange={set('title')} placeholder="Dune, chapters 4 to 6" maxLength={200} /></label>
          <label>Started<input type="datetime-local" value={form.startAt} onChange={set('startAt')} /></label>
          <label>Finished<input type="datetime-local" value={form.endAt} onChange={set('endAt')} /></label>
          <label className="wide">Note (optional)<textarea rows="3" value={form.note} onChange={set('note')} maxLength={2000} /></label>
          </div>
          {error && <p className="activity-form-error" role="alert">{error}</p>}
          <div className="activity-dialog-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button className="primary" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add it'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

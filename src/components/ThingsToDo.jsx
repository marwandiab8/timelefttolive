import { useEffect, useState } from 'react';
import { deletePlan, savePlan } from '../hooks/useCalendar.js';
import { parseDateId } from '../utils/dateUtils.js';
import {
  SEASONS,
  buildPlan,
  chancesLeft,
  describeDeadline,
  planForm,
  plansForWeek,
  sortPlans,
  upcomingWeeksWithKids
} from '../utils/thingsToDo.js';

const shortDate = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const whoLabel = (plan, calendar) => {
  const names = (plan.who || []).map((id) => (id === 'me' ? 'You' : calendar.children?.find((child) => child.id === id)?.name)).filter(Boolean);
  return names.join(', ');
};

/** One plan in words, for the list: who, the deadline, the chances left, and the week it's planned for. */
export function describePlan(plan, calendar, today) {
  const chances = chancesLeft(plan, calendar, today);
  return {
    id: plan.id,
    title: plan.title,
    meta: [whoLabel(plan, calendar), describeDeadline(plan, calendar, today, longDate)].filter(Boolean).join(' · '),
    chances: chances?.text || '',
    late: Boolean(chances?.past),
    planned: plan.plannedWeekStart ? `Planned for your week from ${shortDate(plan.plannedWeekStart)}` : '',
    notes: plan.notes || '',
    shared: plan.visibility === 'viewers'
  };
}

export default function ThingsToDo({ calendar, plans, today, canEdit, onAdd, onEdit }) {
  const { open, done } = sortPlans(plans, calendar);
  // The first of your next two stretches with the boys that has something planned in it.
  const nextWeek = upcomingWeeksWithKids(calendar.custodySchedule, today, 2).find((start) => plansForWeek(open, start).length) || null;
  const planned = nextWeek ? plansForWeek(open, nextWeek) : [];
  if (!canEdit && plans.length === 0) return null;

  const markDone = (plan, doneOn) => savePlan(calendar.id, plan.id, buildPlan({ ...planForm(plan, today), doneOn }, calendar));
  const remove = (plan) => window.confirm(`Remove "${plan.title}"? This can't be undone.`) && deletePlan(calendar.id, plan.id);

  return (
    <section className="things-to-do" aria-label="Before it's too late">
      <div className="things-to-do-head">
        <div>
          <p className="things-to-do-label">Before it's too late</p>
          <h2>Things to do</h2>
          <p className="muted">For you and with the boys, and how many chances are left to do them.</p>
        </div>
        {canEdit && <button className="secondary" type="button" onClick={onAdd}>Add something</button>}
      </div>
      {planned.length > 0 && (
        <p className="plans-next-week">
          {nextWeek <= today ? 'This week with the boys' : `Your next week with the boys, from ${shortDate(nextWeek)}`}: {planned.map((plan) => plan.title).join(', ')}
        </p>
      )}
      {open.length === 0 && <p className="muted">Nothing yet. What do you want to do before it's too late?</p>}
      <ul className="plan-list">
        {open.map((plan) => {
          const item = describePlan(plan, calendar, today);
          return (
            <li key={plan.id}>
              <div>
                <strong>{item.title}</strong>
                {item.meta && <span className="plan-meta">{item.meta}{item.shared ? ' · shared' : ''}</span>}
                {item.chances && <span className={`plan-chances ${item.late ? 'late' : ''}`}>{item.chances}</span>}
                {item.planned && <span className="plan-meta">{item.planned}</span>}
                {item.notes && <span className="plan-notes">{item.notes}</span>}
              </div>
              {canEdit && (
                <div className="plan-actions">
                  <button className="secondary" type="button" onClick={() => markDone(plan, today)}>Done</button>
                  <button className="ghost" type="button" onClick={() => onEdit(plan)}>Edit</button>
                  <button className="ghost" type="button" onClick={() => remove(plan)}>Remove</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {done.length > 0 && (
        <details className="plans-done">
          <summary>Done ({done.length})</summary>
          <ul className="plan-list">
            {done.map((plan) => (
              <li key={plan.id}>
                <div>
                  <strong>{plan.title}</strong>
                  <span className="plan-meta">{[whoLabel(plan, calendar), `done ${longDate(plan.doneOn)}`].filter(Boolean).join(' · ')}</span>
                </div>
                {canEdit && (
                  <div className="plan-actions">
                    <button className="ghost" type="button" onClick={() => markDone(plan, '')}>Not done</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Add or edit one thing to do. Owner only. */
export function PlanDialog({ calendar, plan = null, today, onClose }) {
  const [form, setForm] = useState(() => planForm(plan, today));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const year = Number(today.slice(0, 4));
  const children = calendar.children || [];
  const scheduled = (form.who || []).some((id) => (calendar.custodySchedule?.childIds || []).includes(id));
  const weeks = scheduled ? upcomingWeeksWithKids(calendar.custodySchedule, today, 8) : [];
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const toggleWho = (id) => setForm({ ...form, who: form.who.includes(id) ? form.who.filter((item) => item !== id) : [...form.who, id] });

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.title.trim()) return setError('What is it you want to do?');
    setSaving(true);
    setError('');
    try {
      await savePlan(calendar.id, plan?.id || '', buildPlan(form, calendar));
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const preview = buildPlan(form, calendar);
  const chances = form.title.trim() || preview.deadline ? chancesLeft(preview, calendar, today) : null;

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="panel modal plan-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title">
        <header className="panel-header">
          <div>
            <p className="things-to-do-label">Before it's too late</p>
            <h2 id="plan-dialog-title">{plan ? 'Edit' : 'Something to do'}</h2>
          </div>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>
        <form className="stack" onSubmit={handleSubmit}>
          <label>What<input value={form.title} onChange={set('title')} placeholder="Take the boys to a Leafs game" maxLength={200} /></label>

          <fieldset className="weekly-review-choice">
            <legend>Who</legend>
            <div className="chip-row">
              {[{ id: 'me', name: 'Me' }, ...children.map((child) => ({ id: child.id, name: child.name || 'Unnamed child' }))].map((item) => (
                <label className={`choice-chip ${form.who.includes(item.id) ? 'selected' : ''}`} key={item.id}>
                  <input type="checkbox" checked={form.who.includes(item.id)} onChange={() => toggleWho(item.id)} />
                  {item.name}
                </label>
              ))}
            </div>
          </fieldset>

          <label>By when
            <select value={form.deadlineKind} onChange={set('deadlineKind')}>
              <option value="">No deadline</option>
              <option value="age">Before someone turns an age</option>
              <option value="season">A summer or a Christmas</option>
              <option value="date">By a date</option>
            </select>
          </label>
          {form.deadlineKind === 'age' && (
            <div className="measurement-fields">
              <label>Before
                <select value={form.deadlinePersonId} onChange={set('deadlinePersonId')}>
                  <option value="me">I turn</option>
                  {children.map((child) => <option key={child.id} value={child.id}>{child.name || 'Unnamed child'} turns</option>)}
                </select>
              </label>
              <label>Age<input type="number" min="1" max="120" value={form.deadlineAge} onChange={set('deadlineAge')} placeholder="18" /></label>
            </div>
          )}
          {form.deadlineKind === 'season' && (
            <div className="measurement-fields">
              <label>Which
                <select value={form.deadlineSeason} onChange={set('deadlineSeason')}>
                  {Object.entries(SEASONS).map(([key, season]) => <option key={key} value={key}>{season.label[0].toUpperCase() + season.label.slice(1)}</option>)}
                </select>
              </label>
              <label>Year<input type="number" min={year} max={year + 80} value={form.deadlineYear} onChange={set('deadlineYear')} /></label>
            </div>
          )}
          {form.deadlineKind === 'date' && <label>Date<input type="date" value={form.deadlineDate} onChange={set('deadlineDate')} /></label>}
          {chances && <p className="field-hint">{chances.text}</p>}

          {weeks.length > 0 && (
            <label>In one of your weeks with the boys
              <select value={form.plannedWeekStart} onChange={set('plannedWeekStart')}>
                <option value="">Not planned yet</option>
                {weeks.map((start) => <option key={start} value={start}>{`Week from ${longDate(start)}`}</option>)}
                {form.plannedWeekStart && !weeks.includes(form.plannedWeekStart) && <option value={form.plannedWeekStart}>{`Week from ${longDate(form.plannedWeekStart)}`}</option>}
              </select>
            </label>
          )}
          <label>Notes<textarea value={form.notes} onChange={set('notes')} placeholder="Ideas, costs, who to call…" /></label>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.shareWithViewers} onChange={(event) => setForm({ ...form, shareWithViewers: event.target.checked })} />
            Share this with viewers
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : plan ? 'Save changes' : 'Add it'}</button>
            <button className="secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}

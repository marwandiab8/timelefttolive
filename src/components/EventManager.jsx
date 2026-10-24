import { useState } from 'react';
import { deleteEvent, saveEvent } from '../hooks/useCalendar.js';
import { formatDateId } from '../utils/dateUtils.js';

// An event longer than this shows only on its first and last day in the day's activity, unless it shows every day.
const EVERY_DAY_LIMIT = 31;
const dayCount = (start, end) => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;

export default function EventManager({ calendar, events, role, onClose }) {
  const emptyForm = () => ({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    ongoing: false,
    everyDay: false,
    color: calendar.settings?.defaultEventColor || '#7c9cff',
    visibility: 'viewers'
  });
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');

  if (role !== 'owner') return null;
  const today = formatDateId(new Date());
  const long = !form.ongoing && form.startDate && form.endDate && form.startDate <= form.endDate
    && dayCount(form.startDate, form.endDate) > EVERY_DAY_LIMIT;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Event title is required.');
    if (!form.startDate) return setError('Pick the day it starts.');
    if (!form.ongoing && (!form.endDate || form.startDate > form.endDate)) return setError('Start date must be before or equal to end date.');
    await saveEvent(calendar.id, editingId, form);
    setEditingId('');
    setForm(emptyForm());
  }

  function editEvent(eventItem) {
    setEditingId(eventItem.id);
    // An ongoing event arrives running through today, which is the end date unticking Ongoing starts from.
    setForm({ ...emptyForm(), ...eventItem, ongoing: Boolean(eventItem.ongoing), everyDay: Boolean(eventItem.everyDay) });
  }

  // Stopping an ongoing event ends it today; it keeps showing on every day it covered.
  function stopEvent(eventItem) {
    return saveEvent(calendar.id, eventItem.id, { ...eventItem, ongoing: false, everyDay: true, endDate: today });
  }

  return (
    <div className="modal-backdrop">
      <section className="panel modal">
        <header className="panel-header">
          <h2>Events</h2>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>
        <form className="stack" onSubmit={handleSubmit}>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Family Vacation" required />
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Description" />
          <div className="inline-row">
            <input value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} type="date" aria-label="Start date" required />
            {!form.ongoing && <input value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} type="date" aria-label="End date" required />}
            <input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} type="color" />
            <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
              <option value="viewers">Visible to viewers</option>
              <option value="ownerOnly">Owner only</option>
            </select>
          </div>
          <label className="checkbox-row">
            <input
              checked={form.ongoing}
              onChange={(event) => setForm({
                ...form,
                ongoing: event.target.checked,
                everyDay: event.target.checked || form.everyDay,
                endDate: event.target.checked ? form.endDate : form.endDate || today
              })}
              type="checkbox"
            />
            Ongoing: carry it every day until I stop it
          </label>
          {long && (
            <label className="checkbox-row">
              <input checked={form.everyDay} onChange={(event) => setForm({ ...form, everyDay: event.target.checked })} type="checkbox" />
              Show it on every day, not just its first and last day
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">{editingId ? 'Update event' : 'Create event'}</button>
        </form>
        <div className="list">
          {events.map((eventItem) => (
            <article key={eventItem.id} className="list-item">
              <span className="color-dot" style={{ background: eventItem.color }} />
              <div>
                <strong>{eventItem.title}</strong>
                <p>{eventItem.startDate} to {eventItem.ongoing ? 'now · ongoing' : eventItem.endDate} · {eventItem.visibility}</p>
              </div>
              {eventItem.ongoing && <button className="ghost" type="button" onClick={() => stopEvent(eventItem)}>Stop today</button>}
              <button className="ghost" type="button" onClick={() => editEvent(eventItem)}>Edit</button>
              <button className="ghost danger" type="button" onClick={() => deleteEvent(calendar.id, eventItem.id)}>Delete</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

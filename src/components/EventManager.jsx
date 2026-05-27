import { useState } from 'react';
import { deleteEvent, saveEvent } from '../hooks/useCalendar.js';

export default function EventManager({ calendar, events, role, onClose }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    color: calendar.settings?.defaultEventColor || '#7c9cff',
    visibility: 'viewers'
  });
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');

  if (role !== 'owner') return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Event title is required.');
    if (!form.startDate || !form.endDate || form.startDate > form.endDate) return setError('Start date must be before or equal to end date.');
    await saveEvent(calendar.id, editingId, form);
    setEditingId('');
    setForm({ title: '', description: '', startDate: '', endDate: '', color: calendar.settings?.defaultEventColor || '#7c9cff', visibility: 'viewers' });
  }

  function editEvent(eventItem) {
    setEditingId(eventItem.id);
    setForm(eventItem);
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
            <input value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} type="date" required />
            <input value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} type="date" required />
            <input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} type="color" />
            <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
              <option value="viewers">Visible to viewers</option>
              <option value="ownerOnly">Owner only</option>
            </select>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">{editingId ? 'Update event' : 'Create event'}</button>
        </form>
        <div className="list">
          {events.map((eventItem) => (
            <article key={eventItem.id} className="list-item">
              <span className="color-dot" style={{ background: eventItem.color }} />
              <div>
                <strong>{eventItem.title}</strong>
                <p>{eventItem.startDate} to {eventItem.endDate} · {eventItem.visibility}</p>
              </div>
              <button className="ghost" type="button" onClick={() => editEvent(eventItem)}>Edit</button>
              <button className="ghost danger" type="button" onClick={() => deleteEvent(calendar.id, eventItem.id)}>Delete</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

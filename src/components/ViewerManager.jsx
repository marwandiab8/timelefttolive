import { useState } from 'react';
import { inviteViewer } from '../hooks/useCalendar.js';

export default function ViewerManager({ calendarId, viewers, onClose }) {
  const [email, setEmail] = useState('');

  async function handleInvite(event) {
    event.preventDefault();
    await inviteViewer(calendarId, email);
    setEmail('');
  }

  return (
    <div className="modal-backdrop">
      <section className="panel modal">
        <header className="panel-header">
          <h2>Viewers</h2>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>
        <form className="inline-row" onSubmit={handleInvite}>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="viewer@example.com" required />
          <button className="primary" type="submit">Invite viewer</button>
        </form>
        <div className="list">
          {viewers.length === 0 && <p className="muted">No viewers invited yet.</p>}
          {viewers.map((viewer) => (
            <article className="list-item" key={viewer.id}>
              <div>
                <strong>{viewer.email}</strong>
                <p>{viewer.status} · {viewer.role}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

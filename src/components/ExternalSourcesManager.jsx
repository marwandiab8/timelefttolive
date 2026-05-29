import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import {
  createSourceConnection,
  deleteSourceConnection,
  updateSourceConnectionStatus,
  useSourceConnections
} from '../services/externalSources/sourceConnections.js';
import { SOURCE_APPS } from '../services/externalSources/types.js';

export default function ExternalSourcesManager({ calendarId, onClose }) {
  const { user } = useAuth();
  const { connections, error } = useSourceConnections(calendarId);
  const [form, setForm] = useState({
    sourceApp: 'aigridline',
    sourceFirebaseProjectId: '',
    sourceOwnerUid: '',
    sourceUserEmail: '',
    sourceProjectIds: '',
    status: 'active'
  });
  const [saving, setSaving] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving('Saving...');
    try {
      await createSourceConnection(calendarId, form, user.uid);
      setForm({ ...form, sourceFirebaseProjectId: '', sourceOwnerUid: '', sourceUserEmail: '', sourceProjectIds: '' });
      setSaving('Saved');
    } catch (err) {
      setSaving(err.message);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="panel modal">
        <header className="panel-header">
          <div>
            <p className="eyebrow">External sources</p>
            <h2>Linked Sources</h2>
          </div>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>Source app
            <select value={form.sourceApp} onChange={(event) => setForm({ ...form, sourceApp: event.target.value })}>
              {SOURCE_APPS.filter((source) => source !== 'manual').map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
          </label>
          <label>Source Firebase project ID
            <input value={form.sourceFirebaseProjectId} onChange={(event) => setForm({ ...form, sourceFirebaseProjectId: event.target.value })} placeholder="aigridline" />
          </label>
          <label>Source owner UID
            <input value={form.sourceOwnerUid} onChange={(event) => setForm({ ...form, sourceOwnerUid: event.target.value })} />
          </label>
          <label>Source user email
            <input value={form.sourceUserEmail} onChange={(event) => setForm({ ...form, sourceUserEmail: event.target.value })} type="email" />
          </label>
          <label className="wide">Source project IDs
            <input value={form.sourceProjectIds} onChange={(event) => setForm({ ...form, sourceProjectIds: event.target.value })} placeholder="comma,separated,project,ids" />
          </label>
          <button className="primary wide" type="submit">Add connection</button>
          {saving && <p className="muted wide">{saving}</p>}
        </form>

        {error && <p className="error">{error}</p>}
        <div className="list">
          {connections.length === 0 && <p className="muted">No linked sources yet.</p>}
          {connections.map((connection) => (
            <article className="list-item" key={connection.id}>
              <div>
                <strong>{connection.sourceApp}</strong>
                <p>{connection.sourceFirebaseProjectId || 'No project ID'} · {connection.status}</p>
                <p className="muted">{(connection.sourceProjectIds || []).join(', ') || 'All projects'}</p>
              </div>
              <button className="ghost" type="button" onClick={() => updateSourceConnectionStatus(calendarId, connection.id, connection.status === 'active' ? 'paused' : 'active')}>
                {connection.status === 'active' ? 'Pause' : 'Activate'}
              </button>
              <button className="ghost danger" type="button" onClick={() => deleteSourceConnection(calendarId, connection.id)}>Revoke</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

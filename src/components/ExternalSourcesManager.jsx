import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import {
  createSourceConnection,
  createSourceIngestionToken,
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
  // The settings a source app needs to send life events, shown once right after a token is created.
  const [issued, setIssued] = useState(null);
  const [tokenMessage, setTokenMessage] = useState('');

  async function handleCreateToken(connection) {
    if (connection.tokenLastFour && !window.confirm(`Replace the ${connection.sourceApp} token? The current one stops working, so whatever uses it must be given the new one.`)) return;
    setTokenMessage('Creating token...');
    setIssued(null);
    try {
      const data = await createSourceIngestionToken(calendarId, connection.id);
      const settings = {
        endpoint: `${window.location.origin}/api/v1/life-events`,
        calendarId,
        connectionId: connection.id,
        integrationId: data.integrationId,
        token: data.token
      };
      setIssued({ connectionId: connection.id, sourceApp: connection.sourceApp, text: JSON.stringify(settings, null, 2) });
      setTokenMessage('');
    } catch (err) {
      setTokenMessage(err.message);
    }
  }

  async function copyIssued() {
    try {
      await navigator.clipboard.writeText(issued.text);
      setTokenMessage('Copied.');
    } catch {
      setTokenMessage('Copy failed. Select the text and copy it by hand.');
    }
  }

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
        {tokenMessage && <p className="muted">{tokenMessage}</p>}
        {issued && (
          <div className="token-box">
            <p><strong>{issued.sourceApp} connection settings</strong>. The token is shown only this once. Paste these where the source app keeps its settings (DartConnect Inbox: the script property <code>TIME_LEFT_CONNECTION</code>).</p>
            <textarea readOnly rows={8} value={issued.text} onFocus={(event) => event.target.select()} />
            <div className="token-box-actions">
              <button className="ghost" type="button" onClick={copyIssued}>Copy</button>
              <button className="ghost" type="button" onClick={() => { setIssued(null); setTokenMessage(''); }}>Done</button>
            </div>
          </div>
        )}
        <div className="list">
          {connections.length === 0 && <p className="muted">No linked sources yet.</p>}
          {connections.map((connection) => (
            <article className="list-item" key={connection.id}>
              <div>
                <strong>{connection.sourceApp}</strong>
                <p>{connection.sourceFirebaseProjectId || 'No project ID'} · {connection.status}</p>
                <p className="muted">{(connection.sourceProjectIds || []).join(', ') || 'All projects'}</p>
                <p className="muted">{connection.tokenLastFour && connection.tokenStatus !== 'revoked' ? `Token ending ${connection.tokenLastFour}` : 'No token'}</p>
              </div>
              <button className="ghost" type="button" onClick={() => handleCreateToken(connection)}>
                {connection.tokenLastFour ? 'Replace token' : 'Create token'}
              </button>
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

import { useState } from 'react';
import BrandLogo from './BrandLogo.jsx';
import { appendDailyNote } from '../hooks/useCalendar.js';
import { uploadDailyAttachment } from '../services/storageService.js';
import { parseDateId } from '../utils/dateUtils.js';

/**
 * Quick capture (#capture, and the home-screen shortcut): a line for today and a photo, in two taps. Both are private
 * unless shared. Owner only.
 */
export default function QuickCapture({ calendar, today, uid, theme, onDone }) {
  const [text, setText] = useState('');
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState([]);
  const [error, setError] = useState('');
  const dayLabel = parseDateId(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const visibility = share ? 'viewers' : 'ownerOnly';

  async function run(work, label) {
    setSaving(true);
    setError('');
    try {
      await work();
      const time = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      setSaved((current) => [`${label}, ${time}`, ...current].slice(0, 5));
    } catch (err) {
      setError(err?.message || 'That did not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const saveNote = (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    run(async () => {
      await appendDailyNote(calendar.id, today, text, { uid, shareWithViewers: share });
      setText('');
    }, 'Note saved');
  };

  const savePhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    run(() => uploadDailyAttachment(calendar.id, today, file, { visibility, uid }), 'Photo saved');
  };

  return (
    <main className="app-shell quick-capture" data-calendar-theme={theme}>
      <header className="topbar">
        <div>
          <p className="eyebrow brand-row"><BrandLogo size={28} />Time Left To Live</p>
          <h1>{dayLabel}</h1>
        </div>
        <button className="secondary" type="button" onClick={onDone}>Calendar</button>
      </header>
      <form className="stack quick-capture-form" onSubmit={saveNote}>
        <label htmlFor="quick-capture-text">What happened today?</label>
        <textarea id="quick-capture-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="One line is enough." rows={5} />
        <div className="quick-capture-actions">
          <button className="primary" type="submit" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Save to today'}</button>
          <label className="secondary quick-capture-photo">
            Add a photo
            <input type="file" accept="image/*" capture="environment" onChange={savePhoto} disabled={saving} />
          </label>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
          Share with viewers
        </label>
      </form>
      {error && <p className="error">{error}</p>}
      {saved.length > 0 && (
        <ul className="quick-capture-saved" aria-live="polite">
          {saved.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
        </ul>
      )}
    </main>
  );
}

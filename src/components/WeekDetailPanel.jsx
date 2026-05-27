import { useEffect, useMemo, useState } from 'react';
import { saveDailyEntry, useWeekAttachments, useWeekEntries } from '../hooks/useCalendar.js';
import { addLinkAttachment, deleteAttachment, getAttachmentDownloadUrl, uploadDailyAttachment } from '../services/storageService.js';
import { createExternalRecordLink } from '../services/externalRecords.js';
import { eventIntersectsWeek, formatDateId, getDaysInRange, isDateInRange } from '../utils/dateUtils.js';

export default function WeekDetailPanel({ calendar, week, events, role, onClose }) {
  const days = useMemo(() => getDaysInRange(week.start, week.end), [week.start, week.end]);
  const dateIds = useMemo(() => days.map(formatDateId), [days]);
  const entryState = useWeekEntries(calendar.id, dateIds, role);
  const attachmentState = useWeekAttachments(calendar.id, dateIds, role);
  const entries = entryState.entries;
  const attachments = attachmentState.attachments;
  const weekEvents = events.filter((event) => eventIntersectsWeek(event, week));
  const canEdit = role === 'owner';

  return (
    <aside className="side-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Week detail</p>
          <h2>{formatDateId(week.start)} to {formatDateId(week.end)}</h2>
        </div>
        <button className="ghost" type="button" onClick={onClose}>Close</button>
      </header>

      <section>
        <h3>Events this week</h3>
        {(entryState.error || attachmentState.error) && <p className="error">{entryState.error || attachmentState.error}</p>}
        <div className="list compact">
          {weekEvents.length === 0 && <p className="muted">No events overlap this week.</p>}
          {weekEvents.map((event) => (
            <article className="list-item" key={event.id}>
              <span className="color-dot" style={{ background: event.color }} />
              <div>
                <strong>{event.title}</strong>
                <p>{event.startDate} to {event.endDate}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="day-list">
        {days.map((day) => {
          const dateId = formatDateId(day);
          const dayEvents = weekEvents.filter((event) => isDateInRange(day, event.startDate, event.endDate));
          return (
            <DayCard
              key={dateId}
              calendarId={calendar.id}
              dateId={dateId}
              entry={entries[dateId]}
              attachments={attachments[dateId] || []}
              events={dayEvents}
              canEdit={canEdit}
            />
          );
        })}
      </section>
    </aside>
  );
}

function DayCard({ calendarId, dateId, entry, attachments, events, canEdit }) {
  const [journalText, setJournalText] = useState(entry?.journalText || '');
  const [tags, setTags] = useState(entry?.tags?.join(', ') || '');
  const [visibility, setVisibility] = useState(entry?.visibility || 'viewers');
  const [file, setFile] = useState(null);
  const [link, setLink] = useState({ title: '', url: '' });
  const [external, setExternal] = useState({ sourceProjectId: '', sourceCollection: '', sourceDocumentId: '', title: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setJournalText(entry?.journalText || '');
    setTags(entry?.tags?.join(', ') || '');
    setVisibility(entry?.visibility || 'viewers');
  }, [entry?.journalText, entry?.tags, entry?.visibility]);

  async function saveEntry() {
    setError('');
    setSaving(true);
    try {
      await saveDailyEntry(calendarId, dateId, {
        journalText,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        visibility
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload() {
    setError('');
    try {
      await uploadDailyAttachment(calendarId, dateId, file, { visibility });
      setFile(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addLink() {
    if (!link.title || !link.url) return;
    setError('');
    try {
      await addLinkAttachment(calendarId, dateId, { ...link, visibility });
      setLink({ title: '', url: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  async function addExternal() {
    if (!external.sourceProjectId || !external.sourceCollection || !external.sourceDocumentId) return;
    setError('');
    try {
      await createExternalRecordLink(calendarId, dateId, { ...external, visibility });
      setExternal({ sourceProjectId: '', sourceCollection: '', sourceDocumentId: '', title: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <article className="day-card">
      <header>
        <strong>{dateId}</strong>
        <div>{events.map((event) => <span className="tag" key={event.id} style={{ borderColor: event.color }}>{event.title}</span>)}</div>
      </header>
      {canEdit ? (
        <div className="stack">
          <textarea value={journalText} onChange={(event) => setJournalText(event.target.value)} placeholder="Journal, notes, memories..." />
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags, comma separated" />
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
            <option value="viewers">Visible to viewers</option>
            <option value="ownerOnly">Owner only</option>
          </select>
          <button className="secondary" type="button" onClick={saveEntry} disabled={saving}>{saving ? 'Saving...' : 'Save journal'}</button>
          <div className="inline-row">
            <input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <button className="secondary" type="button" onClick={handleUpload} disabled={!file}>Upload</button>
          </div>
          <div className="inline-row">
            <input value={link.title} onChange={(event) => setLink({ ...link, title: event.target.value })} placeholder="Link title" />
            <input value={link.url} onChange={(event) => setLink({ ...link, url: event.target.value })} placeholder="https://..." />
            <button className="secondary" type="button" onClick={addLink}>Add link</button>
          </div>
          <div className="inline-row">
            <input value={external.sourceProjectId} onChange={(event) => setExternal({ ...external, sourceProjectId: event.target.value })} placeholder="source project" />
            <input value={external.sourceCollection} onChange={(event) => setExternal({ ...external, sourceCollection: event.target.value })} placeholder="collection" />
            <input value={external.sourceDocumentId} onChange={(event) => setExternal({ ...external, sourceDocumentId: event.target.value })} placeholder="document id" />
            <button className="secondary" type="button" onClick={addExternal}>Link record</button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <p className="muted">{entry?.journalText || 'No visible journal entry.'}</p>
      )}
      <AttachmentList calendarId={calendarId} dateId={dateId} attachments={attachments} canEdit={canEdit} />
    </article>
  );
}

function AttachmentList({ calendarId, dateId, attachments, canEdit }) {
  return (
    <div className="attachments">
      {attachments.map((attachment) => <AttachmentItem key={attachment.id} calendarId={calendarId} dateId={dateId} attachment={attachment} canEdit={canEdit} />)}
    </div>
  );
}

function AttachmentItem({ calendarId, dateId, attachment, canEdit }) {
  const [downloadUrl, setDownloadUrl] = useState(attachment.url || '');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!attachment.storagePath) {
      setDownloadUrl(attachment.url || '');
      return () => {
        active = false;
      };
    }
    getAttachmentDownloadUrl(attachment.storagePath)
      .then((url) => {
        if (active) setDownloadUrl(url);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [attachment.storagePath, attachment.url]);

  return (
    <article className="attachment">
      {attachment.type === 'image' && downloadUrl && <img src={downloadUrl} alt={attachment.title} />}
      {downloadUrl ? <a href={downloadUrl} target="_blank" rel="noreferrer">{attachment.title}</a> : <span>{attachment.title}</span>}
      <span>{attachment.type}</span>
      {error && <span className="error">File unavailable</span>}
      {canEdit && <button className="ghost danger" type="button" onClick={() => deleteAttachment(calendarId, dateId, attachment)}>Delete</button>}
    </article>
  );
}

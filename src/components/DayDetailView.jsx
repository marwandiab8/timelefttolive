import { useEffect, useMemo, useState } from 'react';
import { saveDailyEntry, useWeekAttachments, useWeekEntries } from '../hooks/useCalendar.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { addLinkAttachment, deleteAttachment, getAttachmentDownloadUrl, uploadDailyAttachment } from '../services/storageService.js';
import { createExternalRecordLink } from '../services/externalRecords.js';
import { formatDateId, getEventsForDate, parseDateId } from '../utils/dateUtils.js';

export default function DayDetailView({ calendar, dateId, events, role }) {
  const { user } = useAuth();
  const entryState = useWeekEntries(calendar.id, [dateId], role);
  const attachmentState = useWeekAttachments(calendar.id, [dateId], role);
  const entry = entryState.entries[dateId];
  const attachments = attachmentState.attachments[dateId] || [];
  const dayEvents = useMemo(() => getEventsForDate(events, dateId), [events, dateId]);
  const canEdit = role === 'owner';
  const date = parseDateId(dateId);

  return (
    <section className="detail-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Day detail</p>
          <h2>{date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
        </div>
      </div>
      {(entryState.error || attachmentState.error) && <p className="error">{entryState.error || attachmentState.error}</p>}
      <div className="detail-grid">
        <section className="panel detail-panel">
          <h3>Events</h3>
          {dayEvents.length === 0 && <p className="muted">No events affect this day.</p>}
          {dayEvents.map((event) => (
            <article className="list-item" key={event.id}>
              <span className="color-dot" style={{ background: event.color }} />
              <div>
                <strong>{event.title}</strong>
                <p>{event.startDate} to {event.endDate}</p>
              </div>
            </article>
          ))}
        </section>
        <DayEditor
          calendarId={calendar.id}
          dateId={dateId}
          entry={entry}
          canEdit={canEdit}
          uid={user?.uid || ''}
        />
        <AttachmentManager
          calendarId={calendar.id}
          dateId={dateId}
          attachments={attachments}
          canEdit={canEdit}
          uid={user?.uid || ''}
        />
      </div>
    </section>
  );
}

function DayEditor({ calendarId, dateId, entry, canEdit, uid }) {
  const [journalText, setJournalText] = useState(entry?.journalText || '');
  const [notes, setNotes] = useState(entry?.notes || '');
  const [tags, setTags] = useState(entry?.tags?.join(', ') || '');
  const [visibility, setVisibility] = useState(entry?.visibility || 'viewers');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setJournalText(entry?.journalText || '');
    setNotes(entry?.notes || '');
    setTags(entry?.tags?.join(', ') || '');
    setVisibility(entry?.visibility || 'viewers');
  }, [entry]);

  async function handleSave() {
    setStatus('Saving...');
    try {
      await saveDailyEntry(calendarId, dateId, {
        journalText,
        notes,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        visibility
      }, uid);
      setStatus('Saved');
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (!canEdit) {
    return (
      <section className="panel detail-panel">
        <h3>Journal</h3>
        <p>{entry?.journalText || 'No visible journal entry.'}</p>
        {entry?.notes && <p className="muted">{entry.notes}</p>}
        {entry?.tags?.length > 0 && <p className="muted">Tags: {entry.tags.join(', ')}</p>}
      </section>
    );
  }

  return (
    <section className="panel detail-panel stack">
      <h3>Journal and notes</h3>
      <textarea value={journalText} onChange={(event) => setJournalText(event.target.value)} placeholder="Journal text..." />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes..." />
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags, comma separated" />
      <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
        <option value="viewers">Visible to viewers</option>
        <option value="ownerOnly">Owner only</option>
      </select>
      <button className="primary" type="button" onClick={handleSave}>Save day</button>
      {status && <p className={status === 'Saved' ? 'muted' : 'error'}>{status}</p>}
    </section>
  );
}

function AttachmentManager({ calendarId, dateId, attachments, canEdit, uid }) {
  const [file, setFile] = useState(null);
  const [visibility, setVisibility] = useState('viewers');
  const [link, setLink] = useState({ title: '', url: '' });
  const [external, setExternal] = useState({ sourceProjectId: '', sourceCollection: '', sourceDocumentId: '', title: '' });
  const [error, setError] = useState('');

  async function handleUpload() {
    setError('');
    try {
      await uploadDailyAttachment(calendarId, dateId, file, { visibility, uid });
      setFile(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLink() {
    if (!link.title || !link.url) return;
    await addLinkAttachment(calendarId, dateId, { ...link, visibility, uid });
    setLink({ title: '', url: '' });
  }

  async function handleExternal() {
    if (!external.sourceProjectId || !external.sourceCollection || !external.sourceDocumentId) return;
    await createExternalRecordLink(calendarId, dateId, { ...external, visibility, uid });
    setExternal({ sourceProjectId: '', sourceCollection: '', sourceDocumentId: '', title: '' });
  }

  return (
    <section className="panel detail-panel stack">
      <h3>Attachments and links</h3>
      {attachments.length === 0 && <p className="muted">No photos, files, links, or external records saved for this day.</p>}
      <div className="attachments">
        {attachments.map((attachment) => (
          <AttachmentItem key={attachment.id} calendarId={calendarId} dateId={dateId} attachment={attachment} canEdit={canEdit} />
        ))}
      </div>
      {canEdit && (
        <>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
            <option value="viewers">Visible to viewers</option>
            <option value="ownerOnly">Owner only</option>
          </select>
          <div className="inline-row">
            <input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <button className="secondary" type="button" onClick={handleUpload} disabled={!file}>Upload</button>
          </div>
          <div className="inline-row">
            <input value={link.title} onChange={(event) => setLink({ ...link, title: event.target.value })} placeholder="Link title" />
            <input value={link.url} onChange={(event) => setLink({ ...link, url: event.target.value })} placeholder="https://..." />
            <button className="secondary" type="button" onClick={handleLink}>Add link</button>
          </div>
          <div className="inline-row">
            <input value={external.sourceProjectId} onChange={(event) => setExternal({ ...external, sourceProjectId: event.target.value })} placeholder="source project" />
            <input value={external.sourceCollection} onChange={(event) => setExternal({ ...external, sourceCollection: event.target.value })} placeholder="collection" />
            <input value={external.sourceDocumentId} onChange={(event) => setExternal({ ...external, sourceDocumentId: event.target.value })} placeholder="document id" />
            <button className="secondary" type="button" onClick={handleExternal}>Link record</button>
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  );
}

function AttachmentItem({ calendarId, dateId, attachment, canEdit }) {
  const [downloadUrl, setDownloadUrl] = useState(attachment.url || '');

  useEffect(() => {
    let active = true;
    if (!attachment.storagePath) {
      setDownloadUrl(attachment.url || '');
      return () => {
        active = false;
      };
    }
    getAttachmentDownloadUrl(attachment.storagePath).then((url) => {
      if (active) setDownloadUrl(url);
    }).catch(() => {
      if (active) setDownloadUrl('');
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
      {canEdit && <button className="ghost danger" type="button" onClick={() => deleteAttachment(calendarId, dateId, attachment)}>Delete</button>}
    </article>
  );
}

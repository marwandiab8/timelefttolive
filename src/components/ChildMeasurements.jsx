import { useEffect, useMemo, useState } from 'react';
import { deleteChildMeasurement, removeChildDetails, saveChildMeasurement } from '../hooks/useCalendar.js';
import { buildMeasurement, formatHeight, formatHeightChange, growthChartGeometry, parseHeight, planHeightNoteMove, summarizeHeights } from '../utils/childMeasurements.js';
import { parseDateId } from '../utils/dateUtils.js';

const dateLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const monthLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** A child's heights in words: the latest, the change since the reading before, and what needs checking. */
export function describeHeights(measurements, { date = dateLabel, month = monthLabel } = {}) {
  const summary = summarizeHeights(measurements);
  if (!summary.heights.length) return null;
  return {
    summary,
    latest: summary.latest ? `${formatHeight(summary.latest.valueMm)} on ${date(summary.latest.measuredOn)}` : '',
    change: summary.change ? `${formatHeightChange(summary.change.mm)} since ${month(summary.change.since)}` : '',
    needsCheck: summary.needsCheck.map((item) => `${item.asWritten} (${date(item.measuredOn)}) needs checking`)
  };
}

/** A small growth line: time along, height up, each reading a dot, the latest one filled. */
export function GrowthChart({ points, label }) {
  const chart = growthChartGeometry(points, { width: 220, height: 64, pad: 6 });
  if (!chart) return null;
  return (
    <svg className="growth-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={label}>
      <path d={chart.path} />
      {chart.positions.map((point, index) => (
        <circle className={index === chart.positions.length - 1 ? 'latest' : ''} cx={point.x} cy={point.y} key={point.measuredOn} r={index === chart.positions.length - 1 ? 3.6 : 2.6}>
          <title>{`${formatHeight(point.mm)} on ${dateLabel(point.measuredOn)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Add, correct and remove one child's heights. Owner only. */
/**
 * The child's "Height, <date>" notes on the profile: copy them into the history (they stay private), then, once
 * copied, take them off the profile, where viewers can read them. Each step is its own button.
 */
function HeightNotesMove({ calendarId, child, allChildren, measurements }) {
  const plan = planHeightNoteMove(child, measurements);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!plan.toCopy.length && !plan.removable.length) return null;

  async function run(step) {
    setBusy(true);
    setError('');
    try {
      await step();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const copy = () => run(() => Promise.all(plan.toCopy.map(({ detailId, ...measurement }) => saveChildMeasurement(calendarId, measurement))));
  const remove = () => run(() => removeChildDetails(calendarId, allChildren, child.id, plan.removable));

  return (
    <section className="height-notes-move" aria-label="Height notes on the profile">
      {plan.toCopy.length > 0 ? (
        <>
          <p><strong>{plan.toCopy.length} height {plan.toCopy.length === 1 ? 'note' : 'notes'}</strong> on {child.name || 'this'}'s profile can go into this history. They stay private.</p>
          <ul>
            {plan.toCopy.map((row) => (
              <li key={row.id}>
                {dateLabel(row.data.measuredOn)}: {row.data.asWritten}
                {row.data.needsCheck && <span className="measurement-flag">Kept as written and flagged to check.</span>}
              </li>
            ))}
          </ul>
          <button className="primary" type="button" disabled={busy} onClick={copy}>{busy ? 'Copying…' : 'Copy them in'}</button>
        </>
      ) : (
        <>
          <p>The {plan.removable.length} height {plan.removable.length === 1 ? 'note is' : 'notes are'} in the history now, and still on the profile too, where viewers can see {plan.removable.length === 1 ? 'it' : 'them'}.</p>
          <button className="secondary" type="button" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Take them off the profile'}</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function MeasurementsDialog({ calendarId, child, allChildren = [], measurements, onClose }) {
  const heights = useMemo(() => summarizeHeights(measurements.filter((item) => item.childId === child.id)).heights.slice().reverse(), [child.id, measurements]);
  const [form, setForm] = useState({ measuredOn: today(), asWritten: '', note: '', shareWithViewers: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = parseHeight(form.asWritten);
  const preview = !form.asWritten.trim()
    ? ''
    : parsed.clean ? `Reads as ${formatHeight(parsed.mm)}` : "Can't read this cleanly. It will be kept as written and flagged to check.";

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.measuredOn) return setError('Pick the day it was measured.');
    if (!form.asWritten.trim()) return setError('Write the height, for example 5\' 8 1/2".');
    setSaving(true);
    setError('');
    try {
      await saveChildMeasurement(calendarId, buildMeasurement({ childId: child.id, ...form }));
      setForm({ measuredOn: today(), asWritten: '', note: '', shareWithViewers: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Correcting a reading: its day and text go back into the form; saving on the same day replaces it.
  const correct = (item) => setForm({ measuredOn: item.measuredOn, asWritten: item.asWritten, note: item.note || '', shareWithViewers: item.visibility === 'viewers' });

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="panel modal measurements-dialog" role="dialog" aria-modal="true" aria-labelledby="measurements-title">
        <header className="panel-header">
          <div>
            <p className="weekly-review-label">Height history</p>
            <h2 id="measurements-title">{child.name || 'Your child'}</h2>
          </div>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>

        <HeightNotesMove calendarId={calendarId} child={child} allChildren={allChildren} measurements={measurements.filter((item) => item.childId === child.id)} />

        <form className="stack" onSubmit={handleSubmit}>
          <div className="measurement-fields">
            <label>Measured on<input type="date" value={form.measuredOn} onChange={(event) => setForm({ ...form, measuredOn: event.target.value })} /></label>
            <label>Height<input value={form.asWritten} placeholder={`5' 8 1/2"`} onChange={(event) => setForm({ ...form, asWritten: event.target.value })} /></label>
          </div>
          {preview && <p className={`field-hint ${parsed.clean ? '' : 'warning'}`}>{preview}</p>}
          <label>Note<input value={form.note} placeholder="Shoes off, at the kitchen doorway…" onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.shareWithViewers} onChange={(event) => setForm({ ...form, shareWithViewers: event.target.checked })} />
            Share this height with viewers
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save height'}</button>
          </div>
        </form>

        <ul className="measurement-list" aria-label="Heights so far">
          {heights.length === 0 && <li className="muted">No heights yet.</li>}
          {heights.map((item) => (
            <li className={item.needsCheck ? 'needs-check' : ''} key={item.id}>
              <span>
                <strong>{Number.isFinite(item.valueMm) ? formatHeight(item.valueMm) : item.asWritten}</strong>
                <span className="muted"> {dateLabel(item.measuredOn)}{item.visibility === 'viewers' ? ' · shared' : ''}</span>
                {item.needsCheck && <span className="measurement-flag">Written as {item.asWritten}. Please check.</span>}
                {item.note && <span className="muted measurement-note">{item.note}</span>}
              </span>
              <span className="measurement-actions">
                <button className="ghost" type="button" onClick={() => correct(item)}>Correct</button>
                <button className="ghost" type="button" onClick={() => window.confirm(`Remove the height of ${item.asWritten} on ${dateLabel(item.measuredOn)}? This can't be undone.`) && deleteChildMeasurement(calendarId, item.id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import BrandLogo from './BrandLogo.jsx';
import { useDigestSettings, usePushDevices } from '../hooks/useCalendar.js';
import {
  enablePushOnThisDevice,
  previewWeeklyDigest,
  pushAvailability,
  removePushDevice,
  saveDigestSettings,
  sendTestDigest,
  thisDeviceTokenId
} from '../services/weeklyDigest.js';
import { parseDateId } from '../utils/dateUtils.js';

/** What a send did, in a sentence: "Notification sent to 1 device. Email sent." */
export function describeSendResults(results = {}) {
  const parts = [];
  if (results.push) {
    if (results.push.error) parts.push(`Notification not sent: ${results.push.error}`);
    else parts.push(`Notification sent to ${results.push.sent} ${results.push.sent === 1 ? 'device' : 'devices'}${results.push.failed ? ` (${results.push.failed} failed)` : ''}.`);
  }
  if (results.email) parts.push(results.email.sent ? 'Email sent.' : `Email not sent: ${results.email.error}`);
  return parts.join(' ');
}

const sundayLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** The digest itself, as it goes out (the email's sections; the notification is its first line). */
export function DigestPreview({ digest }) {
  const ahead = [digest.nextWeekWithKids, ...digest.plans.map((plan) => `${plan.title}: ${plan.when}`), ...digest.milestones].filter(Boolean);
  return (
    <article className="digest-preview" aria-label="This week's digest">
      <h2>{digest.title}</h2>
      <ul>{digest.numberLines.map((line) => <li key={line}>{line}</li>)}</ul>
      {digest.targetsMet.length > 0 && (
        <>
          <h3>Targets met</h3>
          <ul>{digest.targetsMet.map((text) => <li key={text}>{text}</li>)}</ul>
        </>
      )}
      {digest.targetsMissed.length > 0 && (
        <>
          <h3>Targets missed</h3>
          <ul>{digest.targetsMissed.map((text) => <li key={text}>{text}</li>)}</ul>
        </>
      )}
      {digest.moment && (
        <>
          <h3>One moment</h3>
          <blockquote>
            {digest.moment.text}
            <span className="muted">{digest.moment.from}</span>
          </blockquote>
        </>
      )}
      {ahead.length > 0 && (
        <>
          <h3>Next week</h3>
          <ul>{ahead.map((line) => <li key={line}>{line}</li>)}</ul>
        </>
      )}
      <p className="muted digest-push-line">On the lock screen: “{digest.push.body}”</p>
    </article>
  );
}

/**
 * The Sunday digest (#digest): this week's, as it would be sent, and the switches for sending it. Owner only.
 * Tapping the notification or the email's link lands here.
 */
export default function WeeklyDigestPage({ calendar, uid, email, theme, onDone }) {
  const [digest, setDigest] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const { settings, error: settingsError } = useDigestSettings(calendar.id);
  const { devices, error: devicesError } = usePushDevices(calendar.id);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deviceId, setDeviceId] = useState(thisDeviceTokenId);
  const availability = pushAvailability();

  useEffect(() => {
    let cancelled = false;
    previewWeeklyDigest(calendar.id)
      .then((result) => { if (!cancelled) setDigest(result); })
      .catch((err) => { if (!cancelled) setPreviewError(err?.message || 'The digest could not be built.'); });
    return () => { cancelled = true; };
  }, [calendar.id]);

  const current = { enabled: Boolean(settings?.enabled), push: Boolean(settings?.push), email: Boolean(settings?.email) };

  async function run(label, work) {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (err) {
      setError(err?.message || 'That did not work. Try again.');
    } finally {
      setBusy('');
    }
  }

  const toggle = (key) => (event) => run('save', () => saveDigestSettings(calendar.id, { ...current, [key]: event.target.checked }));
  const turnOnHere = () => run('device', async () => {
    const id = await enablePushOnThisDevice(calendar.id, uid);
    setDeviceId(id);
    await saveDigestSettings(calendar.id, { ...current, push: true });
    setMessage('Notifications are on for this device.');
  });
  const removeDevice = (id) => run('device', async () => {
    await removePushDevice(calendar.id, id);
    if (id === deviceId) setDeviceId('');
  });
  const test = () => run('test', async () => {
    const results = await sendTestDigest(calendar.id);
    setMessage(describeSendResults(results) || 'Nothing was sent.');
  });

  const thisDeviceOn = deviceId && devices.some((device) => device.id === deviceId);
  const lastSent = settings?.lastSentWeekEnd ? `Last sent ${sundayLabel(settings.lastSentWeekEnd)}. ${describeSendResults(settings.lastResult)}` : '';

  return (
    <main className="app-shell digest-page" data-calendar-theme={theme}>
      <header className="topbar">
        <div>
          <p className="eyebrow brand-row"><BrandLogo size={28} />Time Left To Live</p>
          <h1>Sunday digest</h1>
        </div>
        <button className="secondary" type="button" onClick={onDone}>Calendar</button>
      </header>

      <section className="digest-section">
        {digest ? <DigestPreview digest={digest} /> : <p className="muted">{previewError || 'Putting the week together…'}</p>}
      </section>

      <section className="digest-section stack" aria-label="Sending the digest">
        <h2>Send it to me</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={current.enabled} onChange={toggle('enabled')} disabled={!settings || Boolean(busy)} />
          Every Sunday at 7 pm
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={current.push} onChange={toggle('push')} disabled={!settings || Boolean(busy)} />
          As a notification on the devices below
        </label>
        <ul className="digest-devices">
          {devices.map((device) => (
            <li key={device.id}>
              <span>{device.platform}{device.id === deviceId ? ' (this device)' : ''}</span>
              <button className="quiet-button" type="button" onClick={() => removeDevice(device.id)} disabled={Boolean(busy)}>Remove</button>
            </li>
          ))}
          {!devices.length && <li className="muted">No devices yet.</li>}
        </ul>
        {!thisDeviceOn && (availability.ok
          ? <button className="secondary" type="button" onClick={turnOnHere} disabled={Boolean(busy)}>{busy === 'device' ? 'Turning on…' : 'Turn on notifications on this device'}</button>
          : <p className="muted">{availability.reason}</p>)}
        <label className="checkbox-row">
          <input type="checkbox" checked={current.email} onChange={toggle('email')} disabled={!settings || Boolean(busy)} />
          As an email to {email || 'your sign-in address'}
        </label>
        <div className="digest-actions">
          <button className="primary" type="button" onClick={test} disabled={Boolean(busy) || (!current.push && !current.email)}>
            {busy === 'test' ? 'Sending…' : 'Send me a test now'}
          </button>
        </div>
        <p className="muted">The notification shows only numbers, never what you wrote, because it can appear on a locked phone. Nothing is sent until “Every Sunday at 7 pm” is ticked, apart from a test you send yourself.</p>
        {lastSent && <p className="muted">{lastSent}</p>}
        {message && <p aria-live="polite">{message}</p>}
        {(error || settingsError || devicesError) && <p className="error">{error || settingsError || devicesError}</p>}
      </section>
    </main>
  );
}

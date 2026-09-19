import { useState } from 'react';
import { refreshEmailVerification, resendVerificationEmail } from '../services/firebase.js';

export default function EmailVerificationNotice({ email, onVerified }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function run(action, onSuccess) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      onSuccess(await action());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function resend() {
    return run(resendVerificationEmail, () => setMessage(`Verification email sent to ${email}.`));
  }

  function check() {
    return run(refreshEmailVerification, (verified) => {
      if (verified) onVerified();
      else setMessage('That address is not verified yet. Open the link in the email, then check again.');
    });
  }

  return (
    <section className="panel">
      <h2>Verify your email</h2>
      <p className="muted">
        Calendar invitations are matched to a verified email address. Open the link we sent to {email} to accept invites shared with you.
      </p>
      <div className="actions">
        <button className="primary" type="button" disabled={busy} onClick={check}>I have verified</button>
        <button className="secondary" type="button" disabled={busy} onClick={resend}>Resend email</button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

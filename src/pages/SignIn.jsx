import { useState } from 'react';
import {
  firebaseMissingKeys,
  isFirebaseConfigured,
  registerWithEmail,
  signInWithEmail,
  signInWithGoogle
} from '../services/firebase.js';

export default function SignIn() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleEmailSubmit(event) {
    event.preventDefault();
    setError('');
    try {
      if (mode === 'register') await registerWithEmail(email, password);
      else await signInWithEmail(email, password);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">Firebase setup needed</p>
          <h1>Time Left To Live</h1>
          <p>Add your Firebase web config to a local `.env` file. Missing keys: {firebaseMissingKeys.join(', ')}.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Private life calendar</p>
        <h1>Time Left To Live</h1>
        <p className="muted">Sign in to build a week-by-week map of the time you have lived and the time still ahead.</p>
        <button className="primary full" type="button" onClick={() => signInWithGoogle()}>
          Continue with Google
        </button>
        <div className="divider">or</div>
        <form onSubmit={handleEmailSubmit} className="stack">
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" minLength="6" required />
          <button className="secondary full" type="submit">{mode === 'register' ? 'Create account' : 'Sign in with email'}</button>
        </form>
        <button className="text-button" type="button" onClick={() => setMode(mode === 'register' ? 'signin' : 'register')}>
          {mode === 'register' ? 'Use existing account' : 'Create an email account'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

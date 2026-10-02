'use client';

import { useState } from 'react';

export default function SalesLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const signIn = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/v1/sales/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        setError(response.status === 429 ? 'Too many attempts. Please try again later.' : 'Invalid email or password.');
        return;
      }
      window.location.assign('/sales');
    } catch {
      setError('Sign-in is unavailable right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      <h1 className="m-0 text-2xl font-semibold">Sales Console</h1>
      <p className="mt-2 text-sm text-slate-600">Sign in with your sales account.</p>
      <form className="mt-6 grid gap-4" onSubmit={signIn}>
        <label className="grid gap-1 text-sm font-semibold">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        {error ? <p className="m-0 text-sm text-red-700" role="alert">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in to Sales Console'}
        </button>
      </form>
    </section>
  );
}

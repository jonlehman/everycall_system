'use client';

import { useState } from 'react';

export default function ResetPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('Ready.');
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : '';

  const submit = async () => {
    if (!token) {
      setStatus('Missing reset token.');
      return;
    }
    if (!password || password.length < 8) {
      setStatus('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setStatus('Passwords do not match.');
      return;
    }
    setStatus('Submitting...');
    const resp = await fetch('/api/v1/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    });
    if (!resp.ok) {
      setStatus('Reset failed.');
      return;
    }
    setStatus('Password updated. Redirecting...');
    setTimeout(() => { window.location.href = '/login'; }, 800);
  };

  return (
    <div className="auth-wrap">
      <section className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h2>Reset Password</h2>
        <p className="muted">Choose a new password for your account.</p>
        <label>New Password</label>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <label style={{ marginTop: 10 }}>Confirm Password</label>
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn brand" type="button" onClick={submit}>Reset Password</button>
          <span className="muted">{status}</span>
        </div>
      </section>
    </div>
  );
}

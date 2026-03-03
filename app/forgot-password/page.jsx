'use client';

import { useState } from 'react';
import { useEffect } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('tenant');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const roleParam = new URLSearchParams(window.location.search).get('role');
    if (roleParam === 'admin') {
      setRole('admin');
    }
  }, []);

  const requestReset = async () => {
    setStatus('Sending...');
    const resp = await fetch('/api/v1/auth/request-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setStatus(data?.error || 'Request failed.');
      return;
    }
    const data = await resp.json().catch(() => ({}));
    if (data?.delivered === false) {
      setStatus(`Email delivery failed: ${data?.deliveryError || 'mail provider error'}.`);
      return;
    }
    setStatus('Reset email sent.');
  };

  return (
    <div className="auth-wrap">
      <section className="hero">
        <h1>Forgot Password</h1>
        <p>Enter your account email and we will send a reset link.</p>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <label>Email</label>
        <input placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        <label style={{ marginTop: 10 }}>Account Type</label>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="tenant">Client User</option>
          <option value="admin">Admin User</option>
        </select>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn brand" type="button" onClick={requestReset}>
            Send Reset Email
          </button>
          <span className="muted">{status}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <a className="link" href="/login">Back to client sign in</a>
        </div>
      </section>
    </div>
  );
}

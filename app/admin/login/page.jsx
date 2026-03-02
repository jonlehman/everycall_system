'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const login = async () => {
    setStatus('Signing in...');
    const resp = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role: 'admin' })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setStatus(data?.error || 'Login failed.');
      return;
    }
    setStatus('Signed in.');
    window.location.href = '/admin/overview';
  };

  return (
    <div className="auth-wrap">
      <section className="hero">
        <h1>EveryCall Admin</h1>
        <p>Sign in to platform operations and tenant management.</p>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>Admin Console Login</h2>
        <label>Admin Email</label>
        <input placeholder="admin@everycall.io" value={email} onChange={(event) => setEmail(event.target.value)} />
        <label>Password</label>
        <input type="password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} />
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn brand" type="button" onClick={login}>
            Sign In to Admin Console
          </button>
          <span className="muted">{status}</span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
          <a className="link" href="/forgot-password?role=admin">Forgot password?</a>
          <a className="link" href="/login">Client sign in</a>
        </div>
      </section>
    </div>
  );
}

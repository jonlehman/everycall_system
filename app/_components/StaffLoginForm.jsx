'use client';

import { useState } from 'react';
import BrandLogo from './BrandLogo';

export default function StaffLoginForm() {
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

  const submitLogin = async (event) => {
    event.preventDefault();
    await login();
  };

  return (
    <div className="auth-wrap">
      <section className="hero">
        <div className="mb-6 flex justify-center">
          <BrandLogo
            label="EveryCall Admin"
            className="h-16 w-[260px]"
            imageClassName="h-full w-full object-contain"
            priority
          />
        </div>
        <h1>EveryCall Admin</h1>
        <p>Sign in to platform operations and tenant management.</p>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>Admin Console Login</h2>
        <form onSubmit={submitLogin}>
          <label htmlFor="staff-email">Admin Email</label>
          <input id="staff-email" autoComplete="username" placeholder="admin@everycall.io" value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="staff-password">Password</label>
          <input id="staff-password" autoComplete="current-password" type="password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn brand" type="submit">
              Sign In to Admin Console
            </button>
            <span className="muted">{status}</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <a className="link" href="/forgot-password?role=admin">Forgot password?</a>
            <a className="link" href="/sales/login">Sales sign in</a>
            <a className="link" href="/login">Client sign in</a>
          </div>
        </form>
      </section>
    </div>
  );
}

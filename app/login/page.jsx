'use client';

import { useState } from 'react';
import BrandLogo from '../_components/BrandLogo';

function resolveClientRedirect(nextPath, tenantKey) {
  const fallback = `/client/get-started?tenantKey=${encodeURIComponent(tenantKey || 'default')}`;
  const normalized = String(nextPath || '').trim();
  if (!normalized.startsWith('/client')) return fallback;
  if (normalized.startsWith('//')) return fallback;
  return normalized;
}

export default function LoginPage() {
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientStatus, setClientStatus] = useState('');

  const login = async ({ email, password, role, setStatus, onSuccess }) => {
    setStatus('Signing in...');
    const resp = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setStatus(data?.error || 'Login failed.');
      return;
    }
    const data = await resp.json();
    setStatus('Signed in.');
    onSuccess(data);
  };

  const submitClientLogin = async (event) => {
    event.preventDefault();
    await login({
      email: clientEmail,
      password: clientPassword,
      role: 'tenant',
      setStatus: setClientStatus,
      onSuccess: (data) => {
        const tenantKey = data?.tenantKey || 'default';
        const nextPath = new URLSearchParams(window.location.search).get('next');
        window.location.href = resolveClientRedirect(nextPath, tenantKey);
      }
    });
  };

  return (
    <div className="auth-wrap">
      <section className="hero">
        <div className="mb-6 flex justify-center">
          <BrandLogo
            className="h-16 w-[260px]"
            imageClassName="h-full w-full object-contain"
            priority
          />
        </div>
        <h1>EveryCall Workspace</h1>
        <p>Use the client workspace to run calls, knowledge review, and team settings.</p>
      </section>

      <div className="auth-grid">
        <section className="card">
          <h2>Client Workspace Login</h2>
          <p className="muted">For owners, dispatchers, and staff inside a single client account.</p>
          <form onSubmit={submitClientLogin}>
            <label>Email</label>
            <input placeholder="you@company.com" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} />
            <label>Password</label>
            <input type="password" placeholder="••••••••" value={clientPassword} onChange={(event) => setClientPassword(event.target.value)} />
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="btn brand" type="submit">
                Sign In to Client App
              </button>
              <span className="muted">{clientStatus}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <a className="link" href="/forgot-password">Forgot password?</a>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

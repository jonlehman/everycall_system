'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientStatus, setClientStatus] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminStatus, setAdminStatus] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetRole, setResetRole] = useState('tenant');
  const [resetStatus, setResetStatus] = useState('');

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

  return (
    <div className="auth-wrap">
      <section className="hero">
        <h1>EveryCall Workspace</h1>
        <p>Use the client workspace to run calls, FAQ, and team settings. Use admin only for platform ops and tenant management.</p>
      </section>

      <div className="auth-grid">
        <section className="card">
          <h2>Client Workspace Login</h2>
          <p className="muted">For owners, dispatchers, and staff inside a single client account.</p>
          <label>Email</label>
          <input placeholder="you@company.com" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} />
          <label>Password</label>
          <input type="password" placeholder="••••••••" value={clientPassword} onChange={(event) => setClientPassword(event.target.value)} />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="btn brand"
              type="button"
              onClick={() => login({
                email: clientEmail,
                password: clientPassword,
                role: 'tenant',
                setStatus: setClientStatus,
                onSuccess: (data) => {
                  const tenantKey = data?.tenantKey || 'default';
                  window.location.href = `/client/overview?tenantKey=${encodeURIComponent(tenantKey)}`;
                }
              })}
            >
              Sign In to Client App
            </button>
            <span className="muted">{clientStatus}</span>
          </div>
        </section>

        <section className="card">
          <h2>Admin Console Login</h2>
          <p className="muted">For platform operator access only.</p>
          <label>Admin Email</label>
          <input placeholder="admin@everycall.io" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
          <label>Password</label>
          <input type="password" placeholder="••••••••" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              onClick={() => login({
                email: adminEmail,
                password: adminPassword,
                role: 'admin',
                setStatus: setAdminStatus,
                onSuccess: () => {
                  window.location.href = '/admin/overview';
                }
              })}
            >
              Sign In to Admin Console
            </button>
            <span className="muted">{adminStatus}</span>
          </div>
        </section>
        <section className="card">
          <h2>Reset Password</h2>
          <p className="muted">We will email a reset link.</p>
          <label>Email</label>
          <input placeholder="you@company.com" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
          <label>Account Type</label>
          <select value={resetRole} onChange={(event) => setResetRole(event.target.value)}>
            <option value="tenant">Client User</option>
            <option value="admin">Admin User</option>
          </select>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                setResetStatus('Sending...');
                const resp = await fetch('/api/v1/auth/request-reset', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: resetEmail, role: resetRole })
                });
                setResetStatus(resp.ok ? 'Reset email sent.' : 'Request failed.');
              }}
            >
              Send Reset Email
            </button>
            <span className="muted">{resetStatus}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

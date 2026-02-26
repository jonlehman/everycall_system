export default function LoginPage() {
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
          <input placeholder="you@company.com" />
          <label>Password</label>
          <input type="password" placeholder="••••••••" />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <a className="btn brand" href="/client/overview">Sign In to Client App</a>
          </div>
        </section>

        <section className="card">
          <h2>Admin Console Login</h2>
          <p className="muted">For platform operator access only.</p>
          <label>Admin Email</label>
          <input placeholder="admin@everycall.io" />
          <label>Password</label>
          <input type="password" placeholder="••••••••" />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <a className="btn" href="/admin/overview">Sign In to Admin Console</a>
          </div>
        </section>
      </div>
    </div>
  );
}

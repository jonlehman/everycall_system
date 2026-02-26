export default function AdminMonitoringPage() {
  return (
    <section className="screen active">
      <div className="topbar"><h1>Live Call Monitoring</h1></div>
      <div className="card">
        <p className="muted">Uses the same feed as the Operator Dashboard, but cross-tenant.</p>
        <a className="btn" href="/dashboard">Open Operator Dashboard View</a>
      </div>
    </section>
  );
}

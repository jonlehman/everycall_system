'use client';

export default function SetupOverviewPage() {
  return (
    <section className="screen active">
      <div className="topbar"><h1>Setup Overview</h1></div>
      <div className="card">
        <p className="muted">Complete these steps to configure your workspace.</p>
        <div className="grid cols-2">
          <div className="card">
            <h2>Questions and Answers</h2>
            <p className="muted">Add customer-facing FAQs the receptionist can answer instantly.</p>
          </div>
          <div className="card">
            <h2>Team Users</h2>
            <p className="muted">Invite teammates and set roles for access control.</p>
          </div>
          <div className="card">
            <h2>Call Routing</h2>
            <p className="muted">Define emergency handling, callbacks, and after-hours behavior.</p>
          </div>
          <div className="card">
            <h2>Account Settings</h2>
            <p className="muted">Review plan, region, and compliance details.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

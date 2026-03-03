'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ClientPage from '../_components/ClientPage';

function TaskCard({ title, description, href, done, cta }) {
  return (
    <div className="card">
      <div className="topbar" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className={`badge ${done ? 'ok' : 'warn'}`}>{done ? 'Done' : 'Needs Review'}</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{description}</p>
      <Link className="btn brand" href={href}>{cta}</Link>
    </div>
  );
}

export default function SetupOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ message: 'Loading setup checklist...', tone: 'warn' });
  const [summary, setSummary] = useState({
    faqCount: 0,
    teamCount: 0,
    routingReady: false,
    settingsReady: false
  });

  const loadChecklist = async () => {
    setLoading(true);
    setStatus({ message: 'Loading setup checklist...', tone: 'warn' });
    try {
      const [faqResp, teamResp, routingResp, settingsResp] = await Promise.all([
        fetch('/api/v1/faq'),
        fetch('/api/v1/tenant/users'),
        fetch('/api/v1/routing'),
        fetch('/api/v1/settings')
      ]);

      const [faqData, teamData, routingData, settingsData] = await Promise.all([
        faqResp.ok ? faqResp.json() : null,
        teamResp.ok ? teamResp.json() : null,
        routingResp.ok ? routingResp.json() : null,
        settingsResp.ok ? settingsResp.json() : null
      ]);

      const faqCount = Array.isArray(faqData?.faqs) ? faqData.faqs.length : 0;
      const teamCount = Array.isArray(teamData?.users) ? teamData.users.length : 0;
      const routingReady = Boolean(
        routingData?.routing?.primary_queue &&
        routingData?.routing?.emergency_behavior &&
        routingData?.routing?.after_hours_behavior &&
        String(routingData?.routing?.business_hours || '').trim()
      );
      const settingsReady = Boolean(
        String(settingsData?.settings?.timezone || '').trim() &&
        String(settingsData?.tenant?.name || '').trim()
      );

      setSummary({ faqCount, teamCount, routingReady, settingsReady });
      setStatus({ message: 'Checklist loaded. Review any items marked "Needs Review".', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load setup checklist. Retry from this page.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChecklist();
  }, []);

  const completedCount = useMemo(() => {
    let done = 0;
    if (summary.faqCount > 0) done += 1;
    if (summary.teamCount > 0) done += 1;
    if (summary.routingReady) done += 1;
    if (summary.settingsReady) done += 1;
    return done;
  }, [summary]);

  return (
    <ClientPage
      title="Setup Checklist"
      subtitle="Use this page to complete core setup in the right order."
      status={status}
      primaryAction={{ label: 'Reload Checklist', brand: true, onClick: loadChecklist, disabled: loading }}
    >
      <div className="card">
        <div className="topbar" style={{ marginBottom: 0 }}>
          <div>
            <div className="stat">Setup Progress</div>
            <div className="value" style={{ fontSize: 24 }}>{completedCount}/4 complete</div>
          </div>
          <div className="muted">Complete FAQ, Team, Routing, and Settings to finish baseline setup.</div>
        </div>
      </div>

      <div className="grid cols-2">
        <TaskCard
          title="Questions and Answers"
          description={`Current FAQ items: ${summary.faqCount}. Add or refine answers used by the receptionist.`}
          href="/client/faq"
          done={summary.faqCount > 0}
          cta="Open FAQ Manager"
        />
        <TaskCard
          title="Team Users"
          description={`Current team users: ${summary.teamCount}. Invite teammates and configure access.`}
          href="/client/team"
          done={summary.teamCount > 0}
          cta="Open Team Users"
        />
        <TaskCard
          title="Call Routing"
          description="Confirm emergency and after-hours behavior so callers always get a clear next step."
          href="/client/routing"
          done={summary.routingReady}
          cta="Open Routing"
        />
        <TaskCard
          title="Account Settings"
          description="Review tenant profile and operational defaults like timezone and notes."
          href="/client/settings"
          done={summary.settingsReady}
          cta="Open Settings"
        />
      </div>
    </ClientPage>
  );
}

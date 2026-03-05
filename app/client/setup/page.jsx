'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import ClientPage from '../_components/ClientPage';

function TaskCard({ title, description, href, done, cta }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <span className={`badge ${done ? 'ok' : 'warn'}`}>{done ? 'Done' : 'Needs Review'}</span>
      </div>
      <p className="mt-0 text-sm text-slate-500">{description}</p>
      <Link className={cn(buttonVariants({ variant: 'default' }))} href={href}>{cta}</Link>
    </div>
  );
}

export default function SetupOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [savingForwarding, setSavingForwarding] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading setup checklist...', tone: 'warn' });
  const [summary, setSummary] = useState({
    faqCount: 0,
    teamCount: 0,
    routingReady: false,
    settingsReady: false,
    forwardingReady: false,
    unresolvedBlankFaqCount: 0,
    assistantReady: false
  });

  const loadChecklist = async () => {
    setLoading(true);
    setStatus({ message: 'Loading setup checklist...', tone: 'warn' });
    try {
      const [faqResp, teamResp, routingResp, settingsResp, assistantResp] = await Promise.all([
        fetch('/api/v1/faq'),
        fetch('/api/v1/tenant/users'),
        fetch('/api/v1/routing'),
        fetch('/api/v1/settings'),
        fetch('/api/v1/assistant/status')
      ]);

      const [faqData, teamData, routingData, settingsData, assistantData] = await Promise.all([
        faqResp.ok ? faqResp.json() : null,
        teamResp.ok ? teamResp.json() : null,
        routingResp.ok ? routingResp.json() : null,
        settingsResp.ok ? settingsResp.json() : null,
        assistantResp.ok ? assistantResp.json() : null
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

      setSummary({
        faqCount,
        teamCount,
        routingReady,
        settingsReady,
        forwardingReady: Boolean(assistantData?.assistant?.checks?.forwardingReady),
        unresolvedBlankFaqCount: Number(assistantData?.assistant?.unresolvedBlankFaqCount || 0),
        assistantReady: Boolean(assistantData?.assistant?.ready)
      });
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

  const updateForwardingStatus = async (nextStatus) => {
    setSavingForwarding(true);
    setStatus({ message: 'Saving forwarding status...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/tenants/forwarding-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        setStatus({ message: data?.message || 'Could not save forwarding status.', tone: 'bad' });
        return;
      }
      await loadChecklist();
      setStatus({ message: 'Forwarding status updated.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save forwarding status.', tone: 'bad' });
    } finally {
      setSavingForwarding(false);
    }
  };

  const completedCount = useMemo(() => {
    let done = 0;
    if (summary.faqCount > 0) done += 1;
    if (summary.teamCount > 0) done += 1;
    if (summary.routingReady) done += 1;
    if (summary.settingsReady) done += 1;
    if (summary.forwardingReady) done += 1;
    if (summary.unresolvedBlankFaqCount === 0) done += 1;
    return done;
  }, [summary]);

  return (
    <ClientPage
      title="Setup Checklist"
      subtitle="Use this page to complete core setup in the right order."
      status={status}
      primaryAction={{ label: 'Reload Checklist', brand: true, onClick: loadChecklist, disabled: loading }}
    >
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Setup Progress</div>
            <div className="text-2xl font-bold">{completedCount}/6 complete</div>
          </div>
          <div className="text-sm text-slate-500">Complete forwarding, FAQ, Team, Routing, and Settings to unlock assistant enablement.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TaskCard
          title="Questions and Answers"
          description={`Current FAQ items: ${summary.faqCount}. Resolve ${summary.unresolvedBlankFaqCount} blank industry FAQ items (answer or delete).`}
          href="/client/faq"
          done={summary.faqCount > 0 && summary.unresolvedBlankFaqCount === 0}
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
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Forwarding Activation</div>
        <div className="mb-2 text-sm text-slate-600">Set forwarding status before enabling assistant call handling.</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${summary.forwardingReady ? 'ok' : 'warn'}`}>{summary.forwardingReady ? 'Ready' : 'Needs Review'}</span>
          <button className="btn" type="button" onClick={() => updateForwardingStatus('acknowledged')} disabled={savingForwarding}>I Will Configure Later</button>
          <button className="btn brand" type="button" onClick={() => updateForwardingStatus('configured')} disabled={savingForwarding}>I Configured Forwarding</button>
        </div>
      </div>
      {!summary.assistantReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Assistant remains disabled until all setup items are complete.
        </div>
      ) : null}
    </ClientPage>
  );
}

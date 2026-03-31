'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import ClientPage from '../_components/ClientPage';
import { getLeadStatusMeta } from '../../../lib/leadBilling';

function formatMoney(amountCents) {
  const value = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function LeadStatusPill({ call }) {
  const meta = getLeadStatusMeta(call || {});
  const toneClass = meta.tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : meta.tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass}`}>
      {meta.label}
    </span>
  );
}

export default function ClientDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading dashboard...' });

  useEffect(() => {
    let mounted = true;
    fetchJson('/api/v1/client/dashboard')
      .then((data) => {
        if (!mounted) return;
        setDashboard(data);
        setStatus({ tone: 'ok', message: 'Dashboard loaded.' });
        setLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        setStatus({ tone: 'bad', message: error?.message || 'Could not load dashboard.' });
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const summary = dashboard?.summary || {};
  const billing = dashboard?.billing || {};
  const launch = dashboard?.launch || {};
  const recentLeads = Array.isArray(dashboard?.recentLeads) ? dashboard.recentLeads : [];
  const recentCalls = Array.isArray(dashboard?.recentCalls) ? dashboard.recentCalls : [];
  const nextSteps = Array.isArray(dashboard?.nextSteps) ? dashboard.nextSteps : [];
  const readinessOk = ['ready_for_go_live', 'live'].includes(String(launch.readinessStatus || '').trim().toLowerCase());

  return (
    <ClientPage
      title="Dashboard"
      subtitle="Track leads, launch readiness, and billing from one place."
      status={status}
      primaryAction={{ href: '/client/calls', label: 'Open Calls', brand: true }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Calls (30d)</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{Number(summary.calls30d || 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Valid Leads</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{Number(summary.validLeadCount || 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Billable Leads</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{Number(summary.billableLeadCount || 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Open Follow-up</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{Number(summary.openFollowUpCount || 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Current Invoice Estimate</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{formatMoney(billing?.invoiceEstimate?.totalEstimatedInvoiceCents)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
        <div className="grid min-w-0 gap-3">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Launch Readiness</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  Keep the Sales Receptionist specific, reachable, and fully visible to your team before going live.
                </p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${readinessOk ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {readinessOk ? 'Ready for Go Live' : 'Needs Attention'}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-sm md:grid-cols-[220px_1fr]">
              <div>Published builds</div><div>{Number(launch.publishedBuildCount || 0)}</div>
              <div>Latest build status</div><div>{launch.latestBuildStatus || 'None yet'}</div>
              <div>Notifications ready</div><div>{launch.notificationsReady ? 'Yes' : 'No'}</div>
            </div>
            {Array.isArray(launch.blockers) && launch.blockers.length ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-semibold text-amber-900">Current blockers</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {launch.blockers.map((blocker) => (
                    <span key={blocker} className="rounded-full bg-white px-2 py-1 text-xs text-amber-800">
                      {String(blocker).replaceAll('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link className={cn(buttonVariants({ variant: 'default' }))} href="/client/receptionist/go-live">
                Open Go Live Checklist
              </Link>
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/receptionist/knowledge">
                Open Knowledge
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Recent Leads</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  The newest valid leads that have come through the Sales Receptionist.
                </p>
              </div>
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/account/billing">
                Open Billing
              </Link>
            </div>
            <div className="mt-4 grid gap-2">
              {recentLeads.length ? recentLeads.map((lead) => (
                <div key={lead.call_sid} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-900">
                        {[lead.caller_first_name, lead.caller_last_name].filter(Boolean).join(' ') || 'Unknown caller'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{lead.callback_number || 'No callback number'}</div>
                    </div>
                    <LeadStatusPill call={lead} />
                  </div>
                  <div className="mt-2 text-sm text-slate-700">{lead.summary || 'No summary yet.'}</div>
                  <div className="mt-1 text-xs text-slate-500">{lead.service_required || 'No specific service request captured yet.'}</div>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No valid leads have been recorded yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Recent Calls</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  Review classification, summaries, and follow-up work quickly.
                </p>
              </div>
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/calls">
                View All Calls
              </Link>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Time</th>
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Summary</th>
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Lead Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.length ? recentCalls.map((call) => (
                    <tr key={call.call_sid} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-3 text-sm text-slate-600">{formatDateTime(call.created_at)}</td>
                      <td className="px-2 py-3 text-sm text-slate-700">{call.summary || 'No summary yet.'}</td>
                      <td className="px-2 py-3 text-sm text-slate-700"><LeadStatusPill call={call} /></td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="px-2 py-6 text-sm text-slate-500">No recent calls yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Billing Snapshot</h2>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-[160px_1fr] xl:grid-cols-[140px_1fr]">
              <div>Status</div><div>{billing.status || '-'}</div>
              <div>Plan</div><div>{billing.plan?.code || '-'}</div>
              <div>Base monthly</div><div>{formatMoney(billing.plan?.monthlyAmountCents)}</div>
              <div>Lead rate</div><div>{formatMoney(billing.leadPricing?.rateCents)} / lead</div>
              <div>Billing window</div><div>{billing.currentPeriod?.label || '-'}</div>
            </div>
            <div className="mt-4">
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/account/billing">
                Open Billing Details
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Recommended Next Steps</h2>
            <div className="mt-3 grid gap-2">
              {nextSteps.length ? nextSteps.map((step) => (
                <Link key={`${step.href}-${step.title}`} href={step.href} className="rounded-lg border border-slate-200 p-3 transition hover:border-slate-300 hover:bg-slate-50">
                  <div className="font-medium text-slate-900">{step.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{step.body}</div>
                </Link>
              )) : (
                <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-500">
                  The main launch tasks are already in place. Review recent calls and follow-up speed from the Calls page.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Need Help?</h2>
            <p className="m-0 mt-2 text-sm text-slate-500">
              The Support page explains valid lead billing, the knowledge build flow, integrations setup, and what to check before going live.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/account/support">
                Open Support
              </Link>
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/account/integrations">
                Open Integrations
              </Link>
            </div>
          </section>
        </div>
      </div>
    </ClientPage>
  );
}

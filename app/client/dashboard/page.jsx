'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import ClientPage from '../_components/ClientPage';
import { formatLeadOutcomeLabel, getLeadStatusMeta } from '../../../lib/leadBilling';

const CATEGORY_ORDER = [
  'project_inquiry',
  'general_inquiry',
  'existing_customer_support',
  'vendor_or_sales',
  'spam',
  'wrong_number',
  'hangup_or_incomplete',
  'other_non_billable'
];

const CATEGORY_TONE = {
  project_inquiry: 'border-[#205cb5]/30 bg-[#eef4ff] text-[#205cb5]',
  general_inquiry: 'border-slate-200 bg-slate-50 text-slate-700',
  existing_customer_support: 'border-slate-200 bg-slate-50 text-slate-700',
  vendor_or_sales: 'border-slate-200 bg-slate-50 text-slate-700',
  spam: 'border-slate-200 bg-slate-50 text-slate-700',
  wrong_number: 'border-slate-200 bg-slate-50 text-slate-700',
  hangup_or_incomplete: 'border-slate-200 bg-slate-50 text-slate-700',
  other_non_billable: 'border-slate-200 bg-slate-50 text-slate-700'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCallCategory(outcomeType, isValidLead) {
  const normalized = normalizeText(outcomeType).toLowerCase();
  if (
    isValidLead
    || [
      'callback_request',
      'estimate_request',
      'quote_request',
      'consultation_request',
      'appointment_request',
      'project_request',
      'project_inquiry',
      'service_request',
      'lead',
      'new_customer_lead',
      'message_taken',
      'transfer'
    ].includes(normalized)
  ) {
    return 'project_inquiry';
  }
  if (['general_inquiry', 'general_question', 'question_only'].includes(normalized)) {
    return 'general_inquiry';
  }
  if (normalized === 'existing_customer_support' || normalized === 'existing_customer') {
    return 'existing_customer_support';
  }
  if (['vendor_or_sales', 'vendor', 'sales_call'].includes(normalized)) {
    return 'vendor_or_sales';
  }
  if (normalized === 'spam') {
    return 'spam';
  }
  if (normalized === 'wrong_number') {
    return 'wrong_number';
  }
  if (['hangup', 'hangup_incomplete', 'canceled'].includes(normalized)) {
    return 'hangup_or_incomplete';
  }
  return 'other_non_billable';
}

function formatMoney(amountCents) {
  const value = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatTimeOnly(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDayLabel(value) {
  if (!value) return '-';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString([], { weekday: 'short' });
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

function MetricCard({ label, value, eyebrow = null, accent = null }) {
  return (
    <div className="workspace-panel flex min-h-[150px] flex-col justify-between border-b-2 border-b-transparent p-6 transition-all hover:border-b-[#205cb5]">
      <div>
        <div className="mb-5 flex items-start justify-between gap-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">{label}</span>
          {eyebrow ? (
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${accent || 'bg-slate-100 text-slate-600'}`}>
              {eyebrow}
            </span>
          ) : null}
        </div>
        <div className="font-['Space_Grotesk'] text-4xl font-bold tracking-[-0.04em] text-slate-950">{value}</div>
      </div>
    </div>
  );
}

function LeadStatusPill({ call }) {
  const meta = getLeadStatusMeta(call || {});
  const toneClass = meta.tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : meta.tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${toneClass}`}>
      {meta.label}
    </span>
  );
}

function ActionTile({ href, icon, title }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#205cb5]/20 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef4ff] text-[#205cb5]">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        <div className="font-medium text-slate-900">{title}</div>
      </div>
    </Link>
  );
}

export default function ClientDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading dashboard...' });

  useEffect(() => {
    let mounted = true;
    fetchJson('/api/v1/client/dashboard')
      .then((data) => {
        if (!mounted) return;
        setDashboard(data);
        setStatus(null);
      })
      .catch((error) => {
        if (!mounted) return;
        setStatus({ tone: 'bad', message: error?.message || 'Could not load dashboard.' });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const summary = dashboard?.summary || {};
  const billing = dashboard?.billing || {};
  const setup = dashboard?.setup || {};
  const classificationBreakdown = Array.isArray(dashboard?.classificationBreakdown) ? dashboard.classificationBreakdown : [];
  const recentCalls = Array.isArray(dashboard?.recentCalls) ? dashboard.recentCalls : [];
  const callVolumeLast7Days = Array.isArray(dashboard?.callVolumeLast7Days) ? dashboard.callVolumeLast7Days : [];
  const knowledgeSignals = dashboard?.knowledgeSignals || {};
  const runtimeReady = Boolean(setup.runtimeReady);
  const latestBuildLabel = setup.latestBuildStatus ? formatLeadOutcomeLabel(setup.latestBuildStatus) : 'No knowledge base yet';
  const maxTrendCount = Math.max(1, ...callVolumeLast7Days.map((day) => Number(day.count || 0)));
  const kbQuestionCount = Number(knowledgeSignals.kbQuestionCount30d || 0);
  const kbCallCount = Number(knowledgeSignals.kbCallCount30d || 0);
  const unansweredQuestionCalls = Number(knowledgeSignals.unansweredQuestionCalls30d || 0);
  const unansweredKbCallCount = Number(knowledgeSignals.unansweredKbCallCount30d || 0);
  const answeredQuestionRate = Number(knowledgeSignals.answeredQuestionRate30d || 0);
  const needsKnowledgeDetail = unansweredQuestionCalls >= 3 || (kbQuestionCount >= 8 && answeredQuestionRate < 80);

  const orderedBreakdown = useMemo(() => {
    const byKey = new Map(classificationBreakdown.map((item) => [item.key, item]));
    return CATEGORY_ORDER.map((key) => byKey.get(key) || {
      key,
      label: formatLeadOutcomeLabel(key),
      count: 0,
      percent: 0
    });
  }, [classificationBreakdown]);

  return (
    <ClientPage
      title="Dashboard"
      subtitle=""
      status={status}
      headerAside={billing?.currentPeriod?.label ? (
        <div className="inline-flex items-center gap-2 rounded-full bg-[#eef2f6] px-3 py-2 text-sm font-medium text-slate-600">
          <span className="material-symbols-outlined text-[18px]">calendar_today</span>
          {billing.currentPeriod.label}
        </div>
      ) : null}
      primaryAction={{ href: '/client/calls', label: 'Open Calls', brand: true }}
    >
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Calls Handled"
          value={Number(summary.calls30d || 0)}
          eyebrow="Last 30 Days"
          accent="bg-[#eef4ff] text-[#205cb5]"
        />
        <MetricCard
          label="Lead Capture Rate"
          value={formatPercent(summary.leadCaptureRate30d || 0)}
          eyebrow={`${Number(summary.validLeadCount30d || 0)} valid leads`}
          accent="bg-emerald-100 text-emerald-800"
        />

        <div className="workspace-panel xl:col-span-3 p-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Call Classification Breakdown</div>
              <h2 className="mt-3 font-['Space_Grotesk'] text-2xl font-bold tracking-[-0.03em] text-slate-950">Call Mix</h2>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
              Last 30 Days
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
            {orderedBreakdown.map((item) => (
              <div key={item.key} className={`border-l-2 pl-3 ${item.key === 'project_inquiry' ? 'border-[#205cb5]' : 'border-slate-200'}`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  {item.label}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-['Space_Grotesk'] text-2xl font-bold tracking-[-0.03em] text-slate-950">
                    {Number(item.count || 0)}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{Number(item.percent || 0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="mb-4 flex items-center justify-between px-1">
            <h2 className="font-['Space_Grotesk'] text-2xl font-bold tracking-[-0.03em] text-slate-950">Recent Calls</h2>
            <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/calls">
              View All Calls
            </Link>
          </div>

          <div className="workspace-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead className="bg-[#eef2f6]">
                  <tr>
                    <th className="px-6 py-4 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Time</th>
                    <th className="px-6 py-4 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Caller</th>
                    <th className="px-6 py-4 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Summary</th>
                    <th className="px-6 py-4 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Category</th>
                    <th className="px-6 py-4 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Status</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentCalls.length ? recentCalls.map((call) => {
                    const categoryKey = normalizeCallCategory(call.lead_outcome_type, call.lead_is_valid);
                    const callerName = [call.caller_first_name, call.caller_last_name].filter(Boolean).join(' ') || 'Unknown caller';
                    const categoryLabel = orderedBreakdown.find((item) => item.key === categoryKey)?.label || formatLeadOutcomeLabel(categoryKey);
                    return (
                      <tr key={call.call_sid} className="transition-colors hover:bg-slate-50/70">
                        <td className="px-6 py-4 align-top">
                          <div className="font-mono text-sm text-slate-700">{formatTimeOnly(call.created_at)}</div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="font-medium text-slate-900">{callerName}</div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="max-w-[320px] text-sm leading-6 text-slate-700">{call.summary || 'No summary yet.'}</div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${CATEGORY_TONE[categoryKey] || CATEGORY_TONE.other_non_billable}`}>
                            {categoryLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <LeadStatusPill call={call} />
                        </td>
                        <td className="px-6 py-4 align-top text-right">
                          <Link
                            href="/client/calls"
                            className="inline-flex items-center gap-1 text-sm font-semibold text-[#205cb5] hover:text-[#0b3d87]"
                          >
                            Open
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-sm text-slate-500">
                        No recent calls yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:col-span-4">
          <section className="rounded-2xl bg-[#205cb5] p-6 text-white shadow-[0_24px_60px_rgba(32,92,181,0.24)]">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-['Space_Grotesk'] text-lg font-bold uppercase tracking-[0.16em]">Knowledge Coverage</h2>
              <span className="material-symbols-outlined">smart_toy</span>
            </div>
            <div className="space-y-5">
              <div>
                <div className="text-xs font-mono uppercase tracking-[0.14em] text-white/75">Unanswered KB questions</div>
                <div className="mt-2 flex items-end gap-3">
                  <span className="font-['Space_Grotesk'] text-5xl font-bold tracking-[-0.05em] text-white">{unansweredQuestionCalls}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${needsKnowledgeDetail ? 'bg-amber-200 text-amber-950' : 'bg-emerald-200 text-emerald-950'}`}>
                    {needsKnowledgeDetail ? 'Needs Detail' : 'Healthy'}
                  </span>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-mono uppercase tracking-[0.14em] text-white/75">
                  <span>Answered from KB</span>
                  <span>{formatPercent(answeredQuestionRate)}</span>
                </div>
                <div className="h-2 rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-white"
                    style={{ width: `${Math.max(6, Math.min(100, answeredQuestionRate))}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80">KB questions</span>
                <span className="text-sm font-bold">{kbQuestionCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80">Calls using KB</span>
                <span className="text-sm font-bold">{kbCallCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80">Calls with gaps</span>
                <span className="text-sm font-bold">{unansweredKbCallCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80">Latest KB</span>
                <span className="text-right text-sm font-bold">{latestBuildLabel}</span>
              </div>
            </div>
            <div className="mt-6 border-t border-white/15 pt-5 text-sm leading-6 text-white/85">
              {!runtimeReady
                ? 'Create a knowledge base.'
                : kbQuestionCount === 0
                  ? 'No KB questions yet.'
                  : (needsKnowledgeDetail ? 'Add detail for repeated unanswered questions.' : 'Coverage looks healthy.')}
            </div>
          </section>

          <section className="workspace-panel-soft p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-['Space_Grotesk'] text-lg font-bold uppercase tracking-[0.16em] text-slate-900">Quick Actions</h2>
              <span className="material-symbols-outlined text-[#205cb5]">bolt</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <ActionTile
                href="/client/calls"
                icon="phone_in_talk"
                title="Review Calls"
              />
              <ActionTile
                href="/client/receptionist/knowledge"
                icon="school"
                title="Update Knowledge Base"
              />
              <ActionTile
                href="/client/receptionist/basics"
                icon="record_voice_over"
                title="Adjust Basics"
              />
              <ActionTile
                href="/client/team"
                icon="groups"
                title="Manage Team Alerts"
              />
            </div>
          </section>
        </div>
      </section>

      <section className="workspace-panel p-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-['Space_Grotesk'] text-2xl font-bold tracking-[-0.03em] text-slate-950">Call Volume</h2>
          <div className="rounded-full bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
            Last 7 Days
          </div>
        </div>

        <div className="relative grid h-[250px] grid-cols-7 items-end gap-4">
          {callVolumeLast7Days.map((day) => {
            const count = Number(day.count || 0);
            const height = `${Math.max(10, (count / maxTrendCount) * 100)}%`;
            return (
              <div key={day.day} className="flex h-full flex-col items-center justify-end gap-3">
                <div className="text-xs font-semibold text-slate-500">{count}</div>
                <div className="relative flex h-[190px] w-full items-end justify-center">
                  <div className="absolute inset-x-3 bottom-0 top-0 rounded-t-xl bg-slate-100" />
                  <div
                    className="relative z-10 w-full rounded-t-xl bg-[#205cb5] shadow-[0_10px_25px_rgba(32,92,181,0.18)]"
                    style={{ height }}
                  />
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">{formatDayLabel(day.day)}</div>
              </div>
            );
          })}
        </div>
      </section>
    </ClientPage>
  );
}

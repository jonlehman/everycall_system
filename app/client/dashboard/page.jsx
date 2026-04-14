'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

const CATEGORY_COLOR = {
  project_inquiry: '#205cb5',
  general_inquiry: '#6e9ffd',
  existing_customer_support: '#94a3b8',
  vendor_or_sales: '#cbd5e1',
  spam: '#fecaca',
  wrong_number: '#e2e8f0',
  hangup_or_incomplete: '#bac8dc',
  other_non_billable: '#d7dadc'
};

const QUESTION_HANDLING_TOOLTIP = 'Review these periodically and update Knowledge Base documents so that your receptionist can answer caller questions properly.';

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
  if (normalized === 'spam') return 'spam';
  if (normalized === 'wrong_number') return 'wrong_number';
  if (['hangup', 'hangup_incomplete', 'canceled'].includes(normalized)) {
    return 'hangup_or_incomplete';
  }
  return 'other_non_billable';
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatTimeOnly(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDayLabel(value) {
  if (!value) return '-';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
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

async function loadDashboard() {
  return fetchJson('/api/v1/client/dashboard');
}

function panelClassName(extra = '') {
  return `rounded-xl border border-slate-200/70 bg-white shadow-sm ${extra}`.trim();
}

function KpiCard({ label, value, meta = '', progress = null }) {
  return (
    <section className={panelClassName('p-6')}>
      <div className="mb-4">
        <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-['Space_Grotesk'] text-4xl font-bold tracking-[-0.04em] text-slate-950">{value}</span>
        {meta ? <span className="text-xs font-medium text-slate-500">{meta}</span> : null}
      </div>
      {progress !== null ? (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[#205cb5]" style={{ width: `${Math.max(4, Math.min(100, Number(progress || 0)))}%` }} />
        </div>
      ) : null}
    </section>
  );
}

function LeadStatusPill({ call }) {
  const meta = getLeadStatusMeta(call || {});
  const toneClass = meta.tone === 'ok'
    ? 'bg-[#d8e2ff] text-[#205cb5]'
    : meta.tone === 'warn'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-slate-100 text-slate-600';
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold normal-case tracking-normal ${toneClass}`}>
      {meta.label}
    </span>
  );
}

function CategoryPill({ categoryKey, label }) {
  if (categoryKey === 'project_inquiry') {
    return <span className="rounded-full bg-[#d6e4f9] px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-[#205cb5]">Lead</span>;
  }
  if (categoryKey === 'existing_customer_support') {
    return <span className="rounded-full bg-[#e5e9eb] px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-slate-600">Support</span>;
  }
  if (categoryKey === 'spam' || categoryKey === 'vendor_or_sales') {
    return <span className="rounded-full bg-[#ffdad6] px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-[#93000a]">{label}</span>;
  }
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-slate-600">{label}</span>;
}

function ActionRow({ href, icon, title }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-slate-200/70 p-3 transition-all hover:bg-[#f1f4f6]"
    >
      <span className="material-symbols-outlined text-[#205cb5]">{icon}</span>
      <span className="text-sm font-medium text-slate-900 transition-transform group-hover:translate-x-1">{title}</span>
    </Link>
  );
}

function buildCallMixGradient(items) {
  const slices = items.filter((item) => Number(item.count || 0) > 0);
  if (!slices.length) {
    return 'conic-gradient(#e2e8f0 0deg 360deg)';
  }

  let current = 0;
  const stops = slices.map((item) => {
    const percent = Number(item.percent || 0);
    const start = current;
    const degrees = (percent / 100) * 360;
    current += degrees;
    return `${CATEGORY_COLOR[item.key] || CATEGORY_COLOR.other_non_billable} ${start}deg ${current}deg`;
  });

  if (current < 360) {
    stops.push(`#e2e8f0 ${current}deg 360deg`);
  }

  return `conic-gradient(${stops.join(', ')})`;
}

export default function ClientDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading reports...' });
  const [expandedKnowledgeList, setExpandedKnowledgeList] = useState(null);
  const [retryingTranscriptAnalysis, setRetryingTranscriptAnalysis] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadDashboard()
      .then((data) => {
        if (!mounted) return;
        setDashboard(data);
        setStatus(null);
      })
      .catch((error) => {
        if (!mounted) return;
        setStatus({ tone: 'bad', message: error?.message || 'Could not load reports.' });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const summary = dashboard?.summary || {};
  const setup = dashboard?.setup || {};
  const billing = dashboard?.billing || {};
  const viewer = dashboard?.viewer || {};
  const classificationBreakdown = Array.isArray(dashboard?.classificationBreakdown) ? dashboard.classificationBreakdown : [];
  const recentCalls = Array.isArray(dashboard?.recentCalls) ? dashboard.recentCalls : [];
  const callVolumeLast7Days = Array.isArray(dashboard?.callVolumeLast7Days) ? dashboard.callVolumeLast7Days : [];
  const knowledgeSignals = dashboard?.knowledgeSignals || {};
  const answeredKnowledgeQuestions = Array.isArray(dashboard?.answeredKnowledgeQuestions) ? dashboard.answeredKnowledgeQuestions : [];
  const knowledgeGapQuestions = Array.isArray(dashboard?.knowledgeGapQuestions) ? dashboard.knowledgeGapQuestions : [];
  const kbQuestionCount = Number(knowledgeSignals.kbQuestionCount30d || 0);
  const answeredQuestionCount = Number(
    knowledgeSignals.answeredQuestionCount30d
    ?? Math.max(0, Number(knowledgeSignals.kbQuestionCount30d || 0) - Number(knowledgeSignals.unansweredQuestionCount30d || 0))
  );
  const unansweredQuestionCount = Number(
    knowledgeSignals.unansweredQuestionCount30d
    ?? knowledgeSignals.unansweredQuestionCalls30d
    ?? 0
  );
  const canManageKnowledgeAnalysis = Boolean(viewer.canManageKnowledgeAnalysis);
  const pendingTranscriptAnalysisCallCount = Number(knowledgeSignals.pendingTranscriptAnalysisCallCount30d || 0);
  const failedTranscriptAnalysisCallCount = Number(knowledgeSignals.failedTranscriptAnalysisCallCount30d || 0);
  const answeredQuestionRate = Number(knowledgeSignals.answeredQuestionRate30d || 0);
  const maxTrendCount = Math.max(1, ...callVolumeLast7Days.map((day) => Number(day.totalCount || day.count || 0)));

  useEffect(() => {
    if (expandedKnowledgeList === 'answered' && !answeredQuestionCount) {
      setExpandedKnowledgeList(null);
    }
    if (expandedKnowledgeList === 'unanswered' && !unansweredQuestionCount) {
      setExpandedKnowledgeList(null);
    }
  }, [answeredQuestionCount, unansweredQuestionCount, expandedKnowledgeList]);

  async function handleRetryTranscriptAnalysis() {
    setRetryingTranscriptAnalysis(true);
    const isRetry = failedTranscriptAnalysisCallCount > 0;
    setStatus({ tone: 'warn', message: isRetry ? 'Retrying transcript analysis...' : 'Queueing transcript analysis...' });
    try {
      await fetchJson('/api/v1/client/dashboard/transcript-analysis/retry', {
        method: 'POST'
      });
      const refreshed = await loadDashboard();
      setDashboard(refreshed);
      setStatus({ tone: 'ok', message: isRetry ? 'Transcript analysis retry queued.' : 'Transcript analysis queued.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not retry transcript analysis.' });
    } finally {
      setRetryingTranscriptAnalysis(false);
    }
  }

  const orderedBreakdown = useMemo(() => {
    const byKey = new Map(classificationBreakdown.map((item) => [item.key, item]));
    return CATEGORY_ORDER.map((key) => byKey.get(key) || {
      key,
      label: formatLeadOutcomeLabel(key),
      count: 0,
      percent: 0
    });
  }, [classificationBreakdown]);
  const callMixGradient = useMemo(() => buildCallMixGradient(orderedBreakdown), [orderedBreakdown]);

  return (
    <ClientPage
      title="Reports"
      subtitle=""
      status={status}
      headerAside={(
        <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-[#f1f4f6] px-4 py-2 text-sm font-medium text-slate-700">
          <span>Last 30 Days</span>
          <span className="material-symbols-outlined text-[18px]">expand_more</span>
        </div>
      )}
      primaryAction={{ href: '/client/calls', label: 'Open Calls', brand: true }}
    >
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.95fr)]">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <KpiCard
            label="Calls Handled"
            value={Number(summary.calls30d || 0)}
            meta={billing?.currentPeriod?.label ? billing.currentPeriod.label : ''}
          />
          <KpiCard
            label="Lead Capture Rate"
            value={formatPercent(summary.leadCaptureRate30d || 0)}
            meta="Target: 90%"
            progress={summary.leadCaptureRate30d || 0}
          />
          <KpiCard
            label="Valid Leads"
            value={Number(summary.validLeadCount30d || 0)}
          />
          <KpiCard
            label="Open Follow-Up"
            value={Number(summary.openFollowUpCount || 0)}
          />
        </div>

        <section className={panelClassName('p-6')}>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold normal-case tracking-normal text-slate-500">Call Mix</div>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
            <div className="flex items-center justify-center">
              <div
                className="relative h-40 w-40 rounded-full"
                style={{ background: callMixGradient }}
                aria-label="Call mix pie chart"
                role="img"
              >
                <div className="absolute inset-[22%] rounded-full bg-white" />
              </div>
            </div>
            <div className="space-y-2">
              {orderedBreakdown.map((item) => (
                <div key={item.key} className="grid grid-cols-[auto_minmax(0,1fr)_40px_44px] items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLOR[item.key] || CATEGORY_COLOR.other_non_billable }}
                  />
                  <span className="truncate text-[11px] font-medium text-slate-600">{item.label}</span>
                  <span className="text-right text-[11px] font-semibold text-slate-500">{item.count}</span>
                  <span className="text-right text-[11px] font-bold text-slate-800">{Number(item.percent || 0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>

      <section className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section className={panelClassName('overflow-hidden')}>
          <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-5">
            <h2 className="font-['Space_Grotesk'] text-lg font-bold text-slate-950">Recent Activity</h2>
            <Link className="text-xs font-bold normal-case tracking-normal text-[#205cb5]" href="/client/calls">
              View All
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-[#f1f4f6]">
                <tr>
                  <th className="px-6 py-3 text-[10px] font-bold normal-case tracking-normal text-slate-500">Time</th>
                  <th className="px-6 py-3 text-[10px] font-bold normal-case tracking-normal text-slate-500">Caller</th>
                  <th className="px-6 py-3 text-[10px] font-bold normal-case tracking-normal text-slate-500">Summary</th>
                  <th className="px-6 py-3 text-[10px] font-bold normal-case tracking-normal text-slate-500">Category</th>
                  <th className="px-6 py-3 text-[10px] font-bold normal-case tracking-normal text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentCalls.length ? recentCalls.map((call) => {
                  const callerName = [call.caller_first_name, call.caller_last_name].filter(Boolean).join(' ') || (call.callback_number || 'Unknown caller');
                  const categoryKey = normalizeCallCategory(call.lead_outcome_type, call.lead_is_valid);
                  const categoryLabel = orderedBreakdown.find((item) => item.key === categoryKey)?.label || formatLeadOutcomeLabel(categoryKey);
                  return (
                    <tr
                      key={call.call_sid}
                      className="cursor-pointer transition-colors hover:bg-[#f7fafc]"
                      onClick={() => { window.location.href = `/client/calls?callSid=${encodeURIComponent(call.call_sid || '')}`; }}
                    >
                      <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{formatTimeOnly(call.created_at)}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-900">{callerName}</div>
                        <div className="text-[10px] text-slate-500">{call.callback_number || 'No callback number'}</div>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-800">{call.summary || 'No summary yet.'}</td>
                      <td className="px-6 py-4">
                        <CategoryPill categoryKey={categoryKey} label={categoryLabel} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <LeadStatusPill call={call} />
                          <span className="material-symbols-outlined text-sm text-slate-400">chevron_right</span>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-sm text-slate-500">No recent calls yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <section className={panelClassName('p-6')}>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-['Space_Grotesk'] text-lg font-bold text-slate-950">Question Handling</h2>
              <span className="group relative inline-flex">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-[#eff4ff] hover:text-[#205cb5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#205cb5] focus-visible:ring-offset-2"
                  aria-label={QUESTION_HANDLING_TOOLTIP}
                >
                  <span className="material-symbols-outlined text-[18px]">info</span>
                </button>
                <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-72 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-lg group-hover:block group-focus-within:block">
                  {QUESTION_HANDLING_TOOLTIP}
                </span>
              </span>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Answer Rate</span>
                <span className="font-bold text-[#205cb5]">{formatPercent(answeredQuestionRate)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f1f4f6]">
                <div className="h-full rounded-full bg-[#205cb5]" style={{ width: `${Math.max(4, Math.min(100, answeredQuestionRate))}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  className="rounded-lg bg-[#f1f4f6] p-3 text-left transition-all hover:bg-[#e5e9eb]"
                  onClick={() => answeredQuestionCount && setExpandedKnowledgeList((current) => current === 'answered' ? null : 'answered')}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold normal-case tracking-normal text-slate-500">
                    <span>Answered</span>
                    <span className="material-symbols-outlined text-sm text-[#205cb5]">{expandedKnowledgeList === 'answered' ? 'expand_less' : 'chevron_right'}</span>
                  </div>
                  <div className="font-['Space_Grotesk'] text-2xl font-bold text-slate-950">{answeredQuestionCount}</div>
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[#f1f4f6] p-3 text-left transition-all hover:bg-[#e5e9eb]"
                  onClick={() => unansweredQuestionCount && setExpandedKnowledgeList((current) => current === 'unanswered' ? null : 'unanswered')}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold normal-case tracking-normal text-slate-500">
                    <span>Unable to Answer</span>
                    <span className="material-symbols-outlined text-sm text-[#205cb5]">{expandedKnowledgeList === 'unanswered' ? 'expand_less' : 'chevron_right'}</span>
                  </div>
                  <div className="font-['Space_Grotesk'] text-2xl font-bold text-slate-950">{unansweredQuestionCount}</div>
                </button>
              </div>
              {!kbQuestionCount && pendingTranscriptAnalysisCallCount > 0 ? (
                <div className="rounded-lg border border-slate-200/70 bg-[#f8fafc] px-3 py-2 text-xs text-slate-600">
                  Analyzing {pendingTranscriptAnalysisCallCount} recent call{pendingTranscriptAnalysisCallCount === 1 ? '' : 's'}.
                </div>
              ) : null}
              {!kbQuestionCount && !pendingTranscriptAnalysisCallCount && !failedTranscriptAnalysisCallCount && canManageKnowledgeAnalysis ? (
                <div className="rounded-lg border border-slate-200/70 bg-[#f8fafc] px-3 py-3 text-xs text-slate-600">
                  <div>Transcript analysis has not been queued for recent calls yet.</div>
                  <button
                    type="button"
                    className="mt-2 rounded-md bg-white px-3 py-1.5 text-[11px] font-bold normal-case tracking-normal text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleRetryTranscriptAnalysis}
                    disabled={retryingTranscriptAnalysis}
                  >
                    {retryingTranscriptAnalysis ? 'Queueing...' : 'Analyze Recent Calls'}
                  </button>
                </div>
              ) : null}
              {!kbQuestionCount && !pendingTranscriptAnalysisCallCount && failedTranscriptAnalysisCallCount > 0 && canManageKnowledgeAnalysis ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                  <div>
                    Analysis stalled on {failedTranscriptAnalysisCallCount} recent call{failedTranscriptAnalysisCallCount === 1 ? '' : 's'}.
                  </div>
                  <button
                    type="button"
                    className="mt-2 rounded-md bg-white px-3 py-1.5 text-[11px] font-bold normal-case tracking-normal text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleRetryTranscriptAnalysis}
                    disabled={retryingTranscriptAnalysis}
                  >
                    {retryingTranscriptAnalysis ? 'Retrying...' : 'Retry Analysis'}
                  </button>
                </div>
              ) : null}
            </div>

            {expandedKnowledgeList ? (
              <div className="mt-5 border-t border-slate-200/70 pt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold normal-case tracking-normal text-slate-500">
                    {expandedKnowledgeList === 'answered' ? 'Questions Answered' : 'Questions Unable to Answer'}
                  </div>
                  <Link
                    href={`/client/dashboard/questions?kind=${expandedKnowledgeList === 'answered' ? 'answered' : 'unanswered'}&page=1`}
                    className="text-xs font-bold normal-case tracking-normal text-[#205cb5]"
                  >
                    View All
                  </Link>
                </div>
                <div className="mb-3 text-[11px] text-slate-500">Showing first 25.</div>
                <div className="space-y-3">
                  {(expandedKnowledgeList === 'answered' ? answeredKnowledgeQuestions : knowledgeGapQuestions).length ? (expandedKnowledgeList === 'answered' ? answeredKnowledgeQuestions : knowledgeGapQuestions).map((question) => {
                    const callerName = [question.caller_first_name, question.caller_last_name].filter(Boolean).join(' ') || question.callback_number || 'Unknown caller';
                    const promptText = normalizeText(question.question_text) || 'Unknown question';
                    const assistantResponse = normalizeText(question.assistant_response_text);
                    return (
                      <Link
                        key={question.answered_question_id || question.unanswered_question_id}
                        href={`/client/calls?callSid=${encodeURIComponent(question.call_sid || '')}`}
                        className="block rounded-lg border border-slate-200/70 bg-[#f8fafc] p-3 transition-colors hover:bg-[#eff4ff]"
                      >
                        <div className="text-sm font-semibold text-slate-900">{promptText}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{callerName} · {formatDateTime(question.created_at)}</div>
                        {assistantResponse ? (
                          <div className="mt-2 text-xs text-slate-600">
                            <span className="font-semibold text-slate-700">AI response:</span> {assistantResponse}
                          </div>
                        ) : null}
                        {question.summary ? <div className="mt-2 text-xs text-slate-500">{question.summary}</div> : null}
                      </Link>
                    );
                  }) : (
                    <div className="text-sm text-slate-500">
                      {expandedKnowledgeList === 'answered'
                        ? 'No answered KB questions in the last 30 days.'
                        : 'No KB gaps in the last 30 days.'}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className={panelClassName('p-6')}>
            <h2 className="mb-4 font-['Space_Grotesk'] text-lg font-bold text-slate-950">Quick Actions</h2>
            <div className="grid gap-2">
              <ActionRow href="/client/calls" icon="visibility" title="Review Calls" />
              <ActionRow href="/client/receptionist/knowledge" icon="edit_note" title="Update Knowledge Base" />
              <ActionRow href="/client/receptionist/basics" icon="settings_input_component" title="Adjust Basics" />
              <ActionRow href="/client/team" icon="notifications_active" title="Manage Lead Destinations" />
            </div>
          </section>
        </div>
      </section>

      <section className={panelClassName('p-6')}>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-['Space_Grotesk'] text-lg font-bold text-slate-950">Call Volume Trends</h2>
            <p className="mt-1 text-xs text-slate-500">Last 7 days</p>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-[#205cb5]" />
              <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">Business Hours</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-[#6e9ffd]" />
              <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">After Hours</span>
            </div>
          </div>
        </div>

        <div className="grid h-52 grid-cols-7 items-end gap-4 px-2">
          {callVolumeLast7Days.map((day) => {
            const totalCount = Number(day.totalCount || day.count || 0);
            const businessCount = Number(day.businessHoursCount || 0);
            const afterHoursCount = Number(day.afterHoursCount || 0);
            const height = totalCount ? `${Math.max(10, (totalCount / maxTrendCount) * 100)}%` : '8%';
            const businessShare = totalCount ? (businessCount / totalCount) * 100 : 0;
            const afterHoursShare = totalCount ? (afterHoursCount / totalCount) * 100 : 0;
            return (
              <div key={day.day} className="flex h-full flex-col items-center justify-end gap-2">
                <div className="text-xs font-semibold text-slate-500">{totalCount}</div>
                <div className="flex h-[180px] w-full items-end">
                  <div className="w-full overflow-hidden rounded-t-sm bg-[#ebeef0]" style={{ height }}>
                    <div className="flex h-full flex-col justify-end">
                      <div className="bg-[#6e9ffd]" style={{ height: `${afterHoursShare}%` }} />
                      <div className="bg-[#205cb5]" style={{ height: `${businessShare}%` }} />
                    </div>
                  </div>
                </div>
                <div className="text-[10px] font-bold normal-case tracking-normal text-slate-500">{formatDayLabel(day.day)}</div>
              </div>
            );
          })}
        </div>
      </section>
    </ClientPage>
  );
}

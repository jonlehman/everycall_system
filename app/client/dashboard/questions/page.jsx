'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ClientPage from '../../_components/ClientPage';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKind(value) {
  return normalizeText(value).toLowerCase() === 'answered' ? 'answered' : 'unanswered';
}

function normalizePage(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

function panelClassName(extra = '') {
  return `rounded-xl border border-slate-200/70 bg-white shadow-sm ${extra}`.trim();
}

function TabLink({ href, active, label, count }) {
  return (
    <Link
      href={href}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-[#205cb5] bg-[#d6e4f9] text-[#205cb5]'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      ].join(' ')}
    >
      <span>{label}</span>
      <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-slate-700">{count}</span>
    </Link>
  );
}

export default function DashboardQuestionsPage() {
  const searchParams = useSearchParams();
  const kind = normalizeKind(searchParams?.get('kind'));
  const page = normalizePage(searchParams?.get('page'));
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading questions...' });

  useEffect(() => {
    let mounted = true;
    fetchJson(`/api/v1/client/dashboard/questions?kind=${encodeURIComponent(kind)}&page=${page}`)
      .then((payload) => {
        if (!mounted) return;
        setData(payload);
        setStatus(null);
      })
      .catch((error) => {
        if (!mounted) return;
        setStatus({ tone: 'bad', message: error?.message || 'Could not load knowledge questions.' });
      });
    return () => {
      mounted = false;
    };
  }, [kind, page]);

  const counts = data?.counts || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const totalPages = Math.max(1, Number(data?.totalPages || 1));
  const totalCount = Number(data?.totalCount || 0);
  const answeredCount = Number(counts.answeredQuestionCount30d || 0);
  const unansweredCount = Number(counts.unansweredQuestionCount30d || 0);
  const pageLabel = totalCount ? `Showing ${Math.min((page - 1) * 25 + 1, totalCount)}-${Math.min(page * 25, totalCount)} of ${totalCount}` : 'No questions found';
  const title = kind === 'answered' ? 'Answered Questions' : 'No KB Answer Questions';
  const emptyMessage = kind === 'answered' ? 'No answered questions in the last 30 days.' : 'No unanswered questions in the last 30 days.';

  const pagination = useMemo(() => ({
    prevHref: `/client/dashboard/questions?kind=${kind}&page=${Math.max(1, page - 1)}`,
    nextHref: `/client/dashboard/questions?kind=${kind}&page=${Math.min(totalPages, page + 1)}`
  }), [kind, page, totalPages]);

  return (
    <ClientPage
      title="Knowledge Questions"
      subtitle=""
      status={status}
      headerAside={(
        <Link
          href="/client/dashboard"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Dashboard</span>
        </Link>
      )}
    >
      <section className={panelClassName('p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Last 30 Days</div>
            <h2 className="mt-2 font-['Space_Grotesk'] text-xl font-bold tracking-[-0.03em] text-slate-950">{title}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <TabLink href="/client/dashboard/questions?kind=answered&page=1" active={kind === 'answered'} label="Answered" count={answeredCount} />
            <TabLink href="/client/dashboard/questions?kind=unanswered&page=1" active={kind === 'unanswered'} label="No KB Answer" count={unansweredCount} />
          </div>
        </div>
      </section>

      <section className={panelClassName('overflow-hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-6 py-5">
          <div className="text-sm font-medium text-slate-600">{pageLabel}</div>
          <div className="flex items-center gap-2">
            <Link
              href={pagination.prevHref}
              aria-disabled={page <= 1}
              className={[
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
                page <= 1 ? 'pointer-events-none border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              ].join(' ')}
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              <span>Prev</span>
            </Link>
            <div className="text-sm text-slate-500">Page {page} of {totalPages}</div>
            <Link
              href={pagination.nextHref}
              aria-disabled={page >= totalPages}
              className={[
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
                page >= totalPages ? 'pointer-events-none border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              ].join(' ')}
            >
              <span>Next</span>
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </Link>
          </div>
        </div>

        <div className="space-y-4 p-6">
          {items.length ? items.map((question) => {
            const callerName = [question.caller_first_name, question.caller_last_name].filter(Boolean).join(' ') || question.callback_number || 'Unknown caller';
            const promptText = normalizeText(question.question_text) || 'Unknown question';
            const assistantResponse = normalizeText(question.assistant_response_text);
            return (
              <Link
                key={question.question_id}
                href={`/client/calls?callSid=${encodeURIComponent(question.call_sid || '')}`}
                className="block rounded-lg border border-slate-200/70 bg-[#f8fafc] p-4 transition-colors hover:bg-[#eff4ff]"
              >
                <div className="text-sm font-semibold text-slate-900">{promptText}</div>
                <div className="mt-1 text-[11px] text-slate-500">{callerName} · {formatDateTime(question.created_at)}</div>
                {assistantResponse ? (
                  <div className="mt-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">AI response:</span> {assistantResponse}
                  </div>
                ) : null}
                {kind === 'unanswered' && normalizeText(question.reason) ? (
                  <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-amber-800">{normalizeText(question.reason)}</div>
                ) : null}
                {question.summary ? <div className="mt-2 text-xs text-slate-500">{question.summary}</div> : null}
              </Link>
            );
          }) : (
            <div className="p-6 text-sm text-slate-500">{emptyMessage}</div>
          )}
        </div>
      </section>
    </ClientPage>
  );
}

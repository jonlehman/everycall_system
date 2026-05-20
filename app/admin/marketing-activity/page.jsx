'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

const EXCLUDE_IP_STORAGE_KEY = 'everycall-admin-marketing-exclude-ip';
const SARAH_IP_HASH_URL = process.env.NEXT_PUBLIC_SARAH_IP_HASH_URL || 'https://www.creativedynamicinc.com/api/legacy-ai-ip-hash';

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function numberValue(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeIpHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function sourceTone(source) {
  if (source === 'sarah_intake') return 'border-sky-200 bg-sky-50 text-sky-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function statusTone(status) {
  if (status === 'email_sent' || status === 'recommendation_ready' || status === 'ready') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function MetricCard({ label, value, note }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{note}</div>
    </div>
  );
}

function DetailPill({ children, tone = 'border-slate-200 bg-slate-50 text-slate-700' }) {
  if (!children) return null;
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {children}
    </span>
  );
}

function contactLine(item) {
  const parts = [item.contactName, item.contactEmail, item.contactPhone].filter(Boolean);
  return parts.length ? parts.join(' / ') : '-';
}

function ActivityRow({ item }) {
  const transcriptCount = numberValue(item.transcriptItemCount);
  const title = item.title || item.sourceLabel || 'Marketing activity';
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1.35fr)_minmax(180px,0.8fr)_minmax(150px,0.55fr)_120px] md:items-center">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <DetailPill tone={sourceTone(item.source)}>{item.sourceLabel}</DetailPill>
          <DetailPill tone={statusTone(item.status)}>{item.status || 'started'}</DetailPill>
        </div>
        <div className="truncate text-sm font-semibold text-slate-950">{title}</div>
        <div className="mt-1 truncate text-xs text-slate-500">{item.subtitle || item.sourcePage || '-'}</div>
      </div>

      <div className="min-w-0 text-sm text-slate-700">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Contact</div>
        <div className="mt-1 truncate">{contactLine(item)}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        {item.source === 'sarah_intake' ? (
          <>
            <DetailPill>{item.emailStatus ? `Email ${item.emailStatus}` : 'No email yet'}</DetailPill>
            {item.followUpRequested ? <DetailPill>Follow-up</DetailPill> : null}
          </>
        ) : (
          <>
            <DetailPill>{item.connected ? 'Connected' : 'Built'}</DetailPill>
            <DetailPill>{transcriptCount} transcript</DetailPill>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 md:block md:text-right">
        <div className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</div>
        {item.href ? (
          <Link className="mt-0 inline-flex text-xs font-semibold text-[#004ac6] hover:underline md:mt-2" href={item.href}>
            Open
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminMarketingActivityPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('Loading marketing activity...');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [excludeCurrentIp, setExcludeCurrentIp] = useState(false);
  const [sarahIpHash, setSarahIpHash] = useState('');
  const [ipFilterWarning, setIpFilterWarning] = useState('');

  async function loadSarahIpHash() {
    try {
      const hashData = await fetchJson(SARAH_IP_HASH_URL, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit'
      });
      const nextHash = normalizeIpHash(hashData?.requestIpHash);
      if (!nextHash) {
        throw new Error('Sarah IP hash was unavailable.');
      }
      setSarahIpHash(nextHash);
      setIpFilterWarning('');
      return nextHash;
    } catch (err) {
      setIpFilterWarning(err?.message || 'Sarah IP filtering is unavailable right now.');
      return '';
    }
  }

  async function loadActivity({ excludeIp = excludeCurrentIp, sarahHash = sarahIpHash } = {}) {
    setLoading(true);
    setError('');
    setStatus('Loading marketing activity...');
    let nextSarahHash = sarahHash;
    try {
      if (excludeIp && !nextSarahHash) {
        nextSarahHash = await loadSarahIpHash();
      }
      if (!excludeIp) {
        setIpFilterWarning('');
      }

      const params = new URLSearchParams();
      if (excludeIp) params.set('excludeCurrentIp', '1');
      if (excludeIp && nextSarahHash) params.set('sarahIpHash', nextSarahHash);
      const url = `/api/v1/admin/marketing-activity${params.toString() ? `?${params.toString()}` : ''}`;
      const nextData = await fetchJson(url);
      setData(nextData);
      const count = numberValue(nextData?.summary?.total30d);
      const suffix = nextData?.filters?.excludeCurrentIp ? ' Your IP is excluded.' : '';
      setStatus(count ? `${count} runs in the last 30 days.${suffix}` : `No tracked runs in the last 30 days.${suffix}`);
    } catch (err) {
      setError(err?.message || 'Could not load marketing activity.');
      setStatus('Could not load marketing activity.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedExcludeIp = typeof window !== 'undefined'
      ? window.localStorage.getItem(EXCLUDE_IP_STORAGE_KEY) === '1'
      : false;
    setExcludeCurrentIp(savedExcludeIp);
    void loadActivity({ excludeIp: savedExcludeIp });
  }, []);

  function updateExcludeCurrentIp(nextValue) {
    setExcludeCurrentIp(nextValue);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EXCLUDE_IP_STORAGE_KEY, nextValue ? '1' : '0');
    }
    void loadActivity({ excludeIp: nextValue });
  }

  const summary = data?.summary || {};
  const sarah = summary.sarah || {};
  const fencing = summary.fencing || {};
  const activity = Array.isArray(data?.activity) ? data.activity : [];
  const sarahSource = data?.sources?.sarah || {};
  const fencingSource = data?.sources?.fencing || {};

  const metrics = useMemo(() => ([
    {
      label: 'Total 30d',
      value: numberValue(summary.total30d),
      note: 'Sarah intakes and fencing demo runs'
    },
    {
      label: 'Sarah Intakes',
      value: numberValue(sarah.total30d),
      note: `${numberValue(sarah.emailsSent)} email sent, ${numberValue(sarah.followUps)} follow-up`
    },
    {
      label: 'Fencing Demos',
      value: numberValue(fencing.total30d),
      note: `${numberValue(fencing.ready)} ready demo builds`
    },
    {
      label: 'Connected Demos',
      value: numberValue(fencing.connected),
      note: `${numberValue(fencing.transcripts)} saved transcript`
    }
  ]), [summary.total30d, sarah.total30d, sarah.emailsSent, sarah.followUps, fencing.total30d, fencing.ready, fencing.connected, fencing.transcripts]);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Marketing Activity</h1>
          <p className="mt-1 text-sm text-slate-500">{status}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={excludeCurrentIp}
              onChange={(event) => updateExcludeCurrentIp(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Exclude my IP
          </label>
          <button
            type="button"
            onClick={() => { void loadActivity(); }}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && sarahSource.configured === false ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {sarahSource.message || 'Sarah intake source is not configured.'}
        </div>
      ) : null}

      {!loading && data?.filters?.excludeCurrentIp ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          Your current admin request IP is filtered from this view using stored IP hashes. Sarah rows without an IP hash or from repeat IP hashes are hidden too. Raw IP addresses are not shown.
        </div>
      ) : null}

      {!loading && excludeCurrentIp && ipFilterWarning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your IP filter is active, but Sarah filtering could not get the Creative Dynamic hash yet.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold text-slate-950">Recent Runs</h2>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Last 30 days</span>
          </div>

          {loading ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              Loading recent runs...
            </div>
          ) : null}

          {!loading && !activity.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              No Sarah intakes or fencing demo runs have been tracked yet.
            </div>
          ) : null}

          {!loading && activity.length ? (
            <div className="space-y-3">
              {activity.map((item) => (
                <ActivityRow key={`${item.source}-${item.id}`} item={item} />
              ))}
            </div>
          ) : null}
        </div>

        <aside className="grid gap-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold text-slate-950">Sources</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="font-semibold text-slate-950">Sarah AI intake</div>
                <div className="mt-1 text-slate-500">Creative Dynamic legacy and workflow pages</div>
                <DetailPill tone={sarahSource.configured === false ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}>
                  {sarahSource.configured === false ? 'Needs database link' : 'Connected'}
                </DetailPill>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="font-semibold text-slate-950">Fencing live demo</div>
                <div className="mt-1 text-slate-500">EveryCall fencing landing page demo widget</div>
                <DetailPill tone={fencingSource.configured === false ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}>
                  {fencingSource.configured === false ? 'Unavailable' : 'Connected'}
                </DetailPill>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold text-slate-950">What Counts</h2>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <p className="m-0">Sarah runs count completed or in-progress AI intake sessions from Creative Dynamic.</p>
              <p className="m-0">Fencing runs count live demo builds tagged from the fencing contractors page.</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function numberValue(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value, digits = 0) {
  return numberValue(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatMoney(value) {
  return numberValue(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  return `${formatNumber(numberValue(value) * 100, 1)}%`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function shortUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  try {
    const url = new URL(raw);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`;
  } catch {
    return raw;
  }
}

function statusTone(value) {
  if (value === 'Converting') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (value === 'Friction') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (value === 'No Clarity match') return 'border-red-200 bg-red-50 text-red-700';
  if (value === 'Traffic') return 'border-sky-200 bg-sky-50 text-sky-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function noteTone(value) {
  if (value === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (value === 'action') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (value === 'setup') return 'border-violet-200 bg-violet-50 text-violet-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
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

function Pill({ children, tone = 'border-slate-200 bg-slate-50 text-slate-700' }) {
  if (!children) return null;
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {children}
    </span>
  );
}

function SourceHealth({ source, label }) {
  const configured = Boolean(source?.configured);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950">{label}</div>
        <Pill tone={configured ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
          {configured ? 'Connected' : 'Setup needed'}
        </Pill>
      </div>
      {source?.message ? (
        <div className="mt-2 text-sm text-slate-600">{source.message}</div>
      ) : null}
      {source?.landingPageError ? (
        <div className="mt-2 text-sm text-amber-700">{source.landingPageError}</div>
      ) : null}
    </div>
  );
}

function CampaignJoinTable({ rows }) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        No joined campaign rows yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="min-w-[820px]">
        <div className="grid grid-cols-[minmax(220px,1.4fr)_120px_110px_110px_130px_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          <div>Campaign</div>
          <div>Clicks</div>
          <div>Cost</div>
          <div>Conv.</div>
          <div>Clarity</div>
          <div>Signal</div>
        </div>
        {rows.map((row) => (
          <div key={`${row.id}-${row.name}`} className="grid grid-cols-[minmax(220px,1.4fr)_120px_110px_110px_130px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-950">{row.name || row.id}</div>
              <div className="mt-1 text-xs text-slate-500">{row.channel || row.status || '-'}</div>
            </div>
            <div className="text-slate-700">{formatNumber(row.ads?.clicks)}</div>
            <div className="text-slate-700">{formatMoney(row.ads?.cost)}</div>
            <div className="text-slate-700">{formatNumber(row.ads?.conversions, 1)}</div>
            <div className="text-slate-700">
              {formatNumber(row.clarity?.metrics?.sessions)} sessions
              <div className="text-xs text-slate-500">{formatNumber(row.clarity?.metrics?.friction)} friction</div>
            </div>
            <div>
              <Pill tone={statusTone(row.signal)}>{row.signal}</Pill>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UrlTable({ rows }) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        No landing page rows yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <div key={`${row.url}-${row.campaignName}`} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1.5fr)_110px_110px_130px] md:items-center">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">{shortUrl(row.url || row.clarity?.dimensions?.URL)}</div>
            <div className="mt-1 truncate text-xs text-slate-500">{row.campaignName || '-'}</div>
          </div>
          <div className="text-sm text-slate-700">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Ads</div>
            <div>{formatNumber(row.ads?.clicks)} clicks</div>
          </div>
          <div className="text-sm text-slate-700">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Cost</div>
            <div>{formatMoney(row.ads?.cost)}</div>
          </div>
          <div className="text-sm text-slate-700">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Clarity</div>
            <div>{formatNumber(row.clarity?.metrics?.sessions)} sessions</div>
            <div className="text-xs text-slate-500">{formatNumber(row.clarity?.metrics?.friction)} friction</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClarityList({ rows, dimension }) {
  if (!rows.length) {
    return <div className="text-sm text-slate-500">No Clarity rows in this slice.</div>;
  }
  return (
    <div className="grid gap-3">
      {rows.slice(0, 8).map((row) => {
        const label = row.dimensions?.[dimension] || 'Unlabeled';
        return (
          <div key={`${dimension}-${label}`} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-950">{dimension === 'URL' ? shortUrl(label) : label}</div>
              <div className="mt-1 text-xs text-slate-500">{formatNumber(row.metrics?.sessions)} sessions</div>
            </div>
            <div className="text-right text-sm text-slate-700">
              <div>{formatNumber(row.metrics?.friction)} friction</div>
              <div className="text-xs text-slate-500">{formatPercent(row.metrics?.frictionRate)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminMarketingInsightsPage() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(3);
  const [status, setStatus] = useState('Loading marketing insights...');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadInsights({ nextDays = days, refresh = false } = {}) {
    setLoading(true);
    setError('');
    setStatus(refresh ? 'Refreshing marketing insights...' : 'Loading marketing insights...');
    try {
      const params = new URLSearchParams();
      params.set('days', String(nextDays));
      if (refresh) params.set('refresh', '1');
      const nextData = await fetchJson(`/api/v1/admin/marketing-insights?${params.toString()}`);
      setData(nextData);
      const claritySessions = numberValue(nextData?.summary?.clarity?.totalSessions);
      const adsClicks = numberValue(nextData?.summary?.googleAds?.clicks);
      setStatus(`${formatNumber(claritySessions)} Clarity sessions, ${formatNumber(adsClicks)} Ads clicks in the current window.`);
    } catch (err) {
      setError(err?.message || 'Could not load marketing insights.');
      setStatus('Could not load marketing insights.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInsights({ nextDays: days });
  }, []);

  function updateDays(nextDays) {
    setDays(nextDays);
    void loadInsights({ nextDays });
  }

  const metrics = useMemo(() => {
    const clarity = data?.summary?.clarity || {};
    const ads = data?.summary?.googleAds || {};
    return [
      {
        label: 'Clarity Sessions',
        value: formatNumber(clarity.totalSessions),
        note: `${formatNumber(clarity.totalFriction)} friction signals`
      },
      {
        label: 'Paid Sessions',
        value: formatNumber(clarity.totalPaidSessions),
        note: `${formatPercent(clarity.frictionRate)} overall friction`
      },
      {
        label: 'Ads Spend',
        value: formatMoney(ads.cost),
        note: `${formatNumber(ads.clicks)} clicks`
      },
      {
        label: 'Conversions',
        value: formatNumber(ads.conversions, 1),
        note: `${formatPercent(ads.conversionRate)} conversion rate`
      }
    ];
  }, [data]);

  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];
  const joinedCampaigns = Array.isArray(data?.joined?.campaigns) ? data.joined.campaigns : [];
  const joinedLandingPages = Array.isArray(data?.joined?.landingPages) ? data.joined.landingPages : [];
  const topCampaigns = Array.isArray(data?.clarity?.topCampaigns) ? data.clarity.topCampaigns : [];
  const frictionUrls = Array.isArray(data?.clarity?.frictionUrls) ? data.clarity.frictionUrls : [];

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold text-slate-950">Marketing Insights</h1>
          <p className="mt-1 text-sm text-slate-500">{status}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-700">
            {[1, 2, 3].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => updateDays(option)}
                className={`px-4 py-2 ${days === option ? 'bg-slate-950 text-white' : 'hover:bg-slate-50'}`}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { void loadInsights({ refresh: true }); }}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <SourceHealth source={data?.sources?.clarity} label="Microsoft Clarity" />
        <SourceHealth source={data?.sources?.googleAds} label="Google Ads" />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {recommendations.length ? (
        <div className="grid gap-2">
          {recommendations.map((item, index) => (
            <div key={`${item.tone}-${index}`} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${noteTone(item.tone)}`}>
              {item.text}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Campaign Join</h2>
            <p className="mt-1 text-sm text-slate-500">Ads spend beside Clarity sessions and friction.</p>
          </div>
          <div className="text-xs text-slate-500">
            Clarity cache: {formatDateTime(data?.cache?.clarity?.sourceCampaign?.fetchedAt)}
          </div>
        </div>
        <CampaignJoinTable rows={joinedCampaigns} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="grid gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Landing Pages</h2>
            <p className="mt-1 text-sm text-slate-500">Paid URL rows with Clarity behavior.</p>
          </div>
          <UrlTable rows={joinedLandingPages} />
        </div>

        <div className="grid gap-5">
          <div className="grid gap-3">
            <h2 className="m-0 text-lg font-semibold text-slate-950">Clarity Campaigns</h2>
            <ClarityList rows={topCampaigns} dimension="Campaign" />
          </div>
          <div className="grid gap-3">
            <h2 className="m-0 text-lg font-semibold text-slate-950">Friction URLs</h2>
            <ClarityList rows={frictionUrls} dimension="URL" />
          </div>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function statusTone(status) {
  if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'expired') return 'border-slate-200 bg-slate-100 text-slate-700';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function SummaryRow({ label, value }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-sm">
      <div className="font-semibold text-slate-500">{label}</div>
      <div className="min-w-0 break-words text-slate-900">{value || '-'}</div>
    </div>
  );
}

export default function AdminDemoSessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState('Loading website demos...');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadSessions() {
    setLoadingList(true);
    setStatus('Loading website demos...');
    try {
      const data = await fetchJson('/api/v1/admin/demo-sessions');
      const nextSessions = Array.isArray(data?.demoSessions) ? data.demoSessions : [];
      const requestedId = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('session') || ''
        : '';
      setSessions(nextSessions);
      setSelectedId((current) => current && nextSessions.some((item) => item.demoSessionId === current)
        ? current
        : (nextSessions.find((item) => item.demoSessionId === requestedId)?.demoSessionId || nextSessions[0]?.demoSessionId || ''));
      setStatus(nextSessions.length ? 'Website demos loaded.' : 'No website demos yet.');
    } catch (error) {
      setStatus(error?.message || 'Could not load website demos.');
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(demoSessionId) {
    if (!demoSessionId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const data = await fetchJson(`/api/v1/admin/demo-sessions/${encodeURIComponent(demoSessionId)}`);
      setDetail(data?.detail || null);
    } catch (error) {
      setDetail(null);
      setStatus(error?.message || 'Could not load demo session detail.');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId]);

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Website Demos</h1>
          <p className="mt-1 text-sm text-slate-500">{status}</p>
        </div>
        <button
          type="button"
          onClick={() => { void loadSessions(); }}
          className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-900">Recent demo sessions</div>
          <div className="space-y-3">
            {loadingList ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Loading...
              </div>
            ) : null}
            {!loadingList && !sessions.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No demo sessions yet.
              </div>
            ) : null}
            {sessions.map((item) => (
              <button
                key={item.demoSessionId}
                type="button"
                onClick={() => setSelectedId(item.demoSessionId)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  selectedId === item.demoSessionId
                    ? 'border-[#004ac6]/25 bg-[#eff4ff]'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {item.businessName || item.contactName || item.websiteUrl}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{item.websiteUrl}</div>
                  </div>
                  <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div>Name: {item.contactName || '-'}</div>
                  <div>Email: {item.contactEmail || '-'}</div>
                  <div>Phone: {item.contactPhone || '-'}</div>
                  <div>Transcript: {item.transcriptItemCount}</div>
                </div>
                <div className="mt-2 text-[11px] text-slate-500">{formatDateTime(item.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          {!selectedId ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              Select a demo session to review it.
            </div>
          ) : loadingDetail ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              Loading detail...
            </div>
          ) : !detail ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              Demo session detail is unavailable.
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="m-0 text-xl font-semibold text-slate-900">
                    {detail.businessName || detail.contactName || detail.websiteUrl}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">{detail.websiteUrl}</p>
                </div>
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(detail.status)}`}>
                  {detail.status}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <SummaryRow label="Name" value={detail.contactName} />
                <SummaryRow label="Phone" value={detail.contactPhone} />
                <SummaryRow label="Email" value={detail.contactEmail} />
                <SummaryRow label="Created" value={formatDateTime(detail.createdAt)} />
                <SummaryRow label="Updated" value={formatDateTime(detail.updatedAt)} />
                <SummaryRow label="Reuse source" value={detail.reusedFromDemoSessionId} />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 text-sm font-semibold text-slate-900">Preview summary</div>
                <div className="text-sm leading-6 text-slate-700">{detail.previewSummary || '-'}</div>
              </div>

              {normalizeText(detail.failureMessage) ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="mb-1 text-sm font-semibold text-red-700">Build failure</div>
                  <div className="text-sm text-red-700">{detail.failureMessage}</div>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">Transcript</div>
                {!detail.transcriptItems?.length ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No transcript saved for this demo yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {detail.transcriptItems.map((item, index) => (
                      <div
                        key={`${item.itemId || 'item'}-${index}`}
                        className={item.role === 'assistant'
                          ? 'rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4'
                          : 'rounded-2xl bg-[#004ac6] px-4 py-4 text-white'}
                      >
                        <div className={item.role === 'assistant'
                          ? 'mb-2 text-[11px] font-semibold tracking-[0.16em] text-slate-500'
                          : 'mb-2 text-[11px] font-semibold tracking-[0.16em] text-blue-100'}>
                          {item.role === 'assistant' ? 'Receptionist' : 'Visitor'}
                        </div>
                        <div className={item.role === 'assistant' ? 'text-sm leading-6 text-slate-700' : 'text-sm leading-6 text-white'}>
                          {item.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">Event log</div>
                <div className="space-y-3">
                  {(detail.events || []).map((event, index) => (
                    <div key={`${event.eventType}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">{event.eventType}</div>
                        <div className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</div>
                      </div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">
                        {JSON.stringify(event.payload || {}, null, 2)}
                      </pre>
                    </div>
                  ))}
                  {!detail.events?.length ? (
                    <div className="text-sm text-slate-500">No events recorded.</div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

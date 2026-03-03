'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';

function formatLabel(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(value) {
  if (value === 'error') return 'bad';
  if (value === 'missed') return 'warn';
  return 'ok';
}

function urgencyTone(value) {
  if (value === 'critical') return 'bad';
  if (value === 'high') return 'warn';
  return 'ok';
}

function formatPhoneNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function formatTranscript(text) {
  const lines = String(text || '').split('\n');
  const formatted = [];
  let lastSpeaker = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(Assistant|Caller|Agent|System):\s*/i);
    const speaker = match ? match[1].toLowerCase() : null;
    if (speaker && lastSpeaker && speaker !== lastSpeaker) {
      formatted.push('');
    }
    formatted.push(trimmed);
    if (speaker) lastSpeaker = speaker;
  }

  return formatted.join('\n');
}

export default function CallsPage() {
  const isMobile = useMediaQuery('(max-width: 980px)');
  const [calls, setCalls] = useState([]);
  const [selectedCallSid, setSelectedCallSid] = useState('');
  const [detailMeta, setDetailMeta] = useState(null);
  const [detailTranscript, setDetailTranscript] = useState('');
  const [detailStatus, setDetailStatus] = useState('Select a call to review details and edit status, urgency, summary, and notes.');
  const [saveStatus, setSaveStatus] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailDraft, setDetailDraft] = useState({
    status: 'new',
    urgency: 'normal',
    summary: '',
    notes: ''
  });
  const [lastSavedAt, setLastSavedAt] = useState('');
  const searchInputRef = useRef(null);

  const loadCalls = async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError('');
    try {
      const resp = await fetch(`/api/v1/calls`);
      if (!resp.ok) {
        setLoadError('Could not load calls. Refresh to retry.');
        return;
      }
      const data = await resp.json();
      setCalls(data.calls || []);
    } catch {
      setLoadError('Could not load calls. Refresh to retry.');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const resp = await fetch('/api/v1/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backfill_summaries' })
      });
      if (!resp.ok) {
        setLoadError('Could not refresh summaries. Refresh to retry.');
        return;
      }
      await loadCalls({ showLoading: false });
    } catch {
      setLoadError('Could not refresh summaries. Refresh to retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalls();
  }, []);

  const loadDetail = async (callSid) => {
    if (!callSid) return;
    setSelectedCallSid(callSid);
    setSaveStatus('');
    setDetailStatus('Loading call details...');
    setDetailMeta(null);
    setDetailTranscript('');

    const [metaResp, transcriptResp] = await Promise.all([
      fetch(`/api/v1/calls?callSid=${encodeURIComponent(callSid)}`),
      fetch(`/api/v1/calls?mode=transcript&callSid=${encodeURIComponent(callSid)}`)
    ]);

    if (metaResp.ok) {
      const data = await metaResp.json();
      const call = data.call || null;
      setDetailMeta(call);
      setDetailDraft({
        status: call?.status || 'new',
        urgency: call?.urgency || 'normal',
        summary: call?.summary || '',
        notes: call?.state_json?.client_notes || ''
      });
    }

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      setDetailTranscript(data.transcript || '');
    }

    setDetailStatus('Ready.');
  };

  const saveDetail = async (mode = 'all') => {
    if (!detailMeta?.call_sid) return;
    setSaveStatus(mode === 'notes' ? 'Saving notes...' : 'Saving...');
    const resp = await fetch('/api/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        callSid: detailMeta.call_sid,
        status: detailDraft.status,
        urgency: detailDraft.urgency,
        summary: detailDraft.summary,
        notes: detailDraft.notes
      })
    });
    if (!resp.ok) {
      setSaveStatus('Save failed.');
      return;
    }
    const savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setLastSavedAt(savedAt);
    setSaveStatus(mode === 'notes' ? 'Notes saved.' : 'Saved.');
    await Promise.all([loadCalls(), loadDetail(detailMeta.call_sid)]);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const tag = target?.tagName;
      const isTypingContext = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (event.key === '/' && !isTypingContext) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
        return;
      }

      if ((event.key === 's' || event.key === 'S') && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingContext) {
        if (!detailMeta?.call_sid) return;
        event.preventDefault();
        saveDetail('notes');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailMeta?.call_sid, detailDraft.notes]);

  const rows = useMemo(() => calls.map((call, idx) => ({
    id: call.call_sid || idx,
    sid: call.call_sid,
    from: formatPhoneNumber(call.from_number) || '-',
    summary: call.summary || '-',
    when: new Date(call.created_at).toLocaleString(),
    status: call.status,
    urgency: call.urgency || 'normal',
    createdAt: call.created_at
  })), [calls]);

  const filteredRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (urgencyFilter !== 'all' && row.urgency !== urgencyFilter) return false;
    if (search.trim()) {
      const hay = `${row.sid} ${row.from}`.toLowerCase();
      if (!hay.includes(search.trim().toLowerCase())) return false;
    }
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      if (new Date(row.createdAt).getTime() < fromTime) return false;
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime();
      if (new Date(row.createdAt).getTime() > toTime) return false;
    }
    return true;
  });

  const columns = [
    { field: 'when', headerName: 'Time', flex: 0.75, minWidth: 140 },
    { field: 'from', headerName: 'Number', flex: 0.65, minWidth: 120 },
    {
      field: 'summary',
      headerName: 'AI Summary',
      flex: 1.25,
      minWidth: 210,
      renderCell: (params) => (
        <span
          title={params.value || ''}
          style={{
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: '1.25rem',
            maxHeight: '2.5rem'
          }}
        >
          {params.value || '-'}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.52,
      minWidth: 104,
      renderCell: (params) => (
        <span className={`badge ${statusTone(params.value)}`}>{formatLabel(params.value)}</span>
      )
    },
    {
      field: 'urgency',
      headerName: 'Urgency',
      flex: 0.5,
      minWidth: 98,
      renderCell: (params) => (
        <span className={`badge ${urgencyTone(params.value)}`}>{formatLabel(params.value)}</span>
      )
    }
  ];

  const status = loadError
    ? { tone: 'bad', message: loadError }
    : loading
      ? { tone: 'warn', message: 'Loading calls...' }
      : { tone: 'ok', message: `${filteredRows.length} call(s) in view.` };

  const hasUnsavedChanges = Boolean(detailMeta) && (
    detailDraft.status !== (detailMeta.status || 'new')
    || detailDraft.urgency !== (detailMeta.urgency || 'normal')
    || detailDraft.summary !== (detailMeta.summary || '')
    || detailDraft.notes !== (detailMeta.state_json?.client_notes || '')
  );

  return (
    <ClientPage
      title="Call Inbox"
      subtitle="Review the call log and update call status, urgency, summary, and notes inline."
      status={status}
      primaryAction={{ label: 'Refresh Data', brand: true, onClick: refreshData }}
    >
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1.2fr_.8fr]'} min-w-0`}>
        <div className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className={`mb-3 flex ${isMobile ? 'flex-col' : 'flex-row items-start justify-between'} gap-3`}>
            <h2 className="mb-2 mt-0 text-lg font-semibold">Calls</h2>
            <div className={`${isMobile ? 'w-full' : ''}`}>
              <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div className="grid gap-2">
                  <div>
                    <input
                      ref={searchInputRef}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Number"
                      aria-label="Number"
                    />
                  </div>
                  <div>
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Call Status">
                      <option value="all">Call Status (All)</option>
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="unable_to_reach">Unable to Reach</option>
                      <option value="canceled">Canceled</option>
                      <option value="spam">Spam / Wrong Number</option>
                    </select>
                  </div>
                  <div>
                    <select value={urgencyFilter} onChange={(event) => setUrgencyFilter(event.target.value)} aria-label="Urgency Level">
                      <option value="all">Urgency (All)</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                        aria-label="Date From"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(event) => setDateTo(event.target.value)}
                        aria-label="Date To"
                      />
                    </div>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => {
                        setStatusFilter('all');
                        setUrgencyFilter('all');
                        setDateFrom('');
                        setDateTo('');
                        setSearch('');
                      }}
                    >
                      Reset Filters
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ height: rows.length ? 'auto' : 300 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              getRowHeight={() => 56}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              localeText={{ noRowsLabel: 'No calls yet.' }}
              onRowClick={(params) => {
                loadDetail(params.row.sid);
              }}
              getRowClassName={(params) => (selectedCallSid === params.row.sid ? 'is-selected-call-row' : '')}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.35', whiteSpace: 'normal' },
                '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, letterSpacing: '0.01em' },
                '& .is-selected-call-row': { backgroundColor: '#f0f9ff' },
                '& .MuiDataGrid-row:hover': { backgroundColor: '#f8fafc' }
              }}
            />
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Call Details</h2>
          {!detailMeta ? (
            <div className="text-sm text-slate-500">{detailStatus}</div>
          ) : (
            <>
              <div className="mb-2 text-sm text-slate-500">{new Date(detailMeta.created_at).toLocaleString()}</div>
              <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div>
                  <label>Number</label>
                  <input value={formatPhoneNumber(detailMeta.from_number) || ''} readOnly />
                </div>
                <div>
                  <label>Status</label>
                  <select
                    value={detailDraft.status}
                    onChange={(event) => setDetailDraft((prev) => ({ ...prev, status: event.target.value }))}
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="unable_to_reach">Unable to Reach</option>
                    <option value="canceled">Canceled</option>
                    <option value="spam">Spam / Wrong Number</option>
                  </select>
                </div>
              </div>
              <div className={`mt-2 grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div>
                  <label>Urgency</label>
                  <select
                    value={detailDraft.urgency}
                    onChange={(event) => setDetailDraft((prev) => ({ ...prev, urgency: event.target.value }))}
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label>Call Time</label>
                  <input value={new Date(detailMeta.created_at).toLocaleString()} readOnly />
                </div>
              </div>
              <div className="mt-3">
                <label>AI Summary</label>
                <textarea
                  value={detailDraft.summary}
                  onChange={(event) => setDetailDraft((prev) => ({ ...prev, summary: event.target.value }))}
                  style={{ minHeight: isMobile ? 64 : 70 }}
                />
              </div>
              <div className="mt-3">
                <label>Internal Notes</label>
                <textarea
                  value={detailDraft.notes}
                  onChange={(event) => setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  style={{ minHeight: isMobile ? 96 : 120 }}
                  placeholder="Write follow-up details, context, or callback notes."
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => saveDetail('all')} disabled={!hasUnsavedChanges}>
                  Save Changes
                </Button>
                <span className="text-sm text-slate-500">{saveStatus || (hasUnsavedChanges ? 'Unsaved changes' : 'No changes')}</span>
                {lastSavedAt ? <span className="text-sm text-slate-500">Last saved {lastSavedAt}</span> : null}
              </div>
              <div className="mt-3">
                <div className="mb-1 text-sm text-slate-500">Transcript</div>
                <pre className="rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100" style={{ whiteSpace: 'pre-wrap' }}>
                  {detailTranscript ? formatTranscript(detailTranscript) : 'No transcript available yet.'}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </ClientPage>
  );
}

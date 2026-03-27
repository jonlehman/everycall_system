'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

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
    notes: '',
    firstName: '',
    lastName: '',
    callbackNumber: '',
    serviceRequired: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    requestedDate: '',
    requestedTime: ''
  });
  const [lastSavedAt, setLastSavedAt] = useState('');
  const searchInputRef = useRef(null);

  const applyQuickView = (view) => {
    if (view === 'all') {
      setStatusFilter('all');
      setUrgencyFilter('all');
      return;
    }
    if (view === 'new') {
      setStatusFilter('new');
      setUrgencyFilter('all');
      return;
    }
    if (view === 'high') {
      setStatusFilter('all');
      setUrgencyFilter('high');
    }
  };

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
        notes: call?.state_json?.client_notes || '',
        firstName: call?.caller_first_name || '',
        lastName: call?.caller_last_name || '',
        callbackNumber: call?.callback_number || '',
        serviceRequired: call?.service_required || '',
        addressLine1: call?.address_line1 || '',
        addressLine2: call?.address_line2 || '',
        city: call?.city || '',
        state: call?.state || '',
        postalCode: call?.postal_code || '',
        requestedDate: call?.requested_date || '',
        requestedTime: call?.requested_time || ''
      });
    }

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      setDetailTranscript(data.transcript || '');
    }

    setDetailStatus('');
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
        notes: detailDraft.notes,
        firstName: detailDraft.firstName,
        lastName: detailDraft.lastName,
        callbackNumber: detailDraft.callbackNumber,
        serviceRequired: detailDraft.serviceRequired,
        addressLine1: detailDraft.addressLine1,
        addressLine2: detailDraft.addressLine2,
        city: detailDraft.city,
        state: detailDraft.state,
        postalCode: detailDraft.postalCode,
        requestedDate: detailDraft.requestedDate,
        requestedTime: detailDraft.requestedTime
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
    from: formatPhoneDisplay(call.from_number) || '-',
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
    || detailDraft.firstName !== (detailMeta.caller_first_name || '')
    || detailDraft.lastName !== (detailMeta.caller_last_name || '')
    || detailDraft.callbackNumber !== (detailMeta.callback_number || '')
    || detailDraft.serviceRequired !== (detailMeta.service_required || '')
    || detailDraft.addressLine1 !== (detailMeta.address_line1 || '')
    || detailDraft.addressLine2 !== (detailMeta.address_line2 || '')
    || detailDraft.city !== (detailMeta.city || '')
    || detailDraft.state !== (detailMeta.state || '')
    || detailDraft.postalCode !== (detailMeta.postal_code || '')
    || detailDraft.requestedDate !== (detailMeta.requested_date || '')
    || detailDraft.requestedTime !== (detailMeta.requested_time || '')
  );

  return (
    <ClientPage
      title="Calls"
      subtitle="Review new leads, follow-up work, and full call history in one place."
      status={status}
      primaryAction={{ label: 'Refresh Data', brand: true, onClick: refreshData }}
    >
      <section className="workspace-panel-soft p-5">
        <div className={`flex ${isMobile ? 'flex-col' : 'items-start justify-between'} gap-4`}>
          <div>
            <h2 className="m-0 text-xl font-semibold tracking-[-0.02em] text-slate-900">Queue Views</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Use quick views and filters to focus the call queue before you open details.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" type="button" onClick={() => applyQuickView('new')}>New</Button>
            <Button variant="outline" type="button" onClick={() => applyQuickView('high')}>High Urgency</Button>
            <Button variant="outline" type="button" onClick={() => applyQuickView('all')}>All Calls</Button>
          </div>
        </div>

        <div className={`mt-4 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className="grid gap-3">
            <div>
              <label>Search Number</label>
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by caller number"
                aria-label="Number"
              />
            </div>
            <div>
              <label>Call Status</label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Call Status">
                <option value="all">All statuses</option>
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
              <label>Urgency</label>
              <select value={urgencyFilter} onChange={(event) => setUrgencyFilter(event.target.value)} aria-label="Urgency Level">
                <option value="all">All urgency levels</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3">
            <div>
              <label>Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                aria-label="Date From"
              />
            </div>
            <div>
              <label>Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                aria-label="Date To"
              />
            </div>
            <div className="pt-1">
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
      </section>

      <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]'} min-w-0`}>
        <div className="workspace-panel min-w-0 overflow-hidden p-4">
          <div className={`mb-4 flex ${isMobile ? 'flex-col' : 'items-start justify-between'} gap-3`}>
            <div>
              <h2 className="m-0 text-xl font-semibold tracking-[-0.02em] text-slate-900">Call Queue</h2>
              <p className="m-0 mt-1 text-sm text-slate-500">Open a row to review caller details, update follow-up status, and capture notes.</p>
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
                '& .MuiDataGrid-columnHeaders': { backgroundColor: '#eff4ff', borderBottom: '1px solid rgba(195,198,215,0.55)' },
                '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700, letterSpacing: '0.01em', fontSize: '0.75rem', textTransform: 'uppercase' },
                '& .is-selected-call-row': { backgroundColor: '#eef3ff' },
                '& .MuiDataGrid-row:hover': { backgroundColor: '#f6f8ff' }
              }}
            />
          </div>
        </div>

        <div className="workspace-panel min-w-0 p-4">
          <div className="mb-4">
            <h2 className="m-0 text-xl font-semibold tracking-[-0.02em] text-slate-900">Call Details</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">Review intake information, adjust follow-up fields, and keep notes with the call.</p>
          </div>
          {!detailMeta ? (
            <div className="rounded-xl border border-slate-200/50 bg-[#eff4ff] p-4 text-sm text-slate-500">{detailStatus}</div>
          ) : (
            <>
              <div className="mb-3 rounded-xl border border-slate-200/50 bg-[#eff4ff] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Selected Call</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{formatPhoneDisplay(detailMeta.from_number) || detailMeta.call_sid}</div>
                <div className="mt-1 text-sm text-slate-500">{new Date(detailMeta.created_at).toLocaleString()}</div>
              </div>

              <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div>
                  <label>Number</label>
                  <input value={formatPhoneDisplay(detailMeta.from_number) || ''} readOnly />
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

              <div className="mt-4 rounded-xl border border-slate-200/40 bg-[#eff4ff] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Caller Details</div>
                <div className={`mt-3 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <div>
                    <label>First Name</label>
                    <input
                      value={detailDraft.firstName}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label>Last Name</label>
                    <input
                      value={detailDraft.lastName}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                      placeholder="Last name"
                    />
                  </div>
                  <div>
                    <label>Callback Number</label>
                    <input
                      value={detailDraft.callbackNumber}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, callbackNumber: event.target.value }))}
                      placeholder="Callback number"
                    />
                  </div>
                  <div>
                    <label>Service Required</label>
                    <input
                      value={detailDraft.serviceRequired}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, serviceRequired: event.target.value }))}
                      placeholder="Service required"
                    />
                  </div>
                  <div>
                    <label>Requested Date</label>
                    <input
                      type="date"
                      value={detailDraft.requestedDate}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, requestedDate: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label>Requested Time</label>
                    <input
                      value={detailDraft.requestedTime}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, requestedTime: event.target.value }))}
                      placeholder="Requested time"
                    />
                  </div>
                  <div>
                    <label>Address Line 1</label>
                    <input
                      value={detailDraft.addressLine1}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, addressLine1: event.target.value }))}
                      placeholder="Address line 1"
                    />
                  </div>
                  <div>
                    <label>Address Line 2</label>
                    <input
                      value={detailDraft.addressLine2}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, addressLine2: event.target.value }))}
                      placeholder="Address line 2"
                    />
                  </div>
                  <div>
                    <label>City</label>
                    <input
                      value={detailDraft.city}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, city: event.target.value }))}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label>State</label>
                    <input
                      value={detailDraft.state}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, state: event.target.value }))}
                      placeholder="State"
                    />
                  </div>
                  <div>
                    <label>Zip</label>
                    <input
                      value={detailDraft.postalCode}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, postalCode: event.target.value }))}
                      placeholder="Zip"
                    />
                  </div>
                </div>
              </div>

              <div className={`mt-4 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
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

              <div className="mt-4">
                <label>AI Summary</label>
                <textarea
                  value={detailDraft.summary}
                  onChange={(event) => setDetailDraft((prev) => ({ ...prev, summary: event.target.value }))}
                  style={{ minHeight: isMobile ? 64 : 70 }}
                />
              </div>

              <div className="mt-4">
                <label>Internal Notes</label>
                <textarea
                  value={detailDraft.notes}
                  onChange={(event) => setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  style={{ minHeight: isMobile ? 96 : 120 }}
                  placeholder="Write follow-up details, context, or callback notes."
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => saveDetail('all')} disabled={!hasUnsavedChanges}>
                  Save Changes
                </Button>
                <span className="text-sm text-slate-500">{saveStatus || (hasUnsavedChanges ? 'Unsaved changes' : 'No changes')}</span>
                {lastSavedAt ? <span className="text-sm text-slate-500">Last saved {lastSavedAt}</span> : null}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200/40 bg-[#eff4ff] p-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Transcript</div>
                <pre className="rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700" style={{ whiteSpace: 'pre-wrap' }}>
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

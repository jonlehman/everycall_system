'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
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
    status: 'completed',
    urgency: 'normal',
    summary: '',
    notes: ''
  });
  const [lastSavedAt, setLastSavedAt] = useState('');
  const searchInputRef = useRef(null);

  const loadCalls = () => {
    setLoading(true);
    setLoadError('');
    let mounted = true;
    fetch(`/api/v1/calls`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted) return;
        if (!data) {
          setLoadError('Could not load calls. Refresh to retry.');
          setLoading(false);
          return;
        }
        setCalls(data.calls || []);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadError('Could not load calls. Refresh to retry.');
        setLoading(false);
      });
    return () => { mounted = false; };
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
        status: call?.status || 'completed',
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
    from: call.from_number || '-',
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
    { field: 'from', headerName: 'Caller / Number', flex: 0.85, minWidth: 150 },
    {
      field: 'summary',
      headerName: 'AI Summary',
      flex: 1.25,
      minWidth: 210,
      renderCell: (params) => (
        <span title={params.value || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
    detailDraft.status !== (detailMeta.status || 'completed')
    || detailDraft.urgency !== (detailMeta.urgency || 'normal')
    || detailDraft.summary !== (detailMeta.summary || '')
    || detailDraft.notes !== (detailMeta.state_json?.client_notes || '')
  );

  return (
    <ClientPage
      title="Call Inbox"
      subtitle="Review the call log and update call status, urgency, summary, and notes inline."
      status={status}
      primaryAction={{ label: 'Refresh Data', brand: true, onClick: loadCalls }}
    >
      <div className="split" style={isMobile ? { gridTemplateColumns: '1fr', gap: 10 } : undefined}>
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 10 }}>Calls</h2>
          <div
            className="grid"
            style={{
              gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
              gap: 10,
              alignItems: 'end',
              marginBottom: 10
            }}
          >
            <div style={{ maxWidth: '1.6in' }}>
              <label>Search Calls</label>
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Caller or SID (/)"
              />
            </div>
            <div style={{ maxWidth: '1.6in' }}>
              <label>Call Status</label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="completed">Completed</option>
                <option value="missed">Missed</option>
                <option value="in_progress">In Progress</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div style={{ maxWidth: '1.6in' }}>
              <label>Urgency Level</label>
              <select value={urgencyFilter} onChange={(event) => setUrgencyFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div style={{ maxWidth: '1.6in' }}>
              <label>Date From</label>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <label style={{ marginTop: 8 }}>Date To</label>
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
            <div className="toolbar" style={{ margin: 0, alignItems: 'center', gridColumn: isMobile ? 'span 2' : 'span 4' }}>
              <button
                className="btn"
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
              </button>
              <span className="muted">{loading ? 'Loading...' : `${filteredRows.length} calls`}</span>
            </div>
          </div>
          <div style={{ height: rows.length ? 'auto' : 300 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              localeText={{ noRowsLabel: 'No calls yet.' }}
              onRowClick={(params) => {
                loadDetail(params.row.sid);
              }}
              getRowClassName={(params) => (selectedCallSid === params.row.sid ? 'is-selected-call-row' : '')}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.35' },
                '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, letterSpacing: '0.01em' },
                '& .is-selected-call-row': { backgroundColor: '#f0f9ff' },
                '& .MuiDataGrid-row:hover': { backgroundColor: '#f8fafc' }
              }}
            />
          </div>
        </div>
        <div className="card">
          <h2>Call Details</h2>
          {!detailMeta ? (
            <div className="muted">{detailStatus}</div>
          ) : (
            <>
              <div className="muted" style={{ marginBottom: 8 }}>
                {detailMeta.call_sid} · {new Date(detailMeta.created_at).toLocaleString()}
              </div>
              <div className="grid" style={{ gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                <div>
                  <label>Caller / Number</label>
                  <input value={detailMeta.from_number || ''} readOnly />
                </div>
                <div>
                  <label>Status</label>
                  <select
                    value={detailDraft.status}
                    onChange={(event) => setDetailDraft((prev) => ({ ...prev, status: event.target.value }))}
                  >
                    <option value="completed">Completed</option>
                    <option value="missed">Missed</option>
                    <option value="in_progress">In Progress</option>
                    <option value="error">Error</option>
                  </select>
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginTop: 10 }}>
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
              <div style={{ marginTop: 12 }}>
                <label>AI Summary</label>
                <textarea
                  value={detailDraft.summary}
                  onChange={(event) => setDetailDraft((prev) => ({ ...prev, summary: event.target.value }))}
                  style={{ minHeight: isMobile ? 64 : 70 }}
                />
              </div>
              <div style={{ marginTop: 12 }}>
                <label>Internal Notes</label>
                <textarea
                  value={detailDraft.notes}
                  onChange={(event) => setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  style={{ minHeight: isMobile ? 96 : 120 }}
                  placeholder="Write follow-up details, context, or callback notes."
                />
              </div>
              <div className="toolbar" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn" type="button" onClick={() => saveDetail('notes')}>
                  Save Notes (S)
                </button>
                <button className="btn brand" type="button" onClick={() => saveDetail('all')} disabled={!hasUnsavedChanges}>
                  Save All Changes
                </button>
                <span className="muted">{saveStatus || (hasUnsavedChanges ? 'Unsaved changes' : 'No changes')}</span>
                {lastSavedAt ? <span className="muted">Last saved {lastSavedAt}</span> : null}
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Transcript</div>
                <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>
                  {detailTranscript || 'No transcript available yet.'}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </ClientPage>
  );
}

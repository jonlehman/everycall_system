'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function CallsPage() {
  const [calls, setCalls] = useState([]);
  const [detailMeta, setDetailMeta] = useState(null);
  const [detailTranscript, setDetailTranscript] = useState('');
  const [detailStatus, setDetailStatus] = useState('Select a call to inspect transcript, extracted fields, and routing result.');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadCalls = () => {
    setLoading(true);
    let mounted = true;
    fetch(`/api/v1/calls`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setCalls(data.calls || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { mounted = false; };
  };

  useEffect(() => {
    const cleanup = loadCalls();
    return cleanup;
  }, []);

  const loadDetail = async (callSid) => {
    if (!callSid) return;
    setDetailStatus('Loading call details...');
    setDetailMeta(null);
    setDetailTranscript('');

    const [metaResp, transcriptResp] = await Promise.all([
      fetch(`/api/v1/calls?callSid=${encodeURIComponent(callSid)}`),
      fetch(`/api/v1/calls?mode=transcript&callSid=${encodeURIComponent(callSid)}`)
    ]);

    if (metaResp.ok) {
      const data = await metaResp.json();
      setDetailMeta(data.call || null);
    }

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      setDetailTranscript(data.transcript || '');
    }

    setDetailStatus('Ready.');
  };

  const rows = useMemo(() => calls.map((call, idx) => ({
    id: call.call_sid || idx,
    sid: call.call_sid,
    from: call.from_number || '-',
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
    { field: 'sid', headerName: 'SID', flex: 1, minWidth: 160 },
    { field: 'from', headerName: 'From', flex: 1, minWidth: 160 },
    { field: 'when', headerName: 'When', flex: 1, minWidth: 180 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'error' ? 'bad' : 'ok'}`}>{params.value}</span>
      )
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Call Inbox</h1>
        <div className="top-actions">
          <button className="btn" onClick={loadCalls}>Refresh</button>
        </div>
      </div>
      <div className="toolbar" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <label>Status</label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="error">Error</option>
        </select>
        <label>Urgency</label>
        <select value={urgencyFilter} onChange={(event) => setUrgencyFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
        </select>
        <label>From</label>
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <label>To</label>
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <label>Search</label>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caller or SID" />
        <span className="muted">{loading ? 'Loading...' : `${filteredRows.length} calls`}</span>
      </div>
      <div className="split">
        <div className="card">
          <div style={{ height: rows.length ? 'auto' : 300 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              localeText={{ noRowsLabel: 'No calls yet.' }}
              onRowClick={(params) => loadDetail(params.row.sid)}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
                '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
              }}
            />
          </div>
        </div>
        <div className="card">
          <h2>Call Detail</h2>
          {!detailMeta ? (
            <div className="muted">{detailStatus}</div>
          ) : (
            <>
              <div className="muted" style={{ marginBottom: 8 }}>
                {detailMeta.call_sid} · {new Date(detailMeta.created_at).toLocaleString()}
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div className="muted">From</div>
                  <div>{detailMeta.from_number || '-'}</div>
                </div>
                <div>
                  <div className="muted">Status</div>
                  <div>{detailMeta.status || '-'}</div>
                </div>
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
    </section>
  );
}

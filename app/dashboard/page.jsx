'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function DashboardPage() {
  const [limit, setLimit] = useState(30);
  const [status, setStatus] = useState('Loading...');
  const [calls, setCalls] = useState([]);
  const [detail, setDetail] = useState(null);

  const loadCalls = (silent = false) => {
    if (!silent) setStatus('Loading calls...');
    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
    fetch(`/api/v1/dashboard/calls?limit=${safeLimit}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data) {
          setStatus('Failed to load calls.');
          return;
        }
        if (!data.configured) {
          setStatus(data.message || 'Twilio not configured.');
          setDetail(data);
          setCalls([]);
          return;
        }
        setCalls(data.calls || []);
        setStatus(`Loaded ${data.calls?.length || 0} calls.`);
      })
      .catch(() => setStatus('Failed to load calls.'));
  };

  const loadDetail = (callSid) => {
    if (!callSid) return;
    setDetail({ loading: true });
    fetch(`/api/v1/dashboard/calls?callSid=${encodeURIComponent(callSid)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data) {
          setDetail({ error: 'Failed to load detail.' });
          return;
        }
        setDetail(data.detail || null);
      })
      .catch(() => setDetail({ error: 'Failed to load detail.' }));
  };

  useEffect(() => {
    loadCalls();
    const id = setInterval(() => loadCalls(true), 30000);
    return () => clearInterval(id);
  }, [limit]);

  const rows = useMemo(() => calls.map((call) => ({
    id: call.sid,
    time: call.start_time ? new Date(call.start_time).toLocaleString() : '-',
    from: call.from || '-',
    to: call.to || '-',
    status: call.status || '-',
    duration: call.duration || '-',
    sid: call.sid || '-'
  })), [calls]);

  const columns = [
    { field: 'time', headerName: 'Time', flex: 1, minWidth: 160 },
    { field: 'from', headerName: 'From', flex: 1, minWidth: 140 },
    { field: 'to', headerName: 'To', flex: 1, minWidth: 140 },
    { field: 'status', headerName: 'Status', flex: 0.8, minWidth: 120 },
    { field: 'duration', headerName: 'Dur', flex: 0.5, minWidth: 80 },
    { field: 'sid', headerName: 'SID', flex: 1.2, minWidth: 180 }
  ];

  const detailText = detail ? JSON.stringify(detail, null, 2) : 'Select a call row to load details.';

  return (
    <div className="wrap" style={{ maxWidth: 1200, margin: '20px auto', padding: '0 16px 24px' }}>
      <div className="topbar" style={{ padding: 0 }}>
        <h1>Operator Dashboard</h1>
      </div>
      <p className="muted">Recent calls, statuses, and per-call Twilio events.</p>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label className="muted">Limit</label>
        <input
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          style={{ width: 90 }}
        />
        <button className="btn" onClick={() => loadCalls()}>Refresh</button>
        <span className="muted">{status}</span>
      </div>

      <div className="grid cols-2" style={{ '--grid-cols': '1.2fr 0.8fr' }}>
        <section className="card">
          <DataGrid
            rows={rows}
            columns={columns}
            autoHeight
            disableRowSelectionOnClick
            onRowClick={(params) => loadDetail(params.row.sid)}
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
            localeText={{ noRowsLabel: 'No calls yet.' }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
              '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
              '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
            }}
          />
        </section>

        <section className="card">
          <h3 style={{ marginTop: 0 }}>Call Detail</h3>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#0b1020', color: '#e2e8f0', padding: 10, borderRadius: 8, fontSize: 12, maxHeight: '58vh', overflow: 'auto' }}>
            {detailText}
          </pre>
        </section>
      </div>
    </div>
  );
}

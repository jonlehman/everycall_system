'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function CallsPage() {
  const [calls, setCalls] = useState([]);
  const [detail, setDetail] = useState('Select a call to inspect transcript, extracted fields, and routing result.');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

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
    const resp = await fetch(`/api/v1/calls?callSid=${encodeURIComponent(callSid)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setDetail(JSON.stringify(data.call || {}, null, 2));
  };

  const rows = useMemo(() => calls.map((call, idx) => ({
    id: call.call_sid || idx,
    sid: call.call_sid,
    from: call.from_number || '-',
    when: new Date(call.created_at).toLocaleString(),
    status: call.status
  })), [calls]);

  const filteredRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (search.trim()) {
      const hay = `${row.sid} ${row.from}`.toLowerCase();
      if (!hay.includes(search.trim().toLowerCase())) return false;
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
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label>Status</label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="error">Error</option>
        </select>
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
          <div className="code" id="callDetail">{detail}</div>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
export default function OverviewPage() {
  const [stats, setStats] = useState({ callsToday: 0, missed: 0, urgent: 0, callbacksDue: 0 });
  const [recentCalls, setRecentCalls] = useState([]);
  const [actionQueue, setActionQueue] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/overview`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setStats(data.stats || stats);
        setRecentCalls(data.recentCalls || []);
        setActionQueue(data.actionQueue || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const rows = recentCalls.map((call, idx) => ({
    id: call.call_sid || idx,
    time: new Date(call.created_at).toLocaleTimeString(),
    caller: call.from_number || '-',
    status: call.urgency === 'high' ? 'Urgent' : call.status || 'Handled',
    statusTone: call.urgency === 'high' ? 'warn' : call.status === 'error' ? 'bad' : 'ok',
    summary: call.summary || '-'
  }));

  const columns = [
    { field: 'time', headerName: 'Time', flex: 0.6, minWidth: 100 },
    { field: 'caller', headerName: 'Caller', flex: 1, minWidth: 160 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.row.statusTone}`}>{params.value}</span>
      )
    },
    { field: 'summary', headerName: 'Summary', flex: 1.4, minWidth: 220 }
  ];

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Overview</h1>
        <div className="top-actions"></div>
      </div>

      <div className="grid cols-4">
        <div className="card"><div className="stat">Calls Today</div><div className="value">{stats.callsToday}</div></div>
        <div className="card"><div className="stat">Missed</div><div className="value">{stats.missed}</div></div>
        <div className="card"><div className="stat">Urgent</div><div className="value">{stats.urgent}</div></div>
        <div className="card"><div className="stat">Callbacks Due</div><div className="value">{stats.callbacksDue}</div></div>
      </div>

      <div className="split" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Recent Calls</h2>
          <div className="table-wrap">
            <DataGrid
              rows={rows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[5, 10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
              localeText={{ noRowsLabel: 'No recent calls.' }}
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
          <h2>Action Queue</h2>
          <p className="muted">Calls requiring callback or dispatch confirmation.</p>
          <div className="kv">
            {actionQueue.length === 0 ? (
              <div className="muted">No callbacks due.</div>
            ) : actionQueue.map((item, idx) => (
              <span key={`${item.caller_name}-${idx}`} style={{ display: 'contents' }}>
                <div>{item.caller_name || 'Caller'}</div>
                <div>{item.summary || ''}</div>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

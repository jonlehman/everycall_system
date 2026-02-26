'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function AdminOverviewPage() {
  const [stats, setStats] = useState({ activeTenants: 0, calls24h: 0, errors24h: 0, avgLatencyMs: 0 });
  const [incidents, setIncidents] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/overview')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setStats(data.stats || stats);
        setIncidents(data.incidents || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const rows = incidents.map((inc, idx) => ({
    id: idx,
    time: new Date(inc.created_at).toLocaleTimeString(),
    tenant: inc.tenant_key || '-',
    issue: inc.issue,
    status: inc.status
  }));

  const columns = [
    { field: 'time', headerName: 'Time', flex: 0.6, minWidth: 100 },
    { field: 'tenant', headerName: 'Tenant', flex: 1, minWidth: 160 },
    { field: 'issue', headerName: 'Issue', flex: 1.4, minWidth: 220 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'resolved' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar"><h1>Platform Overview</h1></div>
      <div className="grid cols-4">
        <div className="card"><div className="stat">Active Tenants</div><div className="value">{stats.activeTenants}</div></div>
        <div className="card"><div className="stat">Calls (24h)</div><div className="value">{stats.calls24h}</div></div>
        <div className="card"><div className="stat">Errors (24h)</div><div className="value">{stats.errors24h}</div></div>
        <div className="card"><div className="stat">Avg Latency</div><div className="value">{stats.avgLatencyMs}ms</div></div>
      </div>
      <div className="split" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Recent Incidents</h2>
          <DataGrid
            rows={rows}
            columns={columns}
            autoHeight
            disableRowSelectionOnClick
            pageSizeOptions={[5, 10, 25]}
            initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
            localeText={{ noRowsLabel: 'No incidents.' }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
              '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
              '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
            }}
          />
        </div>
        <div className="card">
          <h2>Quick Actions</h2>
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <button className="btn">Create Tenant</button>
            <button className="btn">Rotate API Keys</button>
            <button className="btn">Pause Tenant</button>
            <a className="btn brand" href="/dashboard">Open Call Dashboard</a>
          </div>
        </div>
      </div>
    </section>
  );
}

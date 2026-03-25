'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

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
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Platform Overview</h1>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Active Tenants</div><div className="mt-1 text-3xl font-bold">{stats.activeTenants}</div></div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Calls (24h)</div><div className="mt-1 text-3xl font-bold">{stats.calls24h}</div></div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Errors (24h)</div><div className="mt-1 text-3xl font-bold">{stats.errors24h}</div></div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Avg Latency</div><div className="mt-1 text-3xl font-bold">{stats.avgLatencyMs}ms</div></div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Recent Incidents</h2>
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
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <a className={cn(buttonVariants({ variant: 'outline' }))} href="/intake">Create Account</a>
            <a className={cn(buttonVariants({ variant: 'default' }))} href="/dashboard">Open Call Dashboard</a>
          </div>
        </div>
      </div>
    </section>
  );
}

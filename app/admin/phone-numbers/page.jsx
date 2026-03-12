'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

function formatMoney(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Unknown';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export default function AdminPhoneNumbersPage() {
  const [report, setReport] = useState({ rows: [], summary: null, sourceStatus: 'loading' });
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/phone-numbers/report')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.ok) {
          if (mounted) setStatus('Could not load phone number report.');
          return;
        }
        setReport({
          rows: data.rows || [],
          summary: data.summary || null,
          sourceStatus: data.sourceStatus || 'unknown'
        });
        setStatus(data.sourceStatus === 'live'
          ? 'Loaded live Telnyx number inventory.'
          : 'Loaded with fallback data. Some live Telnyx details are unavailable.'
        );
      })
      .catch(() => {
        if (mounted) setStatus('Could not load phone number report.');
      });
    return () => { mounted = false; };
  }, []);

  const rows = (report.rows || []).map((row, idx) => ({
    id: row.phoneNumber || `${row.tenantKey || 'tenant'}-${idx}`,
    phoneNumber: row.phoneNumber || '',
    assignmentStatus: row.assignmentStatus || '',
    telnyxStatus: row.telnyxStatus || '',
    tenant: row.tenantName || row.tenantKey || 'Unassigned',
    tenantKey: row.tenantKey || '',
    ownerName: row.ownerName || '',
    ownerEmail: row.ownerEmail || '',
    purchasedAt: row.purchasedAt ? new Date(row.purchasedAt).toLocaleString() : '',
    monthlyCost: typeof row.monthlyCost === 'number' ? formatMoney(row.monthlyCost) : 'Unknown',
    estimated30DayCost: typeof row.estimated30DayCost === 'number' ? formatMoney(row.estimated30DayCost) : 'Unknown',
    costStatus: row.costStatus || 'unknown'
  }));

  const columns = [
    { field: 'phoneNumber', headerName: 'Phone Number', flex: 0.9, minWidth: 160 },
    { field: 'assignmentStatus', headerName: 'Assignment', flex: 0.8, minWidth: 140 },
    { field: 'telnyxStatus', headerName: 'Provider Status', flex: 0.8, minWidth: 140 },
    { field: 'tenant', headerName: 'Tenant', flex: 1, minWidth: 180 },
    { field: 'tenantKey', headerName: 'Tenant Key', flex: 1, minWidth: 180 },
    { field: 'ownerName', headerName: 'Owner Name', flex: 0.9, minWidth: 160 },
    { field: 'ownerEmail', headerName: 'Owner Email', flex: 1.2, minWidth: 220 },
    { field: 'purchasedAt', headerName: 'Purchased', flex: 1, minWidth: 180 },
    { field: 'monthlyCost', headerName: 'Monthly Cost', flex: 0.8, minWidth: 140 },
    { field: 'estimated30DayCost', headerName: '30-Day Cost', flex: 0.8, minWidth: 140 },
    {
      field: 'costStatus',
      headerName: 'Cost Status',
      flex: 0.7,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'tracked' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    }
  ];

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Phone Number Report</h1>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Numbers</div>
          <div className="mt-1 text-3xl font-bold">{report.summary?.totalNumbers ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Assigned</div>
          <div className="mt-1 text-3xl font-bold">{report.summary?.assignedNumbers ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Unassigned</div>
          <div className="mt-1 text-3xl font-bold">{report.summary?.unassignedNumbers ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Tracked 30-Day Cost</div>
          <div className="mt-1 text-3xl font-bold">{formatMoney((report.summary?.trackedEstimated30DayCostCents ?? 0) / 100)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-3 text-sm text-slate-500">
          Numbers provisioned in Telnyx but not assigned to a tenant show up as <code>unassigned</code>. Number cost is only tracked for numbers provisioned after cost capture was added, so older numbers may show <code>Unknown</code>.
        </div>
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
          localeText={{ noRowsLabel: 'No phone numbers found.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/jobs')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted && data) setJobs(data.jobs || []); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const rows = jobs.map((job, idx) => ({
    id: job.id ?? `${job.tenant_key || 'tenant'}-${job.stage || 'stage'}-${job.updated_at || idx}`,
    job: job.id ?? `${job.tenant_key || 'tenant'}-${job.stage || 'stage'}-${job.updated_at || idx}`,
    tenant: job.tenant_key,
    stage: job.stage,
    updated: job.updated_at ? new Date(job.updated_at).toLocaleString() : '',
    attempted: job.attempted_at ? new Date(job.attempted_at).toLocaleString() : '',
    completed: job.completed_at ? new Date(job.completed_at).toLocaleString() : '',
    status: job.status,
    detail: job.status_detail || '',
    provider: job.provider || '',
    providerReference: job.provider_reference || '',
    errorCode: job.error_code || '',
    errorMessage: job.error_message || ''
  }));

  const columns = [
    {
      field: 'job',
      headerName: 'Job',
      flex: 0.4,
      minWidth: 120,
      valueFormatter: ({ value }) => `prov_${value}`
    },
    { field: 'tenant', headerName: 'Tenant', flex: 1, minWidth: 160 },
    { field: 'stage', headerName: 'Stage', flex: 1, minWidth: 140 },
    { field: 'provider', headerName: 'Provider', flex: 0.7, minWidth: 120 },
    { field: 'detail', headerName: 'Detail', flex: 1.6, minWidth: 240 },
    { field: 'errorCode', headerName: 'Error Code', flex: 0.9, minWidth: 160 },
    { field: 'errorMessage', headerName: 'Error Message', flex: 1.8, minWidth: 280 },
    { field: 'providerReference', headerName: 'Provider Ref', flex: 0.9, minWidth: 160 },
    { field: 'attempted', headerName: 'Attempted', flex: 0.9, minWidth: 180 },
    { field: 'completed', headerName: 'Completed', flex: 0.9, minWidth: 180 },
    { field: 'updated', headerName: 'Updated', flex: 0.9, minWidth: 180 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'done' ? 'ok' : params.value === 'failed' ? 'bad' : 'warn'}`}>{params.value}</span>
      )
    }
  ];

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Provisioning Jobs</h1>
      </div>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No jobs yet.' }}
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

'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [qaMatches, setQaMatches] = useState([]);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [status, setStatus] = useState('');

  const loadPageData = () => {
    let mounted = true;
    Promise.all([
      fetch('/api/v1/admin/jobs').then((resp) => resp.ok ? resp.json() : null),
      fetch('/api/v1/admin/tenants/cleanup-qa').then((resp) => resp.ok ? resp.json() : null)
    ])
      .then(([jobsData, cleanupData]) => {
        if (!mounted) return;
        setJobs(jobsData?.jobs || []);
        setQaMatches(cleanupData?.matches || []);
      })
      .catch(() => {
        if (!mounted) return;
        setStatus('Failed to load admin job data.');
      });
    return () => { mounted = false; };
  };

  useEffect(() => loadPageData(), []);

  const runQaCleanup = async () => {
    if (qaMatches.length === 0) {
      setStatus('No QA tenants found.');
      return;
    }
    const confirmed = window.confirm(`Delete ${qaMatches.length} QA tenant${qaMatches.length === 1 ? '' : 's'}? This cannot be undone.`);
    if (!confirmed) return;

    setCleanupBusy(true);
    setStatus('Deleting QA tenants...');
    try {
      const resp = await fetch('/api/v1/admin/tenants/cleanup-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        setStatus(data?.message || data?.error || 'QA tenant cleanup failed.');
        setCleanupBusy(false);
        return;
      }
      setStatus(`Deleted ${data?.deletedCount || 0} QA tenant${(data?.deletedCount || 0) === 1 ? '' : 's'}.`);
      loadPageData();
    } catch (err) {
      setStatus(err?.message || 'QA tenant cleanup failed.');
    } finally {
      setCleanupBusy(false);
    }
  };

  const rows = jobs.map((job, idx) => ({
    id: job.id ?? `${job.tenant_key || 'tenant'}-${job.stage || 'stage'}-${job.updated_at || idx}`,
    tenant: job.tenant_key,
    ownerName: job.owner_name || '',
    ownerEmail: job.owner_email || '',
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
    { field: 'tenant', headerName: 'Tenant', flex: 1, minWidth: 160 },
    { field: 'ownerName', headerName: 'Owner Name', flex: 1, minWidth: 180 },
    { field: 'ownerEmail', headerName: 'Owner Email', flex: 1.2, minWidth: 220 },
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
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Provisioning Jobs</h1>
          <div className="text-sm text-slate-500">
            QA tenants found: {qaMatches.length}
          </div>
          <div className="text-sm text-slate-500">
            Each tenant normally has two provisioning stages: `workflow_seed` and `number_setup`.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={runQaCleanup} disabled={cleanupBusy || qaMatches.length === 0}>
            {cleanupBusy ? 'Deleting...' : 'Delete QA Tenants'}
          </Button>
          <span className="text-sm text-slate-500">{status}</span>
        </div>
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

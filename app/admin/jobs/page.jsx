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
    tenant: job.tenant_key,
    stage: job.stage,
    updated: new Date(job.updated_at).toLocaleTimeString(),
    status: job.status
  }));

  const columns = [
    {
      field: 'job',
      headerName: 'Job',
      flex: 0.4,
      minWidth: 120,
      valueGetter: (params) => params.row.id,
      valueFormatter: ({ value }) => `prov_${value}`
    },
    { field: 'tenant', headerName: 'Tenant', flex: 1, minWidth: 160 },
    { field: 'stage', headerName: 'Stage', flex: 1, minWidth: 140 },
    { field: 'updated', headerName: 'Updated', flex: 0.6, minWidth: 120 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'done' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar"><h1>Provisioning Jobs</h1></div>
      <div className="card">
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

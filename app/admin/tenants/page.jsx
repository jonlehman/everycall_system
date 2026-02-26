'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DataGrid } from '@mui/x-data-grid';

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/tenants')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setTenants(data.tenants || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const rows = tenants.map((t, idx) => ({
    id: t.tenant_key || idx,
    tenant: t.name,
    users: t.user_count || 0,
    phone: t.primary_number || '-',
    status: t.status,
    region: t.data_region,
    key: t.tenant_key
  }));

  const columns = [
    { field: 'tenant', headerName: 'Tenant', flex: 1.2, minWidth: 180 },
    { field: 'users', headerName: 'Users', flex: 0.4, minWidth: 90 },
    { field: 'phone', headerName: 'Phone', flex: 0.8, minWidth: 140 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'active' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    },
    { field: 'region', headerName: 'Data Region', flex: 0.6, minWidth: 120 },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 120,
      renderCell: (params) => (
        <Link className="btn" href={`/admin/tenants/${params.row.key}`}>Manage</Link>
      )
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar"><h1>Tenant Administration</h1><div className="top-actions"><Link className="btn brand" href="/intake">New Tenant</Link></div></div>
      <div className="card">
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No tenants yet.' }}
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

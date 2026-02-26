'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DataGrid } from '@mui/x-data-grid';

export default function TeamPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [users, setUsers] = useState([]);
  const gridRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setUsers(data.users || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [tenantKey]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.style.gridTemplateColumns = '7fr 3fr';
    }
  }, []);

  const rows = users.map((user, idx) => ({
    id: user.id || idx,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status
  }));

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 140 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
    { field: 'role', headerName: 'Role', flex: 0.6, minWidth: 120 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'active' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 120,
      renderCell: () => <button className="btn">Manage</button>
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar"><h1>Team Users</h1><div className="top-actions"><button className="btn brand">Invite User</button></div></div>
      <div ref={gridRef} className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div className="card">
          <div style={{ height: rows.length ? 'auto' : 300 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              localeText={{ noRowsLabel: 'No users yet.' }}
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
          <h2>Help</h2>
          <p className="muted">Control who can access calls, update routing, and edit customer-facing settings. Keep admin access limited.</p>
        </div>
      </div>
    </section>
  );
}

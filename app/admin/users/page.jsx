'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/users')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setUsers(data.users || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const rows = users.map((user, idx) => ({
    id: idx,
    name: user.username || '-',
    email: user.email || '-',
    role: user.role || '-',
    lastActive: user.last_active_at ? new Date(user.last_active_at).toLocaleString() : '-'
  }));

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
    { field: 'role', headerName: 'Role', flex: 0.6, minWidth: 120 },
    { field: 'lastActive', headerName: 'Last Active', flex: 0.8, minWidth: 160 }
  ];

  return (
    <section className="screen active">
      <div className="topbar"><h1>Admin Users</h1></div>
      <div className="card">
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No admin users yet.' }}
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

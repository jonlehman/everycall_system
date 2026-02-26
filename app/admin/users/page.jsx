'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('admin');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

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

  const loadUsers = () => {
    fetch('/api/v1/admin/users')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setUsers(data?.users || []))
      .catch(() => {});
  };

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

  const saveUser = async () => {
    if (!email.trim() || !password.trim()) {
      setStatus('Email and password are required.');
      return;
    }
    const resp = await fetch('/api/v1/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, role, password })
    });
    if (!resp.ok) {
      setStatus('Save failed.');
      return;
    }
    setStatus('Saved.');
    setEmail('');
    setUsername('');
    setRole('admin');
    setPassword('');
    loadUsers();
  };

  return (
    <section className="screen active">
      <div className="topbar"><h1>Admin Users</h1></div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Create / Reset Admin User</h2>
        <div className="grid cols-2">
          <div>
            <label>Email</label>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@everycall.io" />
            <label style={{ marginTop: 10 }}>Username</label>
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin" />
          </div>
          <div>
            <label>Role</label>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <label style={{ marginTop: 10 }}>Password</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Set password" />
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button className="btn brand" onClick={saveUser}>Save Admin User</button>
          <span className="muted">{status}</span>
        </div>
      </div>
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

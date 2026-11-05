'use client';

import { useEffect, useRef, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('admin');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [signInPath, setSignInPath] = useState('');
  const emailInput = useRef(null);
  const saveInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/users')
      .then((resp) => { if (!resp.ok) throw new Error('list_failed'); return resp.json(); })
      .then((data) => {
        if (!mounted || !data) return;
        setUsers(data.users || []);
      })
      .catch(() => { if (mounted) setStatus('Could not load users. Refresh to try again.'); });
    return () => { mounted = false; };
  }, []);

  const loadUsers = async () => {
    const resp = await fetch('/api/v1/admin/users');
    if (!resp.ok) throw new Error('list_failed');
    const data = await resp.json();
    setUsers(data.users || []);
  };

  const resetForm = () => {
    setEditingId(null); setEmail(''); setUsername(''); setRole('admin'); setPassword('');
  };
  const editUser = (user) => {
    if (saveInFlight.current || signInPath) return;
    setEditingId(user.id); setEmail(user.email); setUsername(user.username);
    setRole(user.role); setPassword(''); setStatus('');
    emailInput.current?.focus();
  };
  const rows = users.map(user => ({
    ...user, name: user.username || '-',
    lastActive: user.last_active_at ? new Date(user.last_active_at).toLocaleString() : '-'
  }));
  const columns = [
    { field: 'id', headerName: 'User ID', width: 100 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
    { field: 'role', headerName: 'Role', flex: 0.6, minWidth: 120 },
    { field: 'lastActive', headerName: 'Last Active', flex: 0.8, minWidth: 160 },
    { field: 'actions', headerName: 'Actions', width: 100, sortable: false, filterable: false,
      renderCell: ({ row }) => <Button size="sm" variant="outline" disabled={saving || Boolean(signInPath)} aria-label={`Edit ${row.username}`} onClick={() => editUser(row)}>Edit</Button> }
  ];
  const errors = {
    password_too_short: 'Password must be at least 8 characters.',
    password_too_long: 'Password must be at most 72 UTF-8 bytes.',
    missing_fields: editingId ? 'Name and email are required.' : 'Email and password are required.',
    invalid_email: 'Enter a valid email address.',
    invalid_username: 'Name must be 1–100 characters without control characters.',
    invalid_role: 'Choose an available role.',
    email_in_use: 'That email belongs to another user. Choose a different email.',
    username_in_use: 'That name belongs to another user. Choose a different name.',
    last_admin_required: 'Keep at least one Admin or Super Admin with a password. Add another admin before changing this role.',
    user_not_found: 'This user no longer exists. Cancel and refresh the list.',
    unauthorized: 'Your session has expired or changed. Sign in again before saving.',
    forbidden: 'You need an admin account to edit platform users.'
  };
  const saveUser = async event => {
    event.preventDefault();
    if (saveInFlight.current || signInPath) return;
    saveInFlight.current = true; setSaving(true); setStatus('');
    try {
      const resp = await fetch('/api/v1/admin/users', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), email, username, role, password })
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) { setStatus(errors[result.error] || 'Could not save the user. Your changes are still here; please try again.'); return; }
      const savedId = result.user?.id || editingId;
      if (result.reauthenticate) {
        setPassword('');
        setStatus(`Saved user ${savedId}. Your account changed, so sign in again to continue.`);
        setSignInPath(role === 'sales' ? '/sales/login' : '/login');
        return;
      }
      resetForm();
      setStatus(`Saved user ${savedId}.`);
      try { await loadUsers(); } catch { setStatus(`Saved user ${savedId}. Refresh to reload the list.`); }
    } catch { setStatus('Could not connect. Your changes are still here; please try again.'); }
    finally { saveInFlight.current = false; setSaving(false); }
  };

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Platform Users</h1>
      </div>
      <form onSubmit={saveUser} className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">{editingId ? 'Edit User' : 'Create / Reset User'}</h2>
        {editingId && <p className="mb-3 text-sm text-slate-600">User ID: <strong>{editingId}</strong> (unchanged when saved)</p>}
        <fieldset disabled={saving || Boolean(signInPath)}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="user-email">Email</label>
            <input id="user-email" ref={emailInput} type="email" required maxLength={254} autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@everycall.io" />
            <label htmlFor="user-name" className="mt-2.5">Name</label>
            <input id="user-name" type="text" required={Boolean(editingId)} maxLength={100} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin" />
          </div>
          <div>
            <label htmlFor="user-role">Role</label>
            <select id="user-role" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
              <option value="sales">Sales (Sales Console only)</option>
            </select>
            <label htmlFor="user-password" className="mt-2.5">{editingId ? 'New password (optional)' : 'Password'}</label>
            <input id="user-password" required={!editingId} autoComplete="new-password" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={editingId ? 'Leave blank to keep the current password' : 'At least 8 characters'} />
            {editingId && <p className="mt-1 text-sm text-slate-500">Leave blank to keep the current password. Email, role or password changes sign this user out.</p>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button type="submit">{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save User'}</Button>
          {editingId && <Button type="button" variant="outline" onClick={() => { resetForm(); setStatus(''); }}>Cancel</Button>}
        </div>
        </fieldset>
        <p role="status" className="mt-3 text-sm text-slate-600">{status}</p>
        {signInPath && <a className="font-semibold underline" href={signInPath}>Sign in again</a>}
      </form>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No platform users yet.' }}
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';

export default function TeamPage() {
  const [users, setUsers] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteStatus, setInviteStatus] = useState('active');
  const [loading, setLoading] = useState(false);
  const [savingInvite, setSavingInvite] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading team users...', tone: 'warn' });

  const loadUsers = () => {
    setLoading(true);
    fetch('/api/v1/tenant/users')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load team users.', tone: 'bad' });
          setLoading(false);
          return;
        }
        setUsers(data.users || []);
        setStatus({ message: `Loaded ${data.users?.length || 0} team user(s).`, tone: 'ok' });
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load team users.', tone: 'bad' });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateStatus = async (id, nextStatus) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', id, status: nextStatus })
    });
    if (!resp.ok) {
      setStatus({ message: 'Status update failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'User status updated.', tone: 'ok' });
    loadUsers();
  };

  const resendInvite = async (id) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resend', id })
    });
    setStatus(resp.ok ? { message: 'Invite resent.', tone: 'ok' } : { message: 'Invite resend failed.', tone: 'bad' });
  };

  const updatePhone = async (id, phoneNumber) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_phone', id, phoneNumber })
    });
    if (!resp.ok) {
      setStatus({ message: 'Phone update failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'Phone number updated.', tone: 'ok' });
    loadUsers();
  };

  const requestSmsOptIn = async (id) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sms_opt_in_request', id })
    });
    if (!resp.ok) {
      setStatus({ message: 'SMS opt-in request failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'SMS opt-in request sent.', tone: 'ok' });
    loadUsers();
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    const resp = await fetch(`/api/v1/tenant/users?id=${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      setStatus({ message: 'Delete failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'User deleted.', tone: 'ok' });
    loadUsers();
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setStatus({ message: 'Name and email are required for invite.', tone: 'bad' });
      return;
    }
    setSavingInvite(true);
    setStatus({ message: 'Sending invite...', tone: 'warn' });
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        phoneNumber: invitePhone.trim(),
        role: inviteRole,
        status: inviteStatus
      })
    });
    setSavingInvite(false);
    if (!resp.ok) {
      setStatus({ message: 'Invite failed.', tone: 'bad' });
      return;
    }
    setInviteName('');
    setInviteEmail('');
    setInvitePhone('');
    setInviteRole('member');
    setInviteStatus('active');
    setShowInvite(false);
    setStatus({ message: 'Invite sent.', tone: 'ok' });
    loadUsers();
  };

  const rows = useMemo(() => users.map((user, idx) => ({
    id: user.id || idx,
    name: user.name,
    email: user.email,
    phone: user.phone_number || '',
    role: user.role,
    status: user.status,
    smsOptIn: user.sms_opt_in_status || 'not_requested'
  })), [users]);

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 140 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
    { field: 'phone', headerName: 'Phone', flex: 0.9, minWidth: 150 },
    { field: 'role', headerName: 'Role', flex: 0.6, minWidth: 120 },
    {
      field: 'smsOptIn',
      headerName: 'SMS Opt-In',
      flex: 0.7,
      minWidth: 140,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'opted_in' ? 'ok' : params.value === 'pending' ? 'warn' : 'bad'}`}>
          {params.value}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'active' ? 'ok' : params.value === 'invited' ? 'warn' : 'bad'}`}>{params.value}</span>
      )
    },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 260,
      renderCell: (params) => (
        <div className="flex w-full justify-end gap-1.5">
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => {
              const phone = window.prompt('Enter mobile number (E.164 recommended):', params.row.phone || '');
              if (!phone) return;
              updatePhone(params.row.id, phone);
            }}
          >
            Set Phone
          </button>
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            onClick={() => requestSmsOptIn(params.row.id)}
            disabled={!params.row.phone || params.row.smsOptIn === 'opted_in'}
          >
            {params.row.smsOptIn === 'opted_in' ? 'SMS Enabled' : 'Request SMS'}
          </button>
          {params.row.status === 'invited' ? (
            <button className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted" onClick={() => resendInvite(params.row.id)}>Resend</button>
          ) : null}
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => updateStatus(params.row.id, params.row.status === 'active' ? 'disabled' : 'active')}
          >
            {params.row.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
          <button className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted" onClick={() => deleteUser(params.row.id)}>Delete</button>
        </div>
      )
    }
  ];

  return (
    <ClientPage
      title="Team Users"
      subtitle="Invite teammates and manage account access in one place."
      status={status}
      primaryAction={{
        label: showInvite ? 'Close Invite Form' : 'Invite User',
        brand: true,
        onClick: () => setShowInvite((prev) => !prev)
      }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          {showInvite ? (
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <h2 className="mt-0 text-lg font-semibold">Invite Team Member</h2>
              <form className="grid gap-3" onSubmit={handleInvite}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label>Name</label>
                    <input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label>Email</label>
                    <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="jane@company.com" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label>Mobile Phone</label>
                    <input value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} placeholder="+1XXXXXXXXXX" />
                  </div>
                  <div></div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label>Role</label>
                    <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <div>
                    <label>Status</label>
                    <select value={inviteStatus} onChange={(event) => setInviteStatus(event.target.value)}>
                      <option value="active">Active</option>
                      <option value="invited">Invited</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={savingInvite}>
                    {savingInvite ? 'Sending...' : 'Send Invite'}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Team Directory</h2>
            <div style={{ height: rows.length ? 'auto' : 300 }}>
              <DataGrid
                rows={rows}
                columns={columns}
                autoHeight
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                localeText={{ noRowsLabel: loading ? 'Loading users...' : 'No users yet.' }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
                }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Help</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-500">
            <li>Invite only trusted users who need access to calls and settings.</li>
            <li>Use role and status to control who can make changes.</li>
            <li>SMS alerts require opt-in by replying YES to a request text.</li>
          </ul>
        </div>
      </div>
    </ClientPage>
  );
}

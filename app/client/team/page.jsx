'use client';

import { useEffect, useRef, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function TeamPage() {
  const [users, setUsers] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteStatus, setInviteStatus] = useState('active');
  const [inviteMessage, setInviteMessage] = useState('');
  const gridRef = useRef(null);

  const loadUsers = () => {
    let mounted = true;
    fetch(`/api/v1/tenant/users`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setUsers(data.users || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  };

  useEffect(() => {
    const cleanup = loadUsers();
    return cleanup;
  }, []);

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
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}>
          {params.row.status === 'invited' ? (
            <button
              className="btn"
              onClick={() => resendInvite(params.row.id)}
            >
              Resend
            </button>
          ) : null}
          <button
            className="btn"
            onClick={() => updateStatus(params.row.id, params.row.status === 'active' ? 'disabled' : 'active')}
          >
            {params.row.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
          <button
            className="btn"
            onClick={() => deleteUser(params.row.id)}
          >
            Delete
          </button>
        </div>
      )
    }
  ];

  const handleInvite = async (event) => {
    event.preventDefault();
    setInviteMessage('');
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setInviteMessage('Name and email are required.');
      return;
    }
    const resp = await fetch(`/api/v1/tenant/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        status: inviteStatus
      })
    });
    if (!resp.ok) {
      setInviteMessage('Invite failed.');
      return;
    }
    setInviteMessage('Invite added.');
    setInviteName('');
    setInviteEmail('');
    setInviteRole('member');
    setInviteStatus('active');
    setShowInvite(false);
    loadUsers();
  };

  const updateStatus = async (id, nextStatus) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', id, status: nextStatus })
    });
    if (!resp.ok) {
      setInviteMessage('Status update failed.');
      return;
    }
    loadUsers();
  };

  const resendInvite = async (id) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resend', id })
    });
    if (!resp.ok) {
      setInviteMessage('Resend failed.');
      return;
    }
    setInviteMessage('Invite resent.');
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    const resp = await fetch(`/api/v1/tenant/users?id=${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      setInviteMessage('Delete failed.');
      return;
    }
    loadUsers();
  };

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Team Users</h1>
        <div className="top-actions">
          <button className="btn brand" onClick={() => setShowInvite((prev) => !prev)}>
            {showInvite ? 'Close Invite' : 'Invite User'}
          </button>
        </div>
      </div>
      <div ref={gridRef} className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div>
          {showInvite && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h2>Invite Team Member</h2>
              <form className="stack" onSubmit={handleInvite}>
                <div className="form-row">
                  <div>
                    <label>Name</label>
                    <input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label>Email</label>
                    <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="jane@company.com" />
                  </div>
                </div>
                <div className="form-row">
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
                <div className="toolbar" style={{ marginTop: 6 }}>
                  <button className="btn brand" type="submit">Send Invite</button>
                  <span className="muted">{inviteMessage}</span>
                </div>
              </form>
            </div>
          )}
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
        </div>
        <div className="card">
          <h2>Help</h2>
          <ul className="muted" style={{ paddingLeft: 18, marginTop: 8 }}>
            <li>Invite teammates who need access to calls or settings.</li>
            <li>Use roles to control who can edit routing and FAQs.</li>
            <li>Keep admin access limited to trusted owners.</li>
            <li>Set status to “Invited” if the user hasn’t accepted yet.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

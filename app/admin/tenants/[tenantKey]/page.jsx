'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DataGrid } from '@mui/x-data-grid';

export default function TenantManagePage() {
  const params = useParams();
  const tenantKey = params.tenantKey;
  const [tenant, setTenant] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('Idle');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/tenants?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setTenant(data?.tenant || null); })
      .catch(() => {});

    fetch(`/api/v1/config/agent?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setPrompt(data?.systemPrompt || ''); })
      .catch(() => {});

    fetch(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setUsers(data?.users || []); })
      .catch(() => {});

    return () => { mounted = false; };
  }, [tenantKey]);

  const savePrompt = async () => {
    setStatus('Saving...');
    const resp = await fetch('/api/v1/config/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantKey, systemPrompt: prompt })
    });
    if (!resp.ok) {
      setStatus('Save failed.');
      return;
    }
    setStatus('Saved.');
  };

  const rows = users.map((u, idx) => ({
    id: u.id || idx,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status
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
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar">
        <div>
          <div className="eyebrow">Manage Tenant</div>
          <h1>{tenant?.name || tenantKey}</h1>
        </div>
        <div className="top-actions">
          <button className="btn">Pause Tenant</button>
          <button className="btn brand" onClick={savePrompt}>Save Changes</button>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <label>Tenant Details</label>
          <div className="kv">
            <div>Status</div><div>{tenant?.status || '-'}</div>
            <div>Data Region</div><div>{tenant?.data_region || '-'}</div>
            <div>Primary Number</div><div>{tenant?.primary_number || '-'}</div>
            <div>Plan</div><div>{tenant?.plan || '-'}</div>
          </div>
        </div>
        <div className="card">
          <label>Agent Prompt &amp; Behavior</label>
          <p className="muted">This prompt is stored per tenant.</p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 180 }}></textarea>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn brand" onClick={savePrompt}>Save Prompt</button>
            <span className="muted">{status}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <label>Client Users</label>
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
    </section>
  );
}

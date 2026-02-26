'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function AdminAuditPage() {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/audit')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setEntries(data.entries || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const rows = entries
    .filter((entry) => {
      if (tenantFilter && entry.tenant_key !== tenantFilter) return false;
      if (!search.trim()) return true;
      const hay = `${entry.tenant_key} ${entry.actor} ${entry.action} ${entry.details}`.toLowerCase();
      return hay.includes(search.trim().toLowerCase());
    })
    .map((entry, idx) => ({
    id: idx,
    tenant: entry.tenant_key || '-',
    actor: entry.actor || '-',
    action: entry.action || '-',
    details: entry.details || '-',
    createdAt: entry.created_at ? new Date(entry.created_at).toLocaleString() : '-'
  }));

  const tenants = Array.from(new Set(entries.map((entry) => entry.tenant_key).filter(Boolean)));

  const columns = [
    { field: 'createdAt', headerName: 'Time', flex: 0.8, minWidth: 160 },
    { field: 'tenant', headerName: 'Tenant', flex: 0.8, minWidth: 140 },
    { field: 'actor', headerName: 'Actor', flex: 0.8, minWidth: 140 },
    { field: 'action', headerName: 'Action', flex: 0.8, minWidth: 160 },
    { field: 'details', headerName: 'Details', flex: 1.6, minWidth: 260 }
  ];

  return (
    <section className="screen active">
      <div className="topbar"><h1>Audit Log</h1></div>
      <div className="toolbar" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <label>Tenant</label>
        <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
          <option value="">All</option>
          {tenants.map((tenant) => (
            <option key={tenant} value={tenant}>{tenant}</option>
          ))}
        </select>
        <label>Search</label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="actor, action, details" />
        <span className="muted">{rows.length} entries</span>
      </div>
      <div className="card">
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No audit entries yet.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4', whiteSpace: 'normal' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 },
            '& .MuiDataGrid-row': { maxHeight: 'none' }
          }}
        />
      </div>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';

function formatMoney(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Unknown';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export default function AdminPhoneNumbersPage() {
  const [report, setReport] = useState({ rows: [], summary: null, sourceStatus: 'loading' });
  const [status, setStatus] = useState('Loading...');
  const [assignDialog, setAssignDialog] = useState({
    open: false,
    phoneNumber: '',
    tenants: [],
    selectedTenantKey: '',
    loading: false,
    submitting: false,
    error: ''
  });

  const loadReport = async ({ mounted = true, preserveStatus = false } = {}) => {
    try {
      const data = await fetchJson('/api/v1/admin/phone-numbers/report');
      if (!mounted || !data?.ok) {
        if (mounted && !preserveStatus) setStatus('Could not load phone number report.');
        return;
      }
      setReport({
        rows: data.rows || [],
        summary: data.summary || null,
        sourceStatus: data.sourceStatus || 'unknown'
      });
      if (!preserveStatus) {
        setStatus(data.sourceStatus === 'live'
          ? 'Loaded live Telnyx number inventory.'
          : 'Loaded with fallback data. Some live Telnyx details are unavailable.'
        );
      }
    } catch {
      if (mounted && !preserveStatus) setStatus('Could not load phone number report.');
    }
  };

  useEffect(() => {
    let mounted = true;
    loadReport({ mounted });
    return () => { mounted = false; };
  }, []);

  const rows = (report.rows || []).map((row, idx) => ({
    id: row.phoneNumber || `${row.tenantKey || 'tenant'}-${idx}`,
    phoneNumber: row.phoneNumber || '',
    assignmentStatus: row.assignmentStatus || '',
    telnyxStatus: row.telnyxStatus || '',
    tenant: row.tenantName || row.tenantKey || 'Unassigned',
    tenantKey: row.tenantKey || '',
    ownerName: row.ownerName || '',
    ownerEmail: row.ownerEmail || '',
    purchasedAt: row.purchasedAt ? new Date(row.purchasedAt).toLocaleString() : '',
    monthlyCost: typeof row.monthlyCost === 'number' ? formatMoney(row.monthlyCost) : 'Unknown',
    estimated30DayCost: typeof row.estimated30DayCost === 'number' ? formatMoney(row.estimated30DayCost) : 'Unknown',
    costStatus: row.costStatus || 'unknown'
  }));

  const closeAssignDialog = () => {
    setAssignDialog({
      open: false,
      phoneNumber: '',
      tenants: [],
      selectedTenantKey: '',
      loading: false,
      submitting: false,
      error: ''
    });
  };

  const openAssignDialog = async (phoneNumber) => {
    setAssignDialog({
      open: true,
      phoneNumber,
      tenants: [],
      selectedTenantKey: '',
      loading: true,
      submitting: false,
      error: ''
    });
    try {
      const data = await fetchJson('/api/v1/admin/phone-numbers/eligible-tenants');
      if (!data?.ok) {
        setAssignDialog((current) => ({
          ...current,
          loading: false,
          error: data?.message || 'Could not load eligible tenants.'
        }));
        return;
      }
      const tenants = Array.isArray(data.tenants) ? data.tenants : [];
      setAssignDialog((current) => ({
        ...current,
        loading: false,
        tenants,
        selectedTenantKey: tenants[0]?.tenantKey || '',
        error: tenants.length ? '' : 'No tenants are currently eligible for assignment.'
      }));
    } catch {
      setAssignDialog((current) => ({
        ...current,
        loading: false,
        error: 'Could not load eligible tenants.'
      }));
    }
  };

  const submitAssignment = async () => {
    if (!assignDialog.phoneNumber || !assignDialog.selectedTenantKey) {
      setAssignDialog((current) => ({
        ...current,
        error: 'Choose a tenant before assigning this number.'
      }));
      return;
    }
    setAssignDialog((current) => ({
      ...current,
      submitting: true,
      error: ''
    }));
    setStatus(`Assigning ${assignDialog.phoneNumber}...`);
    try {
      const data = await fetchJson('/api/v1/admin/phone-numbers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: assignDialog.phoneNumber,
          tenantKey: assignDialog.selectedTenantKey
        })
      });
      if (!data?.ok) {
        setAssignDialog((current) => ({
          ...current,
          submitting: false,
          error: data?.message || 'Assignment failed.'
        }));
        setStatus(data?.message || 'Assignment failed.');
        return;
      }
      const assignedTenant = assignDialog.tenants.find((tenant) => tenant.tenantKey === assignDialog.selectedTenantKey);
      closeAssignDialog();
      await loadReport({ preserveStatus: true });
      setStatus(
        data.routingUpdated
          ? `Assigned ${data.phoneNumber} to ${assignedTenant?.tenantName || data.tenantKey} after updating Telnyx routing.`
          : `Assigned ${data.phoneNumber} to ${assignedTenant?.tenantName || data.tenantKey}.`
      );
    } catch {
      setAssignDialog((current) => ({
        ...current,
        submitting: false,
        error: 'Assignment failed.'
      }));
      setStatus('Assignment failed.');
    }
  };

  const columns = [
    { field: 'phoneNumber', headerName: 'Phone Number', flex: 0.9, minWidth: 160 },
    { field: 'assignmentStatus', headerName: 'Assignment', flex: 0.8, minWidth: 140 },
    { field: 'telnyxStatus', headerName: 'Provider Status', flex: 0.8, minWidth: 140 },
    { field: 'tenant', headerName: 'Tenant', flex: 1, minWidth: 180 },
    { field: 'tenantKey', headerName: 'Tenant Key', flex: 1, minWidth: 180 },
    { field: 'ownerName', headerName: 'Owner Name', flex: 0.9, minWidth: 160 },
    { field: 'ownerEmail', headerName: 'Owner Email', flex: 1.2, minWidth: 220 },
    { field: 'purchasedAt', headerName: 'Purchased', flex: 1, minWidth: 180 },
    { field: 'monthlyCost', headerName: 'Monthly Cost', flex: 0.8, minWidth: 140 },
    { field: 'estimated30DayCost', headerName: '30-Day Cost', flex: 0.8, minWidth: 140 },
    {
      field: 'costStatus',
      headerName: 'Cost Status',
      flex: 0.7,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'tracked' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    },
    {
      field: 'actions',
      headerName: 'Actions',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 120,
      renderCell: (params) => (
        params.row.assignmentStatus === 'unassigned' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              openAssignDialog(params.row.phoneNumber);
            }}
          >
            Assign
          </Button>
        ) : null
      )
    }
  ];

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Phone Number Report</h1>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Numbers</div>
          <div className="mt-1 text-3xl font-bold">{report.summary?.totalNumbers ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Assigned</div>
          <div className="mt-1 text-3xl font-bold">{report.summary?.assignedNumbers ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Unassigned</div>
          <div className="mt-1 text-3xl font-bold">{report.summary?.unassignedNumbers ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Tracked 30-Day Cost</div>
          <div className="mt-1 text-3xl font-bold">{formatMoney((report.summary?.trackedEstimated30DayCostCents ?? 0) / 100)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-3 text-sm text-slate-500">
          Numbers provisioned in Telnyx but not assigned to a tenant show up as <code>unassigned</code>. Number cost is only tracked for numbers provisioned after cost capture was added, so older numbers may show <code>Unknown</code>.
        </div>
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
          localeText={{ noRowsLabel: 'No phone numbers found.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>

      {assignDialog.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold tracking-tight">Assign Phone Number</h2>
                <div className="mt-1 text-sm text-slate-500">{assignDialog.phoneNumber}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={closeAssignDialog} disabled={assignDialog.submitting}>Close</Button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-900">Eligible Tenant</span>
                <select
                  value={assignDialog.selectedTenantKey}
                  onChange={(event) => setAssignDialog((current) => ({ ...current, selectedTenantKey: event.target.value }))}
                  disabled={assignDialog.loading || assignDialog.submitting || !assignDialog.tenants.length}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {assignDialog.tenants.map((tenant) => (
                    <option key={tenant.tenantKey} value={tenant.tenantKey}>
                      {tenant.tenantName} ({tenant.tenantKey})
                    </option>
                  ))}
                </select>
              </label>

              {assignDialog.loading ? (
                <div className="text-sm text-slate-500">Loading eligible tenants...</div>
              ) : null}

              {assignDialog.error ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {assignDialog.error}
                </div>
              ) : null}

              {assignDialog.selectedTenantKey ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {(() => {
                    const tenant = assignDialog.tenants.find((item) => item.tenantKey === assignDialog.selectedTenantKey);
                    return tenant
                      ? `${tenant.tenantName} (${tenant.tenantKey})${tenant.ownerEmail ? ` · ${tenant.ownerEmail}` : ''}`
                      : 'No tenant selected.';
                  })()}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closeAssignDialog} disabled={assignDialog.submitting}>Cancel</Button>
              <Button
                onClick={submitAssignment}
                disabled={assignDialog.loading || assignDialog.submitting || !assignDialog.selectedTenantKey}
              >
                {assignDialog.submitting ? 'Assigning...' : 'Assign Number'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

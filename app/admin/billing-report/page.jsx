'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataGrid } from '@mui/x-data-grid';
import { buttonVariants } from '../../../components/ui/button';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';
import { cn } from '../../../lib/utils';

function formatTimestamp(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

function statusBadge(value) {
  if (value === 'ok' || value === 'active' || value === 'enabled') return 'ok';
  if (value === 'degraded' || value === 'trialing') return 'warn';
  return 'bad';
}

export default function AdminBillingReportPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('Loading billing report...');

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/billing/report')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.ok) {
          if (mounted) setStatus('Could not load billing report.');
          return;
        }
        const nextRows = Array.isArray(data.rows) ? data.rows : [];
        setRows(nextRows);
        setStatus(nextRows.length
          ? 'Tenants needing billing attention in the next 7 days.'
          : 'No tenants need billing attention right now.');
      })
      .catch(() => {
        if (mounted) setStatus('Could not load billing report.');
      });
    return () => { mounted = false; };
  }, []);

  const summary = useMemo(() => {
    const expiringTrials = rows.filter((row) => row.billing_status === 'trialing').length;
    const expiredAccess = rows.filter((row) => row.billing_status === 'trial_expired').length;
    const emailIssues = rows.filter((row) => row.email_status && row.email_status !== 'ok').length;
    const smsIssues = rows.filter((row) => row.sms_status && row.sms_status !== 'ok').length;
    return {
      expiringTrials,
      expiredAccess,
      emailIssues,
      smsIssues
    };
  }, [rows]);

  const gridRows = rows.map((row, index) => ({
    id: row.tenant_key || index,
    tenantKey: row.tenant_key,
    tenantName: row.name || row.tenant_key,
    billingStatus: row.billing_status || '—',
    serviceAccessStatus: row.service_access_status || '—',
    appAccessStatus: row.app_access_status || '—',
    trialEnd: row.trial_end || null,
    postTrialAccessEndsAt: row.post_trial_access_ends_at || null,
    targetDate: row.trial_end || row.post_trial_access_ends_at || null,
    phone: row.telnyx_voice_number || '',
    emailStatus: row.email_status || 'unknown',
    emailError: row.email_error || '',
    smsStatus: row.sms_status || 'unknown',
    smsError: row.sms_error || ''
  }));

  const columns = [
    { field: 'tenantName', headerName: 'Tenant', flex: 1.2, minWidth: 180 },
    { field: 'tenantKey', headerName: 'Tenant Key', flex: 1, minWidth: 180 },
    {
      field: 'billingStatus',
      headerName: 'Billing',
      flex: 0.7,
      minWidth: 130,
      renderCell: (params) => (
        <span className={`badge ${statusBadge(params.value)}`}>{params.value}</span>
      )
    },
    {
      field: 'targetDate',
      headerName: 'Action Date',
      flex: 0.8,
      minWidth: 140,
      renderCell: (params) => formatDate(params.value)
    },
    {
      field: 'phone',
      headerName: 'Receptionist Number',
      flex: 0.9,
      minWidth: 150,
      renderCell: (params) => formatPhoneDisplay(params.value) || '—'
    },
    {
      field: 'emailStatus',
      headerName: 'Email',
      flex: 0.55,
      minWidth: 110,
      renderCell: (params) => (
        <span className={`badge ${statusBadge(params.value)}`}>{params.value}</span>
      )
    },
    {
      field: 'smsStatus',
      headerName: 'SMS',
      flex: 0.55,
      minWidth: 110,
      renderCell: (params) => (
        <span className={`badge ${statusBadge(params.value)}`}>{params.value}</span>
      )
    },
    {
      field: 'notificationIssues',
      headerName: 'Notification Issues',
      flex: 1.2,
      minWidth: 240,
      renderCell: (params) => {
        const row = params.row;
        const parts = [];
        if (row.emailError) parts.push(`Email: ${row.emailError}`);
        if (row.smsError) parts.push(`SMS: ${row.smsError}`);
        return parts.length ? parts.join(' | ') : '—';
      }
    },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 120,
      renderCell: (params) => (
        <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`/admin/tenants/${params.row.tenantKey}`}>
          Manage
        </Link>
      )
    }
  ];

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Billing Report</h1>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs normal-case tracking-normal text-slate-500">Trials Ending Soon</div>
          <div className="mt-1 text-3xl font-bold">{summary.expiringTrials}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs normal-case tracking-normal text-slate-500">Expired Trial Access</div>
          <div className="mt-1 text-3xl font-bold">{summary.expiredAccess}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs normal-case tracking-normal text-slate-500">Email Issues</div>
          <div className="mt-1 text-3xl font-bold">{summary.emailIssues}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs normal-case tracking-normal text-slate-500">SMS Issues</div>
          <div className="mt-1 text-3xl font-bold">{summary.smsIssues}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 text-sm text-slate-600 shadow-sm">
        This report highlights tenants approaching the end of a trial or post-trial access window, along with the latest email and SMS notification health for follow-up.
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <DataGrid
          rows={gridRows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No billing attention items right now.' }}
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

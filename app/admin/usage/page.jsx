'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

function formatUsdFromMicros(value) {
  const micros = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(micros / 1_000_000);
}

function formatInt(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatDurationMinutes(seconds) {
  const totalSeconds = Number(seconds || 0);
  const minutes = totalSeconds / 60;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: minutes >= 10 ? 1 : 2 }).format(minutes);
}

export default function AdminUsagePage() {
  const [report, setReport] = useState({ tenantRows: [], callRows: [], summary: null });
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/usage/report')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.ok) {
          if (mounted) setStatus('Could not load cost report.');
          return;
        }
        setReport({
          tenantRows: data.tenantRows || [],
          callRows: data.callRows || [],
          summary: data.summary || null
        });
        setStatus('Last 30 days. Operational estimates based on recorded usage and configured rates.');
      })
      .catch(() => {
        if (mounted) setStatus('Could not load cost report.');
      });
    return () => { mounted = false; };
  }, []);

  const tenantRows = (report.tenantRows || []).map((row) => ({
    id: row.tenant_key,
    tenantKey: row.tenant_key,
    tenantName: row.tenant_name || row.tenant_key,
    callCount: Number(row.call_count || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    durationSeconds: Number(row.duration_seconds || 0),
    billableMinutes: Number(row.telephony_billable_minutes || 0),
    aiEstimatedCost: Number(row.ai_estimated_cost_micros_usd || 0),
    telephonyEstimatedCost: Number(row.telephony_estimated_cost_micros_usd || 0),
    notificationEstimatedCost: Number(row.notification_estimated_cost_micros_usd || 0),
    numberEstimatedCost: Number(row.number_estimated_cost_micros_usd || 0),
    estimatedCost: Number(row.total_estimated_cost_micros_usd || 0)
  }));

  const callRows = (report.callRows || []).map((row) => ({
    id: row.call_sid,
    callSid: row.call_sid,
    tenantKey: row.tenant_key,
    tenantName: row.tenant_name || row.tenant_key,
    model: row.ai_model || '',
    inputTokens: Number(row.ai_input_tokens || 0),
    outputTokens: Number(row.ai_output_tokens || 0),
    durationSeconds: Number(row.duration_seconds || 0),
    billableMinutes: Number(row.telephony_billable_minutes || 0),
    responseCount: Number(row.ai_response_count || 0),
    aiEstimatedCost: Number(row.ai_estimated_cost_micros_usd || 0),
    telephonyEstimatedCost: Number(row.telephony_estimated_cost_micros_usd || 0),
    notificationEstimatedCost: Number(row.notification_estimated_cost_micros_usd || 0),
    estimatedCost: Number(row.total_estimated_cost_micros_usd || 0),
    createdAt: row.created_at ? new Date(row.created_at).toLocaleString() : ''
  }));

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Operational Cost</h1>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Calls</div>
          <div className="mt-1 text-3xl font-bold">{formatInt(report.summary?.totalCalls ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Minutes</div>
          <div className="mt-1 text-3xl font-bold">{formatDurationMinutes(report.summary?.totalDurationSeconds ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Billable Minutes</div>
          <div className="mt-1 text-3xl font-bold">{formatInt(report.summary?.totalTelephonyBillableMinutes ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">AI Cost</div>
          <div className="mt-1 text-3xl font-bold">{formatUsdFromMicros(report.summary?.totalAiEstimatedCostMicrosUsd ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Telephony Cost</div>
          <div className="mt-1 text-3xl font-bold">{formatUsdFromMicros(report.summary?.totalTelephonyEstimatedCostMicrosUsd ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Estimated Cost</div>
          <div className="mt-1 text-3xl font-bold">{formatUsdFromMicros(report.summary?.totalEstimatedCostMicrosUsd ?? 0)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 text-sm text-slate-600 shadow-sm">
        Total estimated cost includes AI, telephony, notification delivery, and 30-day number-rental estimates. It is an operational estimate based on recorded usage, not invoice reconciliation.
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">By Tenant</h2>
        <DataGrid
          rows={tenantRows}
          columns={[
            { field: 'tenantName', headerName: 'Tenant', flex: 1.2, minWidth: 180 },
            { field: 'tenantKey', headerName: 'Tenant Key', flex: 1, minWidth: 180 },
            { field: 'callCount', headerName: 'Calls', flex: 0.5, minWidth: 90, valueFormatter: (value) => formatInt(value) },
            { field: 'durationSeconds', headerName: 'Minutes', flex: 0.6, minWidth: 110, valueFormatter: (value) => formatDurationMinutes(value) },
            { field: 'billableMinutes', headerName: 'Billable Min', flex: 0.6, minWidth: 120, valueFormatter: (value) => formatInt(value) },
            { field: 'aiEstimatedCost', headerName: 'AI Cost', flex: 0.75, minWidth: 130, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'telephonyEstimatedCost', headerName: 'Telephony', flex: 0.75, minWidth: 130, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'notificationEstimatedCost', headerName: 'Notifications', flex: 0.75, minWidth: 130, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'numberEstimatedCost', headerName: 'Number Rental', flex: 0.75, minWidth: 130, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'estimatedCost', headerName: 'Total Cost', flex: 0.8, minWidth: 140, valueFormatter: (value) => formatUsdFromMicros(value) }
          ]}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No usage data yet.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">Recent Calls</h2>
        <DataGrid
          rows={callRows}
          columns={[
            { field: 'createdAt', headerName: 'Time', flex: 0.9, minWidth: 180 },
            { field: 'tenantName', headerName: 'Tenant', flex: 1, minWidth: 180 },
            { field: 'callSid', headerName: 'Call SID', flex: 1.1, minWidth: 180 },
            { field: 'model', headerName: 'Model', flex: 0.9, minWidth: 160 },
            { field: 'durationSeconds', headerName: 'Minutes', flex: 0.55, minWidth: 100, valueFormatter: (value) => formatDurationMinutes(value) },
            { field: 'billableMinutes', headerName: 'Billable Min', flex: 0.55, minWidth: 120, valueFormatter: (value) => formatInt(value) },
            { field: 'responseCount', headerName: 'Responses', flex: 0.5, minWidth: 110, valueFormatter: (value) => formatInt(value) },
            { field: 'aiEstimatedCost', headerName: 'AI Cost', flex: 0.7, minWidth: 120, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'telephonyEstimatedCost', headerName: 'Telephony', flex: 0.7, minWidth: 120, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'notificationEstimatedCost', headerName: 'Notifications', flex: 0.7, minWidth: 130, valueFormatter: (value) => formatUsdFromMicros(value) },
            { field: 'estimatedCost', headerName: 'Total Cost', flex: 0.8, minWidth: 140, valueFormatter: (value) => formatUsdFromMicros(value) }
          ]}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No recent calls with usage data yet.' }}
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

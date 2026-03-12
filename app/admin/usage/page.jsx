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

export default function AdminUsagePage() {
  const [report, setReport] = useState({ tenantRows: [], callRows: [], summary: null });
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/admin/usage/report')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.ok) {
          if (mounted) setStatus('Could not load AI usage report.');
          return;
        }
        setReport({
          tenantRows: data.tenantRows || [],
          callRows: data.callRows || [],
          summary: data.summary || null
        });
        setStatus('Last 30 days.');
      })
      .catch(() => {
        if (mounted) setStatus('Could not load AI usage report.');
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
    estimatedCost: Number(row.estimated_cost_micros_usd || 0)
  }));

  const callRows = (report.callRows || []).map((row) => ({
    id: row.call_sid,
    callSid: row.call_sid,
    tenantKey: row.tenant_key,
    tenantName: row.tenant_name || row.tenant_key,
    model: row.ai_model || '',
    inputTokens: Number(row.ai_input_tokens || 0),
    outputTokens: Number(row.ai_output_tokens || 0),
    responseCount: Number(row.ai_response_count || 0),
    estimatedCost: Number(row.ai_estimated_cost_micros_usd || 0),
    createdAt: row.created_at ? new Date(row.created_at).toLocaleString() : ''
  }));

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">AI Usage</h1>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Calls</div>
          <div className="mt-1 text-3xl font-bold">{formatInt(report.summary?.totalCalls ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Input Tokens</div>
          <div className="mt-1 text-3xl font-bold">{formatInt(report.summary?.totalInputTokens ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Output Tokens</div>
          <div className="mt-1 text-3xl font-bold">{formatInt(report.summary?.totalOutputTokens ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Estimated Cost</div>
          <div className="mt-1 text-3xl font-bold">{formatUsdFromMicros(report.summary?.totalEstimatedCostMicrosUsd ?? 0)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">By Tenant</h2>
        <DataGrid
          rows={tenantRows}
          columns={[
            { field: 'tenantName', headerName: 'Tenant', flex: 1.2, minWidth: 180 },
            { field: 'tenantKey', headerName: 'Tenant Key', flex: 1, minWidth: 180 },
            { field: 'callCount', headerName: 'Calls', flex: 0.5, minWidth: 90, valueFormatter: ({ value }) => formatInt(value) },
            { field: 'inputTokens', headerName: 'Input Tokens', flex: 0.8, minWidth: 140, valueFormatter: ({ value }) => formatInt(value) },
            { field: 'outputTokens', headerName: 'Output Tokens', flex: 0.8, minWidth: 140, valueFormatter: ({ value }) => formatInt(value) },
            { field: 'estimatedCost', headerName: 'Estimated Cost', flex: 0.8, minWidth: 140, valueFormatter: ({ value }) => formatUsdFromMicros(value) }
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
            { field: 'responseCount', headerName: 'Responses', flex: 0.5, minWidth: 110, valueFormatter: ({ value }) => formatInt(value) },
            { field: 'inputTokens', headerName: 'Input Tokens', flex: 0.8, minWidth: 140, valueFormatter: ({ value }) => formatInt(value) },
            { field: 'outputTokens', headerName: 'Output Tokens', flex: 0.8, minWidth: 140, valueFormatter: ({ value }) => formatInt(value) },
            { field: 'estimatedCost', headerName: 'Estimated Cost', flex: 0.8, minWidth: 140, valueFormatter: ({ value }) => formatUsdFromMicros(value) }
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

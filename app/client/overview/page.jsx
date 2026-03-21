'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import Link from 'next/link';
import { buttonVariants } from '../../../components/ui/button';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';
import { cn } from '../../../lib/utils';
import ClientPage from '../_components/ClientPage';

export default function OverviewPage() {
  const [stats, setStats] = useState({ callsToday: 0, missed: 0, urgent: 0, callbacksDue: 0 });
  const [recentCalls, setRecentCalls] = useState([]);
  const [actionQueue, setActionQueue] = useState([]);
  const [loadState, setLoadState] = useState('loading');

  useEffect(() => {
    let mounted = true;
    setLoadState('loading');
    fetch(`/api/v1/overview`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted) return;
        if (!data) {
          setLoadState('error');
          return;
        }
        setStats(data.stats || stats);
        setRecentCalls(data.recentCalls || []);
        setActionQueue(data.actionQueue || []);
        setLoadState('ready');
      })
      .catch(() => {
        if (mounted) setLoadState('error');
      });
    return () => { mounted = false; };
  }, []);

  const rows = recentCalls.map((call, idx) => ({
    id: call.call_sid || idx,
    time: new Date(call.created_at).toLocaleTimeString(),
    caller: formatPhoneDisplay(call.from_number) || '-',
    status: call.urgency === 'high' ? 'Urgent' : call.status || 'Handled',
    statusTone: call.urgency === 'high' ? 'warn' : call.status === 'error' ? 'bad' : 'ok',
    summary: call.summary || '-'
  }));

  const columns = [
    { field: 'time', headerName: 'Time', flex: 0.6, minWidth: 100 },
    { field: 'caller', headerName: 'Caller', flex: 1, minWidth: 160 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.row.statusTone}`}>{params.value}</span>
      )
    },
    { field: 'summary', headerName: 'Summary', flex: 1.4, minWidth: 220 }
  ];

  const status = loadState === 'error'
    ? { tone: 'bad', message: 'Could not load overview data. Use refresh in your browser to retry.' }
    : loadState === 'loading'
      ? { tone: 'warn', message: 'Loading your call triage dashboard...' }
      : stats.urgent > 0 || stats.callbacksDue > 0
        ? { tone: 'warn', message: `${stats.urgent} urgent call(s) and ${stats.callbacksDue} callback(s) need attention.` }
        : { tone: 'ok', message: 'Queue is clear. No urgent call actions right now.' };

  return (
    <ClientPage
      title="Overview"
      subtitle="Triage first: handle urgent calls, then callbacks, then inbox review."
      status={status}
      primaryAction={{ href: '/client/calls', label: 'Open Urgent Calls', brand: true }}
    >
      <div className="flex flex-wrap gap-2">
        <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/calls">Open Callbacks</Link>
        <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/calls">Open Inbox</Link>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wider text-slate-500">Calls Today</div><div className="mt-1 text-3xl font-bold">{stats.callsToday}</div></div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wider text-slate-500">Missed</div><div className="mt-1 text-3xl font-bold">{stats.missed}</div></div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wider text-slate-500">Urgent</div><div className="mt-1 text-3xl font-bold">{stats.urgent}</div></div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><div className="text-xs uppercase tracking-wider text-slate-500">Callbacks Due</div><div className="mt-1 text-3xl font-bold">{stats.callbacksDue}</div></div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Recent Calls</h2>
          {loadState === 'error' ? (
            <p className="text-sm text-slate-500">Unable to load recent calls.</p>
          ) : (
            <div className="overflow-auto">
            <DataGrid
              rows={rows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[5, 10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
              localeText={{ noRowsLabel: 'No recent calls.' }}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
                '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
              }}
            />
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Action Queue</h2>
          <p className="text-sm text-slate-500">Calls requiring callback or dispatch confirmation.</p>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-[180px_1fr]">
            {loadState === 'error' ? (
              <div className="text-slate-500">Unable to load callback queue.</div>
            ) : actionQueue.length === 0 ? (
              <div className="text-slate-500">No callbacks due.</div>
            ) : actionQueue.map((item, idx) => (
              <span key={`${item.caller_name}-${idx}`} style={{ display: 'contents' }}>
                <div>{item.caller_name || 'Caller'}</div>
                <div>{item.summary || ''}</div>
              </span>
            ))}
          </div>
        </div>
      </div>
    </ClientPage>
  );
}

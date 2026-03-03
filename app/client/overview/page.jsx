'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import Link from 'next/link';
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
    caller: call.from_number || '-',
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
      <div className="client-quick-actions">
        <Link className="btn" href="/client/dispatch">Open Callbacks</Link>
        <Link className="btn" href="/client/calls">Open Inbox</Link>
      </div>

      <div className="grid cols-4">
        <div className="card"><div className="stat">Calls Today</div><div className="value">{stats.callsToday}</div></div>
        <div className="card"><div className="stat">Missed</div><div className="value">{stats.missed}</div></div>
        <div className="card"><div className="stat">Urgent</div><div className="value">{stats.urgent}</div></div>
        <div className="card"><div className="stat">Callbacks Due</div><div className="value">{stats.callbacksDue}</div></div>
      </div>

      <div className="split" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Recent Calls</h2>
          {loadState === 'error' ? (
            <p className="muted">Unable to load recent calls.</p>
          ) : (
            <div className="table-wrap">
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
        <div className="card">
          <h2>Action Queue</h2>
          <p className="muted">Calls requiring callback or dispatch confirmation.</p>
          <div className="kv">
            {loadState === 'error' ? (
              <div className="muted">Unable to load callback queue.</div>
            ) : actionQueue.length === 0 ? (
              <div className="muted">No callbacks due.</div>
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import ClientPage from '../_components/ClientPage';

const emptyDispatchCounts = { new: 0, assigned: 0, closed: 0 };
const emptyDispatchDraft = { callerName: '', summary: '', dueAt: '', assignedTo: '', status: 'new', callSid: '' };

export default function CallsPage() {
  const [calls, setCalls] = useState([]);
  const [detailMeta, setDetailMeta] = useState(null);
  const [detailTranscript, setDetailTranscript] = useState('');
  const [detailStatus, setDetailStatus] = useState('Select a call to inspect transcript, extracted fields, and routing result.');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [dispatchCounts, setDispatchCounts] = useState(emptyDispatchCounts);
  const [dispatchItems, setDispatchItems] = useState([]);
  const [dispatchSelected, setDispatchSelected] = useState(null);
  const [dispatchStatus, setDispatchStatus] = useState('');
  const [dispatchUsers, setDispatchUsers] = useState([]);
  const [newDispatch, setNewDispatch] = useState(emptyDispatchDraft);

  const loadCalls = () => {
    setLoading(true);
    setLoadError('');
    let mounted = true;
    fetch(`/api/v1/calls`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted) return;
        if (!data) {
          setLoadError('Could not load calls. Refresh to retry.');
          setLoading(false);
          return;
        }
        setCalls(data.calls || []);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadError('Could not load calls. Refresh to retry.');
        setLoading(false);
      });
    return () => { mounted = false; };
  };

  const loadDispatch = () => {
    let mounted = true;
    fetch(`/api/v1/dispatch`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setDispatchCounts(data.counts || emptyDispatchCounts);
        setDispatchItems(data.items || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  };

  const loadAll = () => {
    loadCalls();
    loadDispatch();
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    fetch('/api/v1/tenant/users')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setDispatchUsers(data?.users || []))
      .catch(() => {});
  }, []);

  const loadDetail = async (callSid) => {
    if (!callSid) return;
    setDetailStatus('Loading call details...');
    setDetailMeta(null);
    setDetailTranscript('');

    const [metaResp, transcriptResp] = await Promise.all([
      fetch(`/api/v1/calls?callSid=${encodeURIComponent(callSid)}`),
      fetch(`/api/v1/calls?mode=transcript&callSid=${encodeURIComponent(callSid)}`)
    ]);

    if (metaResp.ok) {
      const data = await metaResp.json();
      setDetailMeta(data.call || null);
    }

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      setDetailTranscript(data.transcript || '');
    }

    setDetailStatus('Ready.');
  };

  useEffect(() => {
    if (!detailMeta || dispatchSelected) return;
    const extracted = detailMeta.extracted_json || {};
    const callerName = extracted.caller_name || extracted.caller || detailMeta.from_number || '';
    const summary = detailMeta.summary || extracted.issue_summary || extracted.issue || '';
    setNewDispatch((prev) => ({
      ...prev,
      callerName,
      summary,
      callSid: detailMeta.call_sid || prev.callSid
    }));
  }, [detailMeta, dispatchSelected]);

  useEffect(() => {
    if (!detailMeta?.call_sid) return;
    const match = dispatchItems.find((item) => item.call_sid === detailMeta.call_sid);
    if (match && dispatchSelected?.id !== match.id) {
      setDispatchSelected(match);
    }
  }, [dispatchItems, detailMeta?.call_sid, dispatchSelected?.id]);

  const saveDispatch = async () => {
    if (!dispatchSelected?.id) return;
    setDispatchStatus('Saving...');
    const resp = await fetch('/api/v1/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: dispatchSelected.id,
        status: dispatchSelected.status,
        assignedTo: dispatchSelected.assigned_to || null,
        dueAt: dispatchSelected.due_at || null
      })
    });
    if (!resp.ok) {
      setDispatchStatus('Save failed.');
      return;
    }
    setDispatchStatus('Saved.');
    loadDispatch();
  };

  const createDispatch = async () => {
    if (!newDispatch.callerName.trim() || !newDispatch.summary.trim()) {
      setDispatchStatus('Caller and summary are required.');
      return;
    }
    setDispatchStatus('Creating...');
    const resp = await fetch('/api/v1/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        callerName: newDispatch.callerName,
        summary: newDispatch.summary,
        dueAt: newDispatch.dueAt || null,
        assignedTo: newDispatch.assignedTo || null,
        status: newDispatch.status,
        callSid: newDispatch.callSid || null
      })
    });
    if (!resp.ok) {
      setDispatchStatus('Create failed.');
      return;
    }
    setDispatchStatus('Created.');
    setNewDispatch((prev) => ({ ...emptyDispatchDraft, callSid: prev.callSid }));
    loadDispatch();
  };

  const rows = useMemo(() => calls.map((call, idx) => ({
    id: call.call_sid || idx,
    sid: call.call_sid,
    from: call.from_number || '-',
    when: new Date(call.created_at).toLocaleString(),
    status: call.status,
    urgency: call.urgency || 'normal',
    createdAt: call.created_at
  })), [calls]);

  const filteredRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (urgencyFilter !== 'all' && row.urgency !== urgencyFilter) return false;
    if (search.trim()) {
      const hay = `${row.sid} ${row.from}`.toLowerCase();
      if (!hay.includes(search.trim().toLowerCase())) return false;
    }
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      if (new Date(row.createdAt).getTime() < fromTime) return false;
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime();
      if (new Date(row.createdAt).getTime() > toTime) return false;
    }
    return true;
  });

  const dispatchRows = useMemo(() => dispatchItems.map((item) => ({
    id: item.id,
    caller: item.caller_name || 'Caller',
    summary: item.summary || '',
    dueAt: item.due_at ? new Date(item.due_at).toLocaleString() : '-',
    assignedTo: item.assigned_to || '-',
    status: item.status,
    callSid: item.call_sid || '-'
  })), [dispatchItems]);

  const columns = [
    { field: 'sid', headerName: 'SID', flex: 1, minWidth: 160 },
    { field: 'from', headerName: 'From', flex: 1, minWidth: 160 },
    { field: 'when', headerName: 'When', flex: 1, minWidth: 180 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'error' ? 'bad' : 'ok'}`}>{params.value}</span>
      )
    }
  ];

  const dispatchColumns = [
    { field: 'caller', headerName: 'Caller', flex: 0.8, minWidth: 140 },
    { field: 'summary', headerName: 'Summary', flex: 1.4, minWidth: 220 },
    { field: 'dueAt', headerName: 'Due', flex: 0.8, minWidth: 160 },
    { field: 'assignedTo', headerName: 'Assigned', flex: 0.8, minWidth: 140 },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'closed' ? 'ok' : params.value === 'assigned' ? 'warn' : ''}`}>{params.value}</span>
      )
    },
    { field: 'callSid', headerName: 'Call SID', flex: 0.8, minWidth: 160 }
  ];

  const status = loadError
    ? { tone: 'bad', message: loadError }
    : loading
      ? { tone: 'warn', message: 'Loading calls...' }
      : { tone: 'ok', message: `${filteredRows.length} call(s) and ${dispatchItems.length} dispatch item(s) in view.` };

  return (
    <ClientPage
      title="Call Inbox"
      subtitle="Review calls and manage dispatch follow-ups in one place."
      status={status}
      primaryAction={{ label: 'Refresh Data', brand: true, onClick: loadAll }}
    >
      <div className="grid cols-3">
        <div className="card"><h2>New</h2><p><span>{dispatchCounts.new}</span> calls waiting assignment</p></div>
        <div className="card"><h2>Assigned</h2><p><span>{dispatchCounts.assigned}</span> calls in progress</p></div>
        <div className="card"><h2>Closed</h2><p><span>{dispatchCounts.closed}</span> completed today</p></div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Dispatch Queue</h2>
        <p className="muted">Click a dispatch item to jump to the call and update status.</p>
        <DataGrid
          rows={dispatchRows}
          columns={dispatchColumns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No dispatch items yet.' }}
          onRowClick={(params) => {
            const item = dispatchItems.find((i) => i.id === params.row.id);
            if (!item) return;
            setDispatchSelected(item);
            if (item.call_sid) loadDetail(item.call_sid);
          }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>

      <div className="toolbar" style={{ marginTop: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <label>Call Status</label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="error">Error</option>
        </select>
        <label>Urgency Level</label>
        <select value={urgencyFilter} onChange={(event) => setUrgencyFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
        </select>
        <label>Date From</label>
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <label>Date To</label>
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <label>Search Calls</label>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caller number or call SID" />
        <span className="muted">{loading ? 'Loading...' : `${filteredRows.length} calls`}</span>
      </div>
      <div className="split">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Call List</h2>
          <div style={{ height: rows.length ? 'auto' : 300 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              localeText={{ noRowsLabel: 'No calls yet.' }}
              onRowClick={(params) => {
                setDispatchSelected(null);
                loadDetail(params.row.sid);
              }}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
                '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
              }}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="card">
            <h2>Call Detail</h2>
            {!detailMeta ? (
              <div className="muted">{detailStatus}</div>
            ) : (
              <>
                <div className="muted" style={{ marginBottom: 8 }}>
                  {detailMeta.call_sid} · {new Date(detailMeta.created_at).toLocaleString()}
                </div>
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div className="muted">From</div>
                    <div>{detailMeta.from_number || '-'}</div>
                  </div>
                  <div>
                    <div className="muted">Status</div>
                    <div>{detailMeta.status || '-'}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>Transcript</div>
                  <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>
                    {detailTranscript || 'No transcript available yet.'}
                  </pre>
                </div>
              </>
            )}
          </div>
          <div className="card">
            <h2>Dispatch Detail</h2>
            {!detailMeta && !dispatchSelected ? (
              <p className="muted">Select a call or dispatch item to manage follow-up.</p>
            ) : dispatchSelected ? (
              <>
                <label>Caller</label>
                <input value={dispatchSelected.caller_name || ''} readOnly />
                <label style={{ marginTop: 10 }}>Summary</label>
                <textarea value={dispatchSelected.summary || ''} readOnly style={{ minHeight: 90 }} />
                <label style={{ marginTop: 10 }}>Status</label>
                <select
                  value={dispatchSelected.status}
                  onChange={(event) => setDispatchSelected({ ...dispatchSelected, status: event.target.value })}
                >
                  <option value="new">New</option>
                  <option value="assigned">Assigned</option>
                  <option value="closed">Closed</option>
                </select>
                <label style={{ marginTop: 10 }}>Assigned To</label>
                <select
                  value={dispatchSelected.assigned_to || ''}
                  onChange={(event) => setDispatchSelected({ ...dispatchSelected, assigned_to: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {dispatchUsers.map((user) => (
                    <option key={user.email} value={user.email}>{user.name} ({user.email})</option>
                  ))}
                </select>
                <label style={{ marginTop: 10 }}>Due Date</label>
                <input
                  type="datetime-local"
                  value={dispatchSelected.due_at ? new Date(dispatchSelected.due_at).toISOString().slice(0, 16) : ''}
                  onChange={(event) => setDispatchSelected({ ...dispatchSelected, due_at: event.target.value })}
                />
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn brand" onClick={saveDispatch}>Save Changes</button>
                  <span className="muted">{dispatchStatus}</span>
                </div>
              </>
            ) : (
              <>
                <p className="muted">Create a dispatch item for the selected call.</p>
                <label>Caller</label>
                <input
                  value={newDispatch.callerName}
                  onChange={(event) => setNewDispatch({ ...newDispatch, callerName: event.target.value })}
                  placeholder="Caller name"
                />
                <label style={{ marginTop: 10 }}>Summary</label>
                <textarea
                  value={newDispatch.summary}
                  onChange={(event) => setNewDispatch({ ...newDispatch, summary: event.target.value })}
                  style={{ minHeight: 90 }}
                  placeholder="Issue summary"
                />
                <label style={{ marginTop: 10 }}>Status</label>
                <select
                  value={newDispatch.status}
                  onChange={(event) => setNewDispatch({ ...newDispatch, status: event.target.value })}
                >
                  <option value="new">New</option>
                  <option value="assigned">Assigned</option>
                </select>
                <label style={{ marginTop: 10 }}>Assigned To</label>
                <select
                  value={newDispatch.assignedTo}
                  onChange={(event) => setNewDispatch({ ...newDispatch, assignedTo: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {dispatchUsers.map((user) => (
                    <option key={user.email} value={user.email}>{user.name} ({user.email})</option>
                  ))}
                </select>
                <label style={{ marginTop: 10 }}>Due Date</label>
                <input
                  type="datetime-local"
                  value={newDispatch.dueAt}
                  onChange={(event) => setNewDispatch({ ...newDispatch, dueAt: event.target.value })}
                />
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn brand" onClick={createDispatch}>Add Dispatch Item</button>
                  <span className="muted">{dispatchStatus}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ClientPage>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function DispatchPage() {
  const [counts, setCounts] = useState({ new: 0, assigned: 0, closed: 0 });
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('Ready.');

  const loadDispatch = () => {
    let mounted = true;
    fetch(`/api/v1/dispatch`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setCounts(data.counts || counts);
        setItems(data.items || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  };

  useEffect(() => {
    const cleanup = loadDispatch();
    return cleanup;
  }, []);

  const rows = useMemo(() => items.map((item) => ({
    id: item.id,
    caller: item.caller_name || 'Caller',
    summary: item.summary || '',
    dueAt: item.due_at ? new Date(item.due_at).toLocaleString() : '-',
    assignedTo: item.assigned_to || '-',
    status: item.status
  })), [items]);

  const columns = [
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
    }
  ];

  const saveItem = async () => {
    if (!selected?.id) return;
    setStatus('Saving...');
    const resp = await fetch('/api/v1/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: selected.id,
        status: selected.status,
        assignedTo: selected.assigned_to || null,
        dueAt: selected.due_at || null
      })
    });
    if (!resp.ok) {
      setStatus('Save failed.');
      return;
    }
    setStatus('Saved.');
    loadDispatch();
  };

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Dispatch Board</h1>
        <div className="top-actions">
          <button className="btn" onClick={loadDispatch}>Refresh</button>
        </div>
      </div>
      <div className="grid cols-3">
        <div className="card"><h2>New</h2><p><span>{counts.new}</span> calls waiting assignment</p></div>
        <div className="card"><h2>Assigned</h2><p><span>{counts.assigned}</span> calls in progress</p></div>
        <div className="card"><h2>Closed</h2><p><span>{counts.closed}</span> completed today</p></div>
      </div>
      <div className="split" style={{ marginTop: 12 }}>
        <div className="card">
          <DataGrid
            rows={rows}
            columns={columns}
            autoHeight
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
            localeText={{ noRowsLabel: 'No dispatch items yet.' }}
            onRowClick={(params) => {
              const item = items.find((i) => i.id === params.row.id);
              if (item) setSelected(item);
            }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
              '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
              '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
            }}
          />
        </div>
        <div className="card">
          <h2>Update Dispatch</h2>
          {!selected ? (
            <p className="muted">Select a dispatch item to update status, assignment, and due date.</p>
          ) : (
            <>
              <label>Caller</label>
              <input value={selected.caller_name || ''} readOnly />
              <label style={{ marginTop: 10 }}>Summary</label>
              <textarea value={selected.summary || ''} readOnly style={{ minHeight: 90 }} />
              <label style={{ marginTop: 10 }}>Status</label>
              <select
                value={selected.status}
                onChange={(event) => setSelected({ ...selected, status: event.target.value })}
              >
                <option value="new">New</option>
                <option value="assigned">Assigned</option>
                <option value="closed">Closed</option>
              </select>
              <label style={{ marginTop: 10 }}>Assigned To</label>
              <input
                value={selected.assigned_to || ''}
                onChange={(event) => setSelected({ ...selected, assigned_to: event.target.value })}
                placeholder="Dispatcher name"
              />
              <label style={{ marginTop: 10 }}>Due Date</label>
              <input
                type="datetime-local"
                value={selected.due_at ? new Date(selected.due_at).toISOString().slice(0, 16) : ''}
                onChange={(event) => setSelected({ ...selected, due_at: event.target.value })}
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn brand" onClick={saveItem}>Save Changes</button>
                <span className="muted">{status}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

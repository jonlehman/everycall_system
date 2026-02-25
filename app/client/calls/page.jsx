'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function CallsPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [calls, setCalls] = useState([]);
  const [detail, setDetail] = useState('Select a call to inspect transcript, extracted fields, and routing result.');

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/calls?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setCalls(data.calls || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [tenantKey]);

  const loadDetail = async (callSid) => {
    const resp = await fetch(`/api/v1/calls?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setDetail(JSON.stringify(data.call || {}, null, 2));
  };

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Call Inbox</h1>
        <div className="top-actions"><button className="btn">Refresh</button></div>
      </div>
      <div className="split">
        <div className="card">
          <table className="table" id="callsTable">
            <thead><tr><th>SID</th><th>From</th><th>When</th><th>Status</th></tr></thead>
            <tbody>
              {calls.length === 0 ? (
                <tr><td colSpan="4" className="muted">No calls yet.</td></tr>
              ) : calls.map((call) => (
                <tr key={call.call_sid} onClick={() => loadDetail(call.call_sid)} style={{ cursor: 'pointer' }}>
                  <td>{call.call_sid}</td>
                  <td>{call.from_number || '-'}</td>
                  <td>{new Date(call.created_at).toLocaleString()}</td>
                  <td><span className={`badge ${call.status === 'error' ? 'bad' : 'ok'}`}>{call.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Call Detail</h2>
          <div className="code" id="callDetail">{detail}</div>
        </div>
      </div>
    </section>
  );
}

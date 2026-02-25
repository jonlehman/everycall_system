'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function OverviewPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [stats, setStats] = useState({ callsToday: 0, missed: 0, urgent: 0, callbacksDue: 0 });
  const [recentCalls, setRecentCalls] = useState([]);
  const [actionQueue, setActionQueue] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/overview?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setStats(data.stats || stats);
        setRecentCalls(data.recentCalls || []);
        setActionQueue(data.actionQueue || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [tenantKey]);

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Overview</h1>
        <div className="top-actions"></div>
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
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Caller</th><th>Status</th><th>Summary</th></tr></thead>
              <tbody>
                {recentCalls.length === 0 ? (
                  <tr><td colSpan="4" className="muted">No recent calls.</td></tr>
                ) : recentCalls.map((call) => (
                  <tr key={call.call_sid || call.created_at}>
                    <td>{new Date(call.created_at).toLocaleTimeString()}</td>
                    <td>{call.from_number || '-'}</td>
                    <td><span className={`badge ${call.urgency === 'high' ? 'warn' : call.status === 'error' ? 'bad' : 'ok'}`}>{call.urgency === 'high' ? 'Urgent' : call.status || 'Handled'}</span></td>
                    <td>{call.summary || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Action Queue</h2>
          <p className="muted">Calls requiring callback or dispatch confirmation.</p>
          <div className="kv">
            {actionQueue.length === 0 ? (
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
    </section>
  );
}

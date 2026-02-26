'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function TeamPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [users, setUsers] = useState([]);
  const gridRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setUsers(data.users || []);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [tenantKey]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.style.gridTemplateColumns = '7fr 3fr';
    }
  }, []);

  return (
    <section className="screen active">
      <div className="topbar"><h1>Team Users</h1><div className="top-actions"><button className="btn brand">Invite User</button></div></div>
      <div ref={gridRef} className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan="5" className="muted">No users yet.</td></tr>
              ) : users.map((user) => (
                <tr key={user.id || user.email}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td><span className={`badge ${user.status === 'active' ? 'ok' : 'warn'}`}>{user.status}</span></td>
                  <td><button className="btn">Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Help</h2>
          <p className="muted">Control who can access calls, update routing, and edit customer-facing settings. Keep admin access limited.</p>
        </div>
      </div>
    </section>
  );
}

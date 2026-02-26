'use client';

import { useEffect, useRef, useState } from 'react';
export default function SettingsPage() {
  const [tenant, setTenant] = useState({ name: '-', plan: '-', data_region: '-' });
  const [auditEnabled, setAuditEnabled] = useState('-');
  const gridRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/settings`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setTenant(data.tenant || tenant);
        setAuditEnabled(data.settings?.notes ? 'Enabled' : 'Disabled');
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.style.gridTemplateColumns = '7fr 3fr';
    }
  }, []);

  return (
    <section className="screen active">
      <div className="topbar"><h1>Account Settings</h1></div>
      <div ref={gridRef} className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div className="card">
          <div className="kv">
            <div>Tenant</div><div>{tenant.name || '-'}</div>
            <div>Plan</div><div>{tenant.plan || '-'}</div>
            <div>Data Region</div><div>{tenant.data_region || '-'}</div>
            <div>Audit Logs</div><div>{auditEnabled}</div>
          </div>
        </div>
        <div className="card">
          <h2>Help</h2>
          <ul className="muted" style={{ paddingLeft: 18, marginTop: 8 }}>
            <li>Review your plan, tenant name, and data region here.</li>
            <li>Audit logging status reflects current compliance settings.</li>
            <li>Contact support to change region or enterprise settings.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

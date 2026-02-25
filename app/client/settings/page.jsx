'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [tenant, setTenant] = useState({ name: '-', plan: '-', data_region: '-' });
  const [auditEnabled, setAuditEnabled] = useState('-');

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/settings?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setTenant(data.tenant || tenant);
        setAuditEnabled(data.settings?.notes ? 'Enabled' : 'Disabled');
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [tenantKey]);

  return (
    <section className="screen active">
      <div className="topbar"><h1>Account Settings</h1></div>
      <div className="grid cols-2" style={{ gridTemplateColumns: '3fr 1fr' }}>
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
          <p className="muted">View plan and compliance details here. Contact support to change data region or audit policies.</p>
        </div>
      </div>
    </section>
  );
}

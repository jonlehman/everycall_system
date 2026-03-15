'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '../../../../components/ui/button';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export default function TenantManagePage() {
  const params = useParams();
  const router = useRouter();
  const tenantKey = String(params.tenantKey || '');
  const [tenant, setTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [builds, setBuilds] = useState([]);
  const [activeBuild, setActiveBuild] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [status, setStatus] = useState('Loading tenant...');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [deprovisionBusy, setDeprovisionBusy] = useState(false);

  const loadTenant = async () => {
    setStatus('Loading tenant...');
    try {
      const [tenantData, usersData, buildData, readinessData] = await Promise.all([
        fetchJson(`/api/v1/tenants?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/knowledge/builds?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/knowledge/readiness?tenantKey=${encodeURIComponent(tenantKey)}`)
      ]);
      setTenant(tenantData?.tenant || null);
      setUsers(Array.isArray(usersData?.users) ? usersData.users : []);
      setBuilds(Array.isArray(buildData?.builds) ? buildData.builds : []);
      setActiveBuild(buildData?.activeBuild || null);
      setReadiness(readinessData?.readiness || null);
      setStatus('Tenant loaded.');
    } catch {
      setStatus('Failed to load tenant.');
    }
  };

  useEffect(() => {
    if (tenantKey) loadTenant();
  }, [tenantKey]);

  const deleteTenant = async () => {
    const confirmed = window.confirm(`Delete tenant "${tenant?.name || tenantKey}" and all associated data?`);
    if (!confirmed) return;
    setDeleteBusy(true);
    setStatus('Deleting tenant...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!data?.ok) {
        setStatus(data?.message || data?.error || 'Delete failed.');
        return;
      }
      setStatus('Tenant deleted.');
      router.push('/admin/tenants');
    } catch {
      setStatus('Delete failed.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const provisionVoiceNumber = async () => {
    setProvisionBusy(true);
    setStatus('Provisioning voice number...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/phone-number/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setStatus(data?.ok ? `Provisioned ${data.phoneNumber}.` : (data?.message || data?.error || 'Provisioning failed.'));
      await loadTenant();
    } catch {
      setStatus('Provisioning failed.');
    } finally {
      setProvisionBusy(false);
    }
  };

  const deprovisionVoiceNumber = async () => {
    if (!tenant?.telnyx_voice_number) return;
    const confirmed = window.confirm(`Delete voice number ${tenant.telnyx_voice_number}?`);
    if (!confirmed) return;
    setDeprovisionBusy(true);
    setStatus('Deprovisioning voice number...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/phone-number/deprovision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setStatus(data?.ok ? 'Voice number deprovisioned.' : (data?.message || data?.error || 'Deprovision failed.'));
      await loadTenant();
    } catch {
      setStatus('Deprovision failed.');
    } finally {
      setDeprovisionBusy(false);
    }
  };

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{tenant?.name || tenantKey}</h1>
          <div className="text-sm text-slate-500">{tenantKey}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/admin/tenants">Back</Link>
          <Button variant="outline" onClick={loadTenant}>Reload</Button>
          <Button variant="outline" onClick={provisionVoiceNumber} disabled={provisionBusy}>
            {provisionBusy ? 'Provisioning...' : 'Provision Voice Number'}
          </Button>
          <Button variant="outline" onClick={deprovisionVoiceNumber} disabled={deprovisionBusy || !tenant?.telnyx_voice_number}>
            {deprovisionBusy ? 'Deprovisioning...' : 'Deprovision Voice Number'}
          </Button>
          <Button onClick={deleteTenant} disabled={deleteBusy}>{deleteBusy ? 'Deleting...' : 'Delete Tenant'}</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm text-sm text-slate-600">{status}</div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Tenant Snapshot</h2>
          <div className="grid grid-cols-[180px_1fr] gap-2 text-sm">
            <div>Status</div><div>{tenant?.status || '-'}</div>
            <div>Plan</div><div>{tenant?.plan || '-'}</div>
            <div>Region</div><div>{tenant?.data_region || '-'}</div>
            <div>Primary Number</div><div>{tenant?.primary_number || '-'}</div>
            <div>Voice Number</div><div>{tenant?.telnyx_voice_number || '-'}</div>
            <div>Industry</div><div>{tenant?.industry || '-'}</div>
            <div>Users</div><div>{users.length}</div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Readiness</h2>
          <div className={`badge ${(readiness?.blockers || []).length ? 'warn' : 'ok'}`}>{readiness?.status || 'not_started'}</div>
          <div className="mt-2 text-sm text-slate-600">Active build: {activeBuild?.active_build_id || 'none'}</div>
          {(readiness?.blockers || []).length ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
              {(readiness?.blockers || []).map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          ) : (
            <div className="mt-3 text-sm text-emerald-700">This tenant is ready on the new subsystem.</div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">Knowledge Builds</h2>
        <div className="grid gap-2">
          {builds.length ? builds.map((build) => (
            <div key={build.build_id} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{build.version || build.build_id}</div>
                  <div className="text-xs text-slate-500">{build.build_id}</div>
                </div>
                <span className={`badge ${build.status === 'published' ? 'ok' : 'warn'}`}>{build.status}</span>
              </div>
              <div className="mt-2">Cards: {build.artifact_counts_json?.cards || 0} · Facts: {build.artifact_counts_json?.facts || 0}</div>
            </div>
          )) : (
            <div className="text-sm text-slate-500">No builds yet.</div>
          )}
        </div>
      </section>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '../../../../components/ui/button';

const FIELD_SECTIONS = [
  {
    id: 'core',
    title: 'Core Tenant',
    description: 'Primary identity, region, and business-level account fields.',
    fields: [
      { key: 'name', label: 'Tenant name', type: 'text', required: true, hint: 'Display name shown across admin and client views.' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended'], hint: 'High-level tenant lifecycle state.' },
      { key: 'data_region', label: 'Data region', type: 'select', options: ['US', 'EU'], hint: 'Primary region used for tenant data handling.' },
      { key: 'plan', label: 'Plan', type: 'text', hint: 'Commercial plan label shown in admin.' },
      { key: 'plan_code', label: 'Plan code', type: 'text', hint: 'Internal billing/plan identifier if one exists.' },
      { key: 'primary_number', label: 'Primary number', type: 'text', hint: 'Customer-facing main number for the tenant.' },
      { key: 'industry', label: 'Business Category', type: 'text', hint: 'Broad business category used for knowledge-pack defaults.' }
    ]
  },
  {
    id: 'voice',
    title: 'Voice Provisioning',
    description: 'Voice-number provisioning and carrier metadata currently stored on the tenant record.',
    fields: [
      { key: 'telnyx_voice_number', label: 'Voice number', type: 'text', hint: 'Assigned inbound voice number.' },
      { key: 'telnyx_voice_number_id', label: 'Voice number ID', type: 'text', hint: 'Provider-side phone number identifier.' },
      { key: 'telnyx_voice_order_id', label: 'Voice order ID', type: 'text', hint: 'Provider-side purchase/order record.' },
      { key: 'telnyx_voice_status', label: 'Voice status', type: 'text', hint: 'Provisioning state reported or tracked for voice service.' },
      { key: 'telnyx_voice_monthly_cost_cents', label: 'Monthly cost (cents)', type: 'number', hint: 'Stored recurring cost for the assigned number.' },
      { key: 'telnyx_voice_upfront_cost_cents', label: 'Upfront cost (cents)', type: 'number', hint: 'Stored one-time acquisition cost.' },
      { key: 'telnyx_voice_purchased_at', label: 'Voice purchased at', type: 'datetime', hint: 'Timestamp when the number was purchased or recorded as purchased.' }
    ]
  },
  {
    id: 'forwarding',
    title: 'Forwarding',
    description: 'Forwarding readiness and lifecycle timestamps.',
    fields: [
      { key: 'forwarding_setup_status', label: 'Forwarding setup status', type: 'select', options: ['not_started', 'acknowledged', 'configured'], hint: 'Operational state for forwarding setup.' },
      { key: 'forwarding_acknowledged_at', label: 'Forwarding acknowledged at', type: 'datetime', hint: 'When forwarding setup was acknowledged.' },
      { key: 'forwarding_configured_at', label: 'Forwarding configured at', type: 'datetime', hint: 'When forwarding was actually configured.' }
    ]
  },
  {
    id: 'billing',
    title: 'Billing And Access',
    description: 'Commercial status, access gates, and lockout-related fields.',
    fields: [
      { key: 'billing_status', label: 'Billing status', type: 'select', options: ['trialing', 'active', 'past_due', 'canceled'], hint: 'Commercial status used by billing lifecycle flows.' },
      { key: 'service_access_status', label: 'Service access status', type: 'select', options: ['enabled', 'disabled'], hint: 'Whether backend service access is currently enabled.' },
      { key: 'app_access_status', label: 'App access status', type: 'select', options: ['enabled', 'disabled'], hint: 'Whether tenant users can access the application.' },
      { key: 'billing_lock_reason', label: 'Billing lock reason', type: 'textarea', hint: 'Optional human-readable reason for a billing lock or manual restriction.' }
    ]
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle Dates',
    description: 'Stored timestamps related to trial, grace, billing, and deactivation.',
    fields: [
      { key: 'trial_started_at', label: 'Trial started at', type: 'datetime', hint: 'Beginning of the trial period.' },
      { key: 'trial_end', label: 'Trial end', type: 'datetime', hint: 'Current trial expiration timestamp.' },
      { key: 'post_trial_access_ends_at', label: 'Post-trial access ends at', type: 'datetime', hint: 'Access cutoff after trial ends.' },
      { key: 'billing_grace_ends_at', label: 'Billing grace ends at', type: 'datetime', hint: 'End of temporary billing grace period.' },
      { key: 'billing_status_updated_at', label: 'Billing status updated at', type: 'datetime', hint: 'Last time billing status was changed.' },
      { key: 'deactivated_at', label: 'Deactivated at', type: 'datetime', hint: 'Timestamp for tenant deactivation, if applicable.' }
    ]
  }
];

const EDITABLE_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDateTimeDisplay(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function buildDraftFromTenant(tenant) {
  const draft = {};
  for (const field of EDITABLE_FIELDS) {
    const value = tenant?.[field.key];
    if (field.type === 'datetime') {
      draft[field.key] = formatDateTimeLocal(value);
    } else if (field.type === 'number') {
      draft[field.key] = value === null || value === undefined ? '' : String(value);
    } else {
      draft[field.key] = value === null || value === undefined ? '' : String(value);
    }
  }
  return draft;
}

function buildPayloadFromDraft(tenantKey, draft) {
  const payload = { tenantKey };
  for (const field of EDITABLE_FIELDS) {
    const value = draft?.[field.key] ?? '';
    if (field.type === 'datetime') {
      payload[field.key] = value ? new Date(value).toISOString() : null;
    } else if (field.type === 'number') {
      payload[field.key] = value === '' ? null : Number(value);
    } else {
      payload[field.key] = value;
    }
  }
  return payload;
}

function countChangedFields(draft, saved) {
  return EDITABLE_FIELDS.reduce((count, field) => {
    return count + ((draft?.[field.key] ?? '') === (saved?.[field.key] ?? '') ? 0 : 1);
  }, 0);
}

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-900">{label}</span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      {children}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()}
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className={`min-h-[92px] rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()}
    />
  );
}

function SelectInput({ value, options, ...props }) {
  const normalizedValue = value || '';
  const optionList = Array.from(new Set([normalizedValue, ...(options || [])].filter(Boolean)));
  return (
    <select
      {...props}
      value={normalizedValue}
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()}
    >
      {!optionList.length ? <option value="">Select…</option> : null}
      {optionList.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

function SnapshotRow({ label, value }) {
  return (
    <>
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{value || '-'}</div>
    </>
  );
}

function UserCard({ user }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="font-medium text-slate-900">{user.name || user.email}</div>
      <div className="text-slate-500">{user.email}</div>
      <div className="mt-1 text-xs text-slate-500">
        {user.role || 'user'} · {user.status || 'active'}{user.phone_number ? ` · ${user.phone_number}` : ''}
      </div>
    </div>
  );
}

export default function TenantManagePage() {
  const params = useParams();
  const router = useRouter();
  const tenantKey = String(params.tenantKey || '');
  const [tenant, setTenant] = useState(null);
  const [draft, setDraft] = useState(null);
  const [users, setUsers] = useState([]);
  const [builds, setBuilds] = useState([]);
  const [activeBuild, setActiveBuild] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [status, setStatus] = useState('Loading tenant...');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [deprovisionBusy, setDeprovisionBusy] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const savedDraft = useMemo(() => (tenant ? buildDraftFromTenant(tenant) : null), [tenant]);
  const changedCount = useMemo(() => countChangedFields(draft, savedDraft), [draft, savedDraft]);
  const hasUnsavedChanges = changedCount > 0;
  const primaryUser = useMemo(() => {
    if (!users.length) return null;
    return users.find((user) => user.role === 'owner') || users[0];
  }, [users]);

  const loadTenant = async () => {
    if (!tenantKey) return;
    setLoading(true);
    setStatus('Loading tenant...');
    try {
      const [tenantData, usersData, buildData, readinessData] = await Promise.all([
        fetchJson(`/api/v1/tenants?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/knowledge/builds?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/knowledge/readiness?tenantKey=${encodeURIComponent(tenantKey)}`)
      ]);
      const nextTenant = tenantData?.tenant || null;
      setTenant(nextTenant);
      setDraft(nextTenant ? buildDraftFromTenant(nextTenant) : null);
      setUsers(Array.isArray(usersData?.users) ? usersData.users : []);
      setBuilds(Array.isArray(buildData?.builds) ? buildData.builds : []);
      setActiveBuild(buildData?.activeBuild || null);
      setReadiness(readinessData?.readiness || null);
      setStatus(nextTenant ? 'Tenant loaded.' : 'Tenant not found.');
    } catch (error) {
      setStatus(error?.message || 'Failed to load tenant.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTenant();
  }, [tenantKey]);

  const updateField = (key, value) => {
    setDraft((current) => ({ ...(current || {}), [key]: value }));
  };

  const resetToSaved = () => {
    if (!tenant) return;
    setDraft(buildDraftFromTenant(tenant));
    setStatus('Reverted unsaved changes.');
  };

  const saveTenant = async () => {
    if (!draft) return;
    setSaving(true);
    setStatus('Saving tenant...');
    try {
      const data = await fetchJson('/api/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayloadFromDraft(tenantKey, draft))
      });
      const nextTenant = data?.tenant || null;
      setTenant(nextTenant);
      setDraft(nextTenant ? buildDraftFromTenant(nextTenant) : null);
      setStatus(data?.changedFields?.length ? `Saved ${data.changedFields.length} tenant field(s).` : 'No tenant changes to save.');
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

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
    } catch (error) {
      setStatus(error?.message || 'Delete failed.');
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
    } catch (error) {
      setStatus(error?.message || 'Provisioning failed.');
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
    } catch (error) {
      setStatus(error?.message || 'Deprovision failed.');
    } finally {
      setDeprovisionBusy(false);
    }
  };

  const setPrimaryUserPassword = async () => {
    if (!primaryUser) {
      setStatus('No tenant user exists for this tenant.');
      return;
    }
    if (!passwordDraft || passwordDraft.length < 8) {
      setStatus('Password must be at least 8 characters.');
      return;
    }
    if (passwordDraft !== passwordConfirm) {
      setStatus('Passwords do not match.');
      return;
    }

    setPasswordBusy(true);
    setStatus('Updating primary user password...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/primary-user-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordDraft })
      });
      setPasswordDraft('');
      setPasswordConfirm('');
      setStatus(`Updated password for ${data?.user?.email || primaryUser.email}.`);
    } catch (error) {
      setStatus(error?.message || 'Password update failed.');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{tenant?.name || tenantKey}</h1>
          <div className="text-sm text-slate-500">Manage tenant record, billing lifecycle fields, provisioning metadata, and readiness context.</div>
          <div className="mt-1 text-xs text-slate-500">Tenant key: <code>{tenantKey}</code></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/admin/tenants">Back</Link>
          <Button variant="outline" onClick={loadTenant} disabled={loading || saving}>Reload</Button>
          <Button variant="outline" onClick={resetToSaved} disabled={!hasUnsavedChanges || saving}>Reset To Saved</Button>
          <Button onClick={saveTenant} disabled={saving || !draft || !hasUnsavedChanges}>
            {saving ? 'Saving...' : 'Save Tenant'}
          </Button>
          <Button variant="outline" onClick={provisionVoiceNumber} disabled={provisionBusy}>
            {provisionBusy ? 'Provisioning...' : 'Provision Voice Number'}
          </Button>
          <Button variant="outline" onClick={deprovisionVoiceNumber} disabled={deprovisionBusy || !tenant?.telnyx_voice_number}>
            {deprovisionBusy ? 'Deprovisioning...' : 'Deprovision Voice Number'}
          </Button>
          <Button variant="destructive" onClick={deleteTenant} disabled={deleteBusy}>
            {deleteBusy ? 'Deleting...' : 'Delete Tenant'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="text-sm text-slate-700">{status}</div>
        <div className="mt-1 text-xs text-slate-500">
          {hasUnsavedChanges ? `${changedCount} unsaved field${changedCount === 1 ? '' : 's'}.` : 'No unsaved changes.'}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="grid gap-4">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-lg font-semibold">Editable Tenant Fields</h2>
                <div className="text-sm text-slate-500">
                  This form saves directly to the admin tenant record. It covers the tenant-owned fields currently stored on the <code>tenants</code> table.
                </div>
              </div>
              <Button onClick={saveTenant} disabled={saving || !draft || !hasUnsavedChanges}>
                {saving ? 'Saving...' : 'Save Tenant'}
              </Button>
            </div>

            <div className="mt-4 grid gap-4">
              {FIELD_SECTIONS.map((section) => (
                <section key={section.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3">
                    <h3 className="m-0 text-base font-semibold text-slate-900">{section.title}</h3>
                    <div className="text-sm text-slate-500">{section.description}</div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {section.fields.map((field) => (
                      <Field key={field.key} label={field.label} hint={field.hint}>
                        {field.type === 'textarea' ? (
                          <TextArea
                            value={draft?.[field.key] || ''}
                            onChange={(event) => updateField(field.key, event.target.value)}
                            placeholder={field.placeholder || ''}
                          />
                        ) : field.type === 'select' ? (
                          <SelectInput
                            value={draft?.[field.key] || ''}
                            options={field.options}
                            onChange={(event) => updateField(field.key, event.target.value)}
                          />
                        ) : (
                          <TextInput
                            type={field.type === 'datetime' ? 'datetime-local' : field.type}
                            value={draft?.[field.key] || ''}
                            onChange={(event) => updateField(field.key, event.target.value)}
                            placeholder={field.placeholder || ''}
                            required={field.required}
                            step={field.type === 'number' ? '1' : undefined}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={resetToSaved} disabled={!hasUnsavedChanges || saving}>Reset To Saved</Button>
              <Button onClick={saveTenant} disabled={saving || !draft || !hasUnsavedChanges}>
                {saving ? 'Saving...' : 'Save Tenant'}
              </Button>
            </div>
          </section>
        </div>

        <div className="grid gap-4">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Tenant Snapshot</h2>
            <div className="mt-3 grid grid-cols-[140px_1fr] gap-2 text-sm">
              <SnapshotRow label="Tenant key" value={tenant?.tenant_key || tenantKey} />
              <SnapshotRow label="Created" value={formatDateTimeDisplay(tenant?.created_at)} />
              <SnapshotRow label="Updated" value={formatDateTimeDisplay(tenant?.updated_at)} />
              <SnapshotRow label="Users" value={String(users.length)} />
              <SnapshotRow label="Active build" value={activeBuild?.active_build_id || 'none'} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Readiness</h2>
            <div className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-medium ${(readiness?.blockers || []).length ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
              {readiness?.status || 'not_started'}
            </div>
            {(readiness?.blockers || []).length ? (
              <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
                {(readiness?.blockers || []).map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : (
              <div className="mt-3 text-sm text-emerald-700">This tenant is ready on the new subsystem.</div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Tenant Users</h2>
            <div className="mt-3 grid gap-2">
              {users.length ? users.map((user) => <UserCard key={user.id || user.email} user={user} />) : (
                <div className="text-sm text-slate-500">No tenant users found.</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Primary User Access</h2>
            <div className="mt-2 text-sm text-slate-500">
              Set a new password for the tenant’s main login account. This targets the owner user when present, otherwise the first tenant user.
            </div>
            {primaryUser ? (
              <div className="mt-3 grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="font-medium text-slate-900">{primaryUser.name || primaryUser.email}</div>
                  <div className="text-slate-500">{primaryUser.email}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {primaryUser.role || 'user'} · {primaryUser.status || 'active'}
                  </div>
                </div>
                <Field label="New Password" hint="Admin-only direct password set for the tenant’s main user account. Minimum 8 characters.">
                  <TextInput
                    type="password"
                    value={passwordDraft}
                    onChange={(event) => setPasswordDraft(event.target.value)}
                    placeholder="Enter a new password"
                  />
                </Field>
                <Field label="Confirm Password" hint="Re-enter the same password before saving.">
                  <TextInput
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder="Confirm the password"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={setPrimaryUserPassword} disabled={passwordBusy || !passwordDraft || !passwordConfirm}>
                    {passwordBusy ? 'Updating...' : 'Set Primary User Password'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPasswordDraft('');
                      setPasswordConfirm('');
                      setStatus('Cleared unsaved password input.');
                    }}
                    disabled={passwordBusy || (!passwordDraft && !passwordConfirm)}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">No tenant users found, so there is no primary login account to update.</div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Knowledge Builds</h2>
            <div className="mt-3 grid gap-2">
              {builds.length ? builds.map((build) => (
                <div key={build.build_id} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{build.version || build.build_id}</div>
                      <div className="text-xs text-slate-500">{build.build_id}</div>
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${build.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                      {build.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Cards: {build.artifact_counts_json?.cards || 0} · Facts: {build.artifact_counts_json?.facts || 0}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-slate-500">No builds yet.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

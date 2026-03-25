'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '../../../../components/ui/button';
import { formatPhoneDisplay } from '../../../../lib/phoneDisplay';

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
const PRIMARY_USER_FIELDS = ['name', 'email', 'phoneNumber'];

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

function buildPrimaryUserDraft(user) {
  return {
    name: user?.name || '',
    email: user?.email || '',
    phoneNumber: user?.phone_number || ''
  };
}

function countChangedFields(draft, saved, keys) {
  return keys.reduce((count, key) => {
    return count + ((draft?.[key] ?? '') === (saved?.[key] ?? '') ? 0 : 1);
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

function SummaryCard({ label, value, detail, tone = 'slate' }) {
  const toneClasses = {
    slate: 'border-slate-200 bg-slate-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    sky: 'border-sky-200 bg-sky-50',
    rose: 'border-rose-200 bg-rose-50'
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value || '-'}</div>
      {detail ? <div className="mt-1 text-sm text-slate-600">{detail}</div> : null}
    </div>
  );
}

function UserCard({ user }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="font-medium text-slate-900">{user.name || user.email}</div>
      <div className="text-slate-500">{user.email}</div>
      <div className="mt-1 text-xs text-slate-500">
        {user.role || 'user'} · {user.status || 'active'}{user.phone_number ? ` · ${formatPhoneDisplay(user.phone_number)}` : ''}
      </div>
    </div>
  );
}

function RuntimeStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value ?? '-'}</div>
    </div>
  );
}

function formatLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ensureSentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildRepresentativeAnswer(answerPacket) {
  const packet = answerPacket || {};
  const direct = Array.isArray(packet.direct_answer_points) ? packet.direct_answer_points.filter(Boolean) : [];
  const qualifiers = Array.isArray(packet.qualifiers) ? packet.qualifiers.filter(Boolean) : [];
  const limits = Array.isArray(packet.limits_or_exclusions) ? packet.limits_or_exclusions.filter(Boolean) : [];
  const nextSteps = Array.isArray(packet.next_step_options) ? packet.next_step_options.filter(Boolean) : [];
  const unsupported = Array.isArray(packet.unsupported_requested_items) ? packet.unsupported_requested_items.filter(Boolean) : [];
  const shouldLeadWithNextStep = !direct.length || unsupported.length > 0 || String(packet.runtime_mode || '').trim() !== 'answer';

  const parts = [];
  if (direct.length) {
    parts.push(direct.slice(0, 2).map(ensureSentence).join(' '));
  }
  if (qualifiers.length) {
    parts.push(`Key qualifiers: ${qualifiers.slice(0, 2).join('; ')}.`);
  }
  if (limits.length) {
    parts.push(`Limits or exclusions: ${limits.slice(0, 2).join('; ')}.`);
  }
  if (unsupported.length) {
    parts.push(`Confirmed details are not available for: ${unsupported.slice(0, 2).join('; ')}.`);
  }
  if (nextSteps.length && shouldLeadWithNextStep) {
    parts.push(`Likely next step: ${ensureSentence(nextSteps[0])}`);
  }
  return parts.join(' ').trim() || 'No representative answer is available for this preview yet.';
}

function PreviewList({ title, items, emptyText = 'None.' }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {values.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {values.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-slate-500">{emptyText}</div>
      )}
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
  const [primaryUserDraft, setPrimaryUserDraft] = useState(buildPrimaryUserDraft(null));
  const [primaryUserSaving, setPrimaryUserSaving] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewQuery, setPreviewQuery] = useState('');
  const [preview, setPreview] = useState(null);

  const primaryUser = useMemo(() => {
    if (!users.length) return null;
    return users.find((user) => user.role === 'owner') || users[0];
  }, [users]);

  const savedDraft = useMemo(() => (tenant ? buildDraftFromTenant(tenant) : null), [tenant]);
  const changedCount = useMemo(
    () => countChangedFields(draft, savedDraft, EDITABLE_FIELDS.map((field) => field.key)),
    [draft, savedDraft]
  );
  const hasUnsavedChanges = changedCount > 0;

  const savedPrimaryUserDraft = useMemo(
    () => buildPrimaryUserDraft(primaryUser),
    [primaryUser?.id, primaryUser?.name, primaryUser?.email, primaryUser?.phone_number]
  );
  const primaryUserChangedCount = useMemo(
    () => countChangedFields(primaryUserDraft, savedPrimaryUserDraft, PRIMARY_USER_FIELDS),
    [primaryUserDraft, savedPrimaryUserDraft]
  );
  const hasPrimaryUserChanges = primaryUserChangedCount > 0;

  useEffect(() => {
    setPrimaryUserDraft(buildPrimaryUserDraft(primaryUser));
  }, [primaryUser?.id, primaryUser?.name, primaryUser?.email, primaryUser?.phone_number]);

  useEffect(() => {
    setPreview(null);
    setPreviewQuery('');
  }, [tenantKey]);

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

  const updatePrimaryUserField = (key, value) => {
    setPrimaryUserDraft((current) => ({ ...current, [key]: value }));
  };

  const resetToSaved = () => {
    if (!tenant) return;
    setDraft(buildDraftFromTenant(tenant));
    setStatus('Reverted unsaved tenant field changes.');
  };

  const resetPrimaryUserDraft = () => {
    setPrimaryUserDraft(buildPrimaryUserDraft(primaryUser));
    setStatus('Reverted unsaved owner changes.');
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

  const savePrimaryUserProfile = async () => {
    if (!primaryUser) {
      setStatus('No tenant user exists for this tenant.');
      return;
    }
    if (!primaryUserDraft.name.trim() || !primaryUserDraft.email.trim()) {
      setStatus('Primary user name and email are required.');
      return;
    }

    setPrimaryUserSaving(true);
    setStatus('Saving primary user profile...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/primary-user-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(primaryUserDraft)
      });
      const updatedUser = data?.user || null;
      if (updatedUser) {
        setUsers((current) => current.map((user) => (
          user.id === updatedUser.id
            ? { ...user, ...updatedUser }
            : user
        )));
        setPrimaryUserDraft(buildPrimaryUserDraft(updatedUser));
      }
      setStatus('Primary user profile updated.');
    } catch (error) {
      setStatus(error?.message || 'Primary user update failed.');
    } finally {
      setPrimaryUserSaving(false);
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
      setStatus(data?.ok ? `Provisioned ${formatPhoneDisplay(data.phoneNumber)}.` : (data?.message || data?.error || 'Provisioning failed.'));
      await loadTenant();
    } catch (error) {
      setStatus(error?.message || 'Provisioning failed.');
    } finally {
      setProvisionBusy(false);
    }
  };

  const deprovisionVoiceNumber = async () => {
    if (!tenant?.telnyx_voice_number) return;
    const confirmed = window.confirm(`Delete voice number ${formatPhoneDisplay(tenant.telnyx_voice_number)}?`);
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

  const runRuntimePreview = async () => {
    if (!previewQuery.trim()) {
      setStatus('Enter a caller-style question first.');
      return;
    }
    setPreviewBusy(true);
    setPreview(null);
    setStatus('Running admin runtime preview...');
    try {
      const data = await fetchJson(`/api/v1/knowledge/runtime-preview?tenantKey=${encodeURIComponent(tenantKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: previewQuery.trim() })
      });
      setPreview(data);
      setStatus('Admin runtime preview ready.');
    } catch (error) {
      setStatus(error?.message || 'Runtime preview failed.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const unsavedNotes = [];
  if (hasPrimaryUserChanges) {
    unsavedNotes.push(`${primaryUserChangedCount} primary user change${primaryUserChangedCount === 1 ? '' : 's'}`);
  }
  if (hasUnsavedChanges) {
    unsavedNotes.push(`${changedCount} advanced tenant field${changedCount === 1 ? '' : 's'}`);
  }

  const primaryUserLabel = primaryUser?.role === 'owner' ? 'Owner' : 'Primary User';
  const readinessHasBlockers = Boolean((readiness?.blockers || []).length);
  const previewPlanner = preview?.planner || null;
  const previewAnswerPacket = preview?.answerPacket || null;
  const previewRuntimeBundle = preview?.runtimeBundle || null;
  const representativeAnswer = buildRepresentativeAnswer(previewAnswerPacket);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{tenant?.name || tenantKey}</h1>
          <div className="text-sm text-slate-500">Manage the owner contact, voice setup, readiness, and lower-level tenant record fields.</div>
          <div className="mt-1 text-xs text-slate-500">Tenant key: <code>{tenantKey}</code></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/admin/tenants">Back</Link>
          <Button variant="outline" onClick={loadTenant} disabled={loading || saving || primaryUserSaving}>Reload</Button>
          <Button variant="destructive" onClick={deleteTenant} disabled={deleteBusy}>
            {deleteBusy ? 'Deleting...' : 'Delete Tenant'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="text-sm text-slate-700">{status}</div>
        <div className="mt-1 text-xs text-slate-500">
          {unsavedNotes.length ? `Unsaved: ${unsavedNotes.join(' · ')}.` : 'No unsaved changes.'}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Account"
          value={`${tenant?.status || 'unknown'} / ${tenant?.billing_status || 'unknown'}`}
          detail={`Plan ${tenant?.plan || '-'} · App ${tenant?.app_access_status || '-'}`}
          tone={tenant?.status === 'active' ? 'emerald' : 'amber'}
        />
        <SummaryCard
          label={primaryUserLabel}
          value={primaryUser?.name || primaryUser?.email || 'No tenant user'}
          detail={primaryUser?.email ? `${primaryUser.email}${primaryUser?.phone_number ? ` · ${formatPhoneDisplay(primaryUser.phone_number)}` : ''}` : 'No contact configured'}
          tone="sky"
        />
        <SummaryCard
          label="Voice Number"
          value={tenant?.telnyx_voice_number ? formatPhoneDisplay(tenant.telnyx_voice_number) : 'Unassigned'}
          detail={`${tenant?.telnyx_voice_status || 'not provisioned'} · Primary ${formatPhoneDisplay(tenant?.primary_number) || '-'}`}
          tone={tenant?.telnyx_voice_number ? 'emerald' : 'amber'}
        />
        <SummaryCard
          label="Knowledge"
          value={readiness?.status || 'not_started'}
          detail={`Active build ${activeBuild?.active_build_id || 'none'} · ${builds.length} build${builds.length === 1 ? '' : 's'}`}
          tone={readinessHasBlockers ? 'amber' : 'emerald'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,1fr)]">
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-lg font-semibold">{primaryUserLabel} And Access</h2>
              <div className="text-sm text-slate-500">Update the main tenant contact first. Password reset stays separate from profile edits.</div>
            </div>
            {primaryUser ? (
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {primaryUser.role || 'user'} · {primaryUser.status || 'active'}
              </div>
            ) : null}
          </div>

          {primaryUser ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
              <div className="grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="font-medium text-slate-900">{primaryUser.name || primaryUser.email}</div>
                  <div className="text-slate-500">{primaryUser.email}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {primaryUser.phone_number ? formatPhoneDisplay(primaryUser.phone_number) : 'No mobile phone on file'}
                  </div>
                </div>

                <Field label="Name" hint="Displayed as the tenant owner or main contact in admin reporting and the client workspace.">
                  <TextInput
                    value={primaryUserDraft.name}
                    onChange={(event) => updatePrimaryUserField('name', event.target.value)}
                    placeholder="Owner name"
                  />
                </Field>

                <Field label="Email" hint="Primary login email for the main tenant user account. Must remain unique across tenant users.">
                  <TextInput
                    type="email"
                    value={primaryUserDraft.email}
                    onChange={(event) => updatePrimaryUserField('email', event.target.value)}
                    placeholder="owner@company.com"
                  />
                </Field>

                <Field label="Mobile Phone" hint="Used for SMS opt-in and lead notifications. Changing it resets SMS opt-in status.">
                  <TextInput
                    value={primaryUserDraft.phoneNumber}
                    onChange={(event) => updatePrimaryUserField('phoneNumber', event.target.value)}
                    placeholder="+1XXXXXXXXXX"
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={savePrimaryUserProfile} disabled={primaryUserSaving || !hasPrimaryUserChanges}>
                    {primaryUserSaving ? 'Saving...' : `Save ${primaryUserLabel}`}
                  </Button>
                  <Button variant="outline" onClick={resetPrimaryUserDraft} disabled={primaryUserSaving || !hasPrimaryUserChanges}>
                    Reset
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="m-0 text-base font-semibold text-slate-900">Reset {primaryUserLabel} Password</h3>
                  <div className="mt-1 text-sm text-slate-500">
                    This targets the same primary tenant login account shown on the left.
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
                    {passwordBusy ? 'Updating...' : 'Set Password'}
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
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-500">No tenant users found, so there is no owner or primary login account to edit.</div>
          )}
        </section>

        <div className="grid gap-4">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Voice Number</h2>
            <div className="mt-3 grid grid-cols-[140px_1fr] gap-2 text-sm">
              <div className="text-slate-500">Assigned number</div>
              <div className="font-medium text-slate-900">{formatPhoneDisplay(tenant?.telnyx_voice_number) || 'None'}</div>
              <div className="text-slate-500">Primary number</div>
              <div className="font-medium text-slate-900">{formatPhoneDisplay(tenant?.primary_number) || '-'}</div>
              <div className="text-slate-500">Status</div>
              <div className="font-medium text-slate-900">{tenant?.telnyx_voice_status || '-'}</div>
              <div className="text-slate-500">Purchased</div>
              <div className="font-medium text-slate-900">{formatDateTimeDisplay(tenant?.telnyx_voice_purchased_at)}</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={provisionVoiceNumber} disabled={provisionBusy}>
                {provisionBusy ? 'Provisioning...' : 'Provision Voice Number'}
              </Button>
              <Button variant="outline" onClick={deprovisionVoiceNumber} disabled={deprovisionBusy || !tenant?.telnyx_voice_number}>
                {deprovisionBusy ? 'Deprovisioning...' : 'Deprovision Voice Number'}
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Readiness And Builds</h2>
            <div className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-medium ${readinessHasBlockers ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
              {readiness?.status || 'not_started'}
            </div>
            {readinessHasBlockers ? (
              <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
                {(readiness?.blockers || []).map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : (
              <div className="mt-3 text-sm text-emerald-700">This tenant is ready on the new subsystem.</div>
            )}
            <div className="mt-4 grid gap-2">
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

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Runtime Preview</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Admin-only test of the likely answer from this tenant’s current published build.
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              This is only an estimate. It does not include the full context of a real call already in progress.
            </div>
            <Field label="Representative Query" hint="Ask a caller-style question to inspect the likely answer and runtime details.">
              <TextInput
                value={previewQuery}
                onChange={(event) => setPreviewQuery(event.target.value)}
                placeholder="Do you handle after-hours emergencies?"
              />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={runRuntimePreview} disabled={previewBusy || !previewQuery.trim()}>
                {previewBusy ? 'Running...' : 'Run Preview'}
              </Button>
            </div>
            {preview ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-900">Representative Answer</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">{representativeAnswer}</div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <RuntimeStat label="Runtime Mode" value={formatLabel(previewRuntimeBundle?.runtime_mode || '-')} />
                  <RuntimeStat label="Selected Cards" value={previewRuntimeBundle?.selected_cards?.length || 0} />
                  <RuntimeStat label="Used Facts" value={previewRuntimeBundle?.selected_answer_facts?.length || 0} />
                  <RuntimeStat label="Confidence" value={previewRuntimeBundle?.confidence_score ?? '-'} />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <PreviewList
                    title="Direct Answer Points"
                    items={previewAnswerPacket?.direct_answer_points}
                    emptyText="No direct answer points were assembled."
                  />
                  <PreviewList
                    title="Qualifiers"
                    items={previewAnswerPacket?.qualifiers}
                  />
                  <PreviewList
                    title="Limits or Exclusions"
                    items={previewAnswerPacket?.limits_or_exclusions}
                  />
                  <PreviewList
                    title="Next Step Options"
                    items={previewAnswerPacket?.next_step_options}
                  />
                </div>

                <details className="rounded-lg border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Advanced Details</summary>
                  <div className="mt-3 grid gap-3">
                    <PreviewList
                      title="Planner Coverage Items"
                      items={previewPlanner?.coverage_items}
                      emptyText="No planner coverage items returned."
                    />
                    <PreviewList
                      title="Planner Next-Step Suggestions"
                      items={previewPlanner?.next_step_suggestions}
                      emptyText="No planner next-step suggestions returned."
                    />

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">Coverage Support</div>
                      {Array.isArray(previewAnswerPacket?.coverage) && previewAnswerPacket.coverage.length ? (
                        <div className="mt-2 grid gap-2">
                          {previewAnswerPacket.coverage.map((item) => (
                            <div key={item.requested_coverage_item_text} className="rounded-md border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium text-slate-900">{item.requested_coverage_item_text}</div>
                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                  item.support_strength === 'strong'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : item.support_strength === 'partial'
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-rose-100 text-rose-800'
                                }`}>
                                  {formatLabel(item.support_strength)}
                                </span>
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                Cards: {(item.used_card_ids || []).length} · Facts: {(item.used_fact_ids || []).length}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">No coverage items were returned.</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">Structured Answer Packet</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {JSON.stringify(previewAnswerPacket, null, 2)}
                      </pre>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">Runtime Bundle</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {JSON.stringify(previewRuntimeBundle, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold">Tenant Team</h2>
            <div className="text-sm text-slate-500">Read-only view of all tenant users. The main contact above is the first owner user when present.</div>
          </div>
          <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {users.length} user{users.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {users.length ? users.map((user) => <UserCard key={user.id || user.email} user={user} />) : (
            <div className="text-sm text-slate-500">No tenant users found.</div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-lg font-semibold">Advanced Tenant Record</h2>
            <div className="text-sm text-slate-500">
              Lower-level fields for billing, provisioning, lifecycle, and other tenant metadata stored directly on the <code>tenants</code> table.
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Created {formatDateTimeDisplay(tenant?.created_at)} · Updated {formatDateTimeDisplay(tenant?.updated_at)}
            </div>
          </div>
          <Button onClick={saveTenant} disabled={saving || !draft || !hasUnsavedChanges}>
            {saving ? 'Saving...' : 'Save Advanced Fields'}
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
            {saving ? 'Saving...' : 'Save Advanced Fields'}
          </Button>
        </div>
      </section>
    </section>
  );
}

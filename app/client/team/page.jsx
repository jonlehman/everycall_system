'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';
import GuidePanel from '../_components/GuidePanel';
import SectionPage from '../_components/SectionPage';
import { sendLeadsNavItems } from '../_components/navigation';
import {
  CALL_CATEGORY_OPTIONS,
  formatCallCategoryLabel,
  getDefaultCallCategorySelection,
  sanitizeCallCategorySelection
} from '../../../lib/callCategories';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

function createEmptyForm() {
  return {
    name: '',
    email: '',
    phoneNumber: '',
    role: 'viewer',
    status: 'active',
    leadAlertEmailEnabled: false,
    leadAlertSmsEnabled: false,
    leadAlertEmailCategories: getDefaultCallCategorySelection(),
    leadAlertSmsCategories: getDefaultCallCategorySelection(),
    smsConsentConfirmed: false,
    smsOptInStatus: 'not_requested'
  };
}

function summarizeCategories(categories) {
  const count = Array.isArray(categories) ? categories.length : 0;
  if (!count) return 'No categories';
  if (count === CALL_CATEGORY_OPTIONS.length) return 'All categories';
  if (count === 1) return '1 category';
  return `${count} categories`;
}

function SummaryCard({ label, value, helper }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-2 font-['Space_Grotesk'] text-3xl font-bold tracking-[-0.04em] text-slate-950">{value}</div>
      <div className="mt-2 text-xs leading-5 text-slate-500">{helper}</div>
    </div>
  );
}

export default function TeamPage() {
  const [users, setUsers] = useState([]);
  const [formMode, setFormMode] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [formState, setFormState] = useState(createEmptyForm);
  const [loading, setLoading] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const [status, setStatus] = useState(null);
  const [showAccessSection, setShowAccessSection] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    fetch('/api/v1/tenant/users')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load recipients and access settings.', tone: 'bad' });
          setLoading(false);
          return;
        }
        setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load recipients and access settings.', tone: 'bad' });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const closeForm = () => {
    setFormMode(null);
    setEditingUserId(null);
    setFormState(createEmptyForm());
  };

  const openCreateForm = () => {
    setFormMode('create');
    setEditingUserId(null);
    setFormState(createEmptyForm());
  };

  const openEditForm = (row) => {
    setFormMode('edit');
    setEditingUserId(row.id);
    setFormState({
      name: row.name || '',
      email: row.email || '',
      phoneNumber: row.phone || '',
      role: row.role || 'member',
      status: row.status || 'active',
      leadAlertEmailEnabled: Boolean(row.leadAlertEmailEnabled),
      leadAlertSmsEnabled: Boolean(row.leadAlertSmsEnabled),
      leadAlertEmailCategories: sanitizeCallCategorySelection(row.leadAlertEmailCategories, { fallbackToAll: Boolean(row.leadAlertEmailEnabled) }),
      leadAlertSmsCategories: sanitizeCallCategorySelection(row.leadAlertSmsCategories, { fallbackToAll: Boolean(row.leadAlertSmsEnabled) }),
      smsConsentConfirmed: false,
      smsOptInStatus: row.smsOptIn || 'not_requested'
    });
  };

  const updateFormField = (field, value) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const updateChannelEnabled = (enabledField, categoriesField, checked) => {
    setFormState((current) => ({
      ...current,
      [enabledField]: checked,
      [categoriesField]: checked && !current[categoriesField]?.length
        ? getDefaultCallCategorySelection()
        : current[categoriesField]
    }));
  };

  const toggleCategory = (field, category) => {
    setFormState((current) => {
      const existing = Array.isArray(current[field]) ? current[field] : [];
      const next = existing.includes(category)
        ? existing.filter((value) => value !== category)
        : [...existing, category];
      return {
        ...current,
        [field]: sanitizeCallCategorySelection(next)
      };
    });
  };

  const selectAllCategories = (field) => {
    setFormState((current) => ({
      ...current,
      [field]: getDefaultCallCategorySelection()
    }));
  };

  const resendInvite = async (id) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resend', id })
    });
    setStatus(resp.ok ? { message: 'Invite resent.', tone: 'ok' } : { message: 'Invite resend failed.', tone: 'bad' });
  };

  const requestSmsOptIn = async (id) => {
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sms_opt_in_request', id, consentConfirmed: true })
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok) {
      setStatus({ message: body?.message || 'SMS opt-in request failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: body?.message || 'SMS opt-in request sent.', tone: 'ok' });
    setFormState((current) => ({ ...current, smsOptInStatus: 'pending' }));
    loadUsers();
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    const resp = await fetch(`/api/v1/tenant/users?id=${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      setStatus({ message: 'Delete failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'Entry deleted.', tone: 'ok' });
    if (editingUserId === id) closeForm();
    loadUsers();
  };

  const saveUser = async (event) => {
    event.preventDefault();
    if (!formState.name.trim() || !formState.email.trim()) {
      setStatus({ message: 'Name and email are required.', tone: 'bad' });
      return;
    }

    const payload = {
      name: formState.name.trim(),
      email: formState.email.trim(),
      phoneNumber: formState.phoneNumber.trim(),
      role: formState.role,
      status: formState.status,
      leadAlertEmailEnabled: Boolean(formState.leadAlertEmailEnabled),
      leadAlertSmsEnabled: Boolean(formState.leadAlertSmsEnabled),
      leadAlertEmailCategories: sanitizeCallCategorySelection(formState.leadAlertEmailCategories),
      leadAlertSmsCategories: sanitizeCallCategorySelection(formState.leadAlertSmsCategories)
    };

    if (payload.leadAlertEmailEnabled && !payload.leadAlertEmailCategories.length) {
      setStatus({ message: 'Choose at least one email alert category or turn email alerts off.', tone: 'bad' });
      return;
    }
    if (payload.leadAlertSmsEnabled && !payload.leadAlertSmsCategories.length) {
      setStatus({ message: 'Choose at least one SMS alert category or turn SMS alerts off.', tone: 'bad' });
      return;
    }

    setSavingForm(true);
    setStatus({ message: formMode === 'edit' ? 'Saving changes...' : 'Creating recipient...', tone: 'warn' });
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        formMode === 'edit'
          ? { action: 'update_user', id: editingUserId, ...payload }
          : payload
      )
    });
    setSavingForm(false);

    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      setStatus({ message: body?.message || (formMode === 'edit' ? 'Save failed.' : 'Create failed.'), tone: 'bad' });
      return;
    }

    setStatus({ message: formMode === 'edit' ? 'Entry updated.' : 'Recipient created.', tone: 'ok' });
    closeForm();
    loadUsers();
  };

  const rows = useMemo(() => users.map((user, idx) => ({
    id: user.id || idx,
    name: user.name,
    email: user.email,
    phone: user.phone_number || '',
    role: user.role,
    status: user.status,
    smsOptIn: user.sms_opt_in_status || 'not_requested',
    leadAlertSmsEnabled: Boolean(user.lead_alert_sms_enabled),
    leadAlertEmailEnabled: Boolean(user.lead_alert_email_enabled),
    leadAlertSmsCategories: sanitizeCallCategorySelection(user.lead_alert_sms_categories, { fallbackToAll: Boolean(user.lead_alert_sms_enabled) }),
    leadAlertEmailCategories: sanitizeCallCategorySelection(user.lead_alert_email_categories, { fallbackToAll: Boolean(user.lead_alert_email_enabled) })
  })), [users]);

  const emailDestinationCount = rows.filter((row) => row.leadAlertEmailEnabled && row.email).length;
  const smsDestinationCount = rows.filter((row) => row.leadAlertSmsEnabled && row.phone).length;
  const smsConfirmedCount = rows.filter((row) => row.leadAlertSmsEnabled && row.phone && row.smsOptIn === 'opted_in').length;
  const smsPendingCount = rows.filter((row) => row.leadAlertSmsEnabled && row.phone && row.smsOptIn !== 'opted_in').length;
  const activeAccessCount = rows.filter((row) => row.status === 'active').length;

  const fieldLabelClass = 'mb-1.5 ml-1 block text-[10px] font-bold normal-case tracking-normal text-slate-500';
  const fieldControlClass = 'w-full rounded-xl border border-slate-200/70 bg-[#eff4ff] px-3 py-3 text-sm font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition focus:border-sky-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-100';
  const smsStatusClass = formState.smsOptInStatus === 'opted_in'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : formState.smsOptInStatus === 'pending'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-100 text-slate-600';

  const renderCategorySelector = (title, enabled, enabledField, categoriesField) => (
    <div className={`rounded-2xl border px-4 py-4 ${enabled ? 'border-slate-200 bg-slate-50/80' : 'border-slate-200/70 bg-slate-50/40 opacity-80'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-start gap-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => updateChannelEnabled(enabledField, categoriesField, event.target.checked)}
          />
          <span className="normal-case font-medium tracking-normal text-slate-700">
            {title}
          </span>
        </label>
        {enabled ? (
          <button
            className="text-xs font-semibold normal-case tracking-normal text-sky-700"
            onClick={() => selectAllCategories(categoriesField)}
            type="button"
          >
            Select All
          </button>
        ) : null}
      </div>
      <div className="mt-3 ml-6 text-xs text-slate-500">
        {enabled ? 'Choose which call categories trigger this alert channel.' : 'Turn this on to choose which call categories trigger this channel.'}
      </div>
      {enabled ? (
        <div className="mt-4 ml-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CALL_CATEGORY_OPTIONS.map((category) => {
            const selected = formState[categoriesField].includes(category);
            return (
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition ${
                  selected
                    ? 'border-sky-200 bg-white text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]'
                    : 'border-slate-200 bg-white/70 text-slate-600'
                }`}
                key={category}
              >
                <input
                  checked={selected}
                  onChange={() => toggleCategory(categoriesField, category)}
                  type="checkbox"
                />
                <span className="font-medium">{formatCallCategoryLabel(category)}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  const recipientColumns = [
    { field: 'name', headerName: 'Name', flex: 0.9, minWidth: 110 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 160 },
    {
      field: 'phone',
      headerName: 'Phone',
      flex: 0.85,
      minWidth: 115,
      renderCell: (params) => formatPhoneDisplay(params.value) || ''
    },
    {
      field: 'leadAlertEmailEnabled',
      headerName: 'Email Alerts',
      flex: 0.72,
      minWidth: 92,
      renderCell: (params) => (
        <div className="flex flex-col py-1">
          <span className={`badge ${params.value ? 'ok' : 'bad'}`}>
            {params.value ? 'enabled' : 'off'}
          </span>
          {params.value ? (
            <span className="mt-1 text-[11px] text-slate-500">
              {summarizeCategories(params.row.leadAlertEmailCategories)}
            </span>
          ) : null}
        </div>
      )
    },
    {
      field: 'leadAlertSmsEnabled',
      headerName: 'SMS Alerts',
      flex: 0.72,
      minWidth: 92,
      renderCell: (params) => (
        <div className="flex flex-col py-1">
          <span
            className={`badge ${
              !params.row.leadAlertSmsEnabled
                ? 'bad'
                : params.row.smsOptIn === 'opted_in'
                  ? 'ok'
                  : 'warn'
            }`}
          >
            {!params.row.leadAlertSmsEnabled
              ? 'off'
              : params.row.smsOptIn === 'opted_in'
                ? 'enabled'
                : 'pending'}
          </span>
          {params.row.leadAlertSmsEnabled ? (
            <span className="mt-1 text-[11px] text-slate-500">
              {summarizeCategories(params.row.leadAlertSmsCategories)}
            </span>
          ) : null}
        </div>
      )
    },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      flex: 0.9,
      minWidth: 132,
      renderCell: (params) => (
        <div className="flex w-full justify-end gap-1.5">
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => openEditForm(params.row)}
          >
            Edit
          </button>
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => deleteUser(params.row.id)}
          >
            Delete
          </button>
        </div>
      )
    }
  ];

  const accessColumns = [
    { field: 'name', headerName: 'Name', flex: 0.9, minWidth: 120 },
    { field: 'email', headerName: 'Email', flex: 1.1, minWidth: 160 },
    {
      field: 'role',
      headerName: 'Role',
      flex: 0.7,
      minWidth: 90,
      renderCell: (params) => (
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">
          {String(params.value || '').trim() || '-'}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.7,
      minWidth: 92,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'active' ? 'ok' : params.value === 'invited' ? 'warn' : 'bad'}`}>
          {params.value}
        </span>
      )
    },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      flex: 1,
      minWidth: 170,
      renderCell: (params) => (
        <div className="flex w-full justify-end gap-1.5">
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => openEditForm(params.row)}
          >
            Edit
          </button>
          {params.row.status === 'invited' ? (
            <button
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              onClick={() => resendInvite(params.row.id)}
            >
              Resend
            </button>
          ) : null}
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => deleteUser(params.row.id)}
          >
            Delete
          </button>
        </div>
      )
    }
  ];

  return (
    <SectionPage
      tabs={sendLeadsNavItems}
      title="Send Leads To"
      subtitle="Choose which people and inboxes receive EveryCall alerts. Advanced workspace access controls still live here too."
      status={status}
      primaryAction={{
        label: formMode === 'create' ? 'Close Form' : 'Add Recipient',
        brand: true,
        onClick: () => (formMode === 'create' ? closeForm() : openCreateForm())
      }}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 gap-3">
          <section className="grid gap-3 md:grid-cols-3">
            <SummaryCard
              label="Email recipients"
              value={emailDestinationCount}
              helper="Active email destinations for new lead alerts."
            />
            <SummaryCard
              label="SMS recipients"
              value={smsDestinationCount}
              helper={smsPendingCount ? `${smsConfirmedCount} confirmed, ${smsPendingCount} pending confirmation.` : 'Mobile destinations for text alerts.'}
            />
            <SummaryCard
              label="Active access"
              value={activeAccessCount}
              helper="People with active workspace records. Access controls live below."
            />
          </section>

          {formMode ? (
            <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(18,28,42,0.04)]">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-8 py-6">
                <div className="space-y-1">
                  <h2 className="mt-0 font-['Space_Grotesk'] text-lg font-bold text-slate-900">
                    {formMode === 'edit' ? 'Edit Recipient' : 'Add Recipient'}
                  </h2>
                  <div className="text-sm text-slate-500">
                    Update alert destinations here. Access settings are still available below when you need them.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-blue-700">
                    Active Workspace
                  </span>
                  <Button variant="outline" type="button" onClick={closeForm} disabled={savingForm}>
                    Close
                  </Button>
                </div>
              </div>

              <form className="space-y-8 p-8" onSubmit={saveUser}>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className={fieldLabelClass}>Name</label>
                    <input
                      className={fieldControlClass}
                      type="text"
                      value={formState.name}
                      onChange={(event) => updateFormField('name', event.target.value)}
                      placeholder="Jane Smith"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClass}>Email</label>
                    <input
                      className={fieldControlClass}
                      type="email"
                      value={formState.email}
                      onChange={(event) => updateFormField('email', event.target.value)}
                      placeholder="jane@company.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClass}>Mobile Phone</label>
                    <input
                      className={fieldControlClass}
                      type="tel"
                      value={formState.phoneNumber}
                      onChange={(event) => updateFormField('phoneNumber', event.target.value)}
                      placeholder="+1XXXXXXXXXX"
                    />
                    <div className="ml-1 text-xs text-slate-500">
                      Changing the phone number resets SMS opt-in for this recipient.
                    </div>
                  </div>

                </div>

                <div className="space-y-4 border-t border-slate-100 pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <span className="material-symbols-outlined text-lg text-blue-700">notifications_active</span>
                    Notification Preferences
                  </h3>
                  <div className="flex flex-col gap-3">
                    {renderCategorySelector(
                      'Receive email alerts',
                      formState.leadAlertEmailEnabled,
                      'leadAlertEmailEnabled',
                      'leadAlertEmailCategories'
                    )}
                    {renderCategorySelector(
                      'Receive SMS alerts',
                      formState.leadAlertSmsEnabled,
                      'leadAlertSmsEnabled',
                      'leadAlertSmsCategories'
                    )}
                  </div>
                </div>

                <details className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-5 py-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
                    Team &amp; Access Settings
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="text-xs leading-6 text-slate-600">
                      Most basic setups can ignore this. Use these fields only when this person also needs workspace access or a non-default access level.
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className={fieldLabelClass}>Role</label>
                        <select
                          className={fieldControlClass}
                          value={formState.role}
                          onChange={(event) => updateFormField('role', event.target.value)}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="owner">Owner</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className={fieldLabelClass}>Status</label>
                        <select
                          className={fieldControlClass}
                          value={formState.status}
                          onChange={(event) => updateFormField('status', event.target.value)}
                        >
                          <option value="active">Active</option>
                          <option value="invited">Invited</option>
                          <option value="suspended">Suspended</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </details>

                <div className="space-y-4 rounded-xl border-l-4 border-blue-200 bg-[#eff4ff] p-6">
                  <div className="flex items-start gap-4">
                    <span className="material-symbols-outlined mt-0.5 text-blue-700">verified_user</span>
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-sm font-bold text-slate-900">SMS Opt-In Compliance Workflow</h3>
                        <span className={`rounded-md border px-2 py-1 text-[10px] font-bold normal-case tracking-normal ${smsStatusClass}`}>
                          {formState.smsOptInStatus.replaceAll('_', ' ')}
                        </span>
                      </div>

                      <div className="text-xs leading-6 text-slate-600">
                        To keep lead texting compliant, the subscriber must explicitly consent before EveryCall sends SMS alerts.
                        After you save these settings, you can send the opt-in request from this workspace.
                      </div>

                      <div className="text-xs leading-6 text-slate-600">
                        If <span className="font-semibold text-slate-700">Receive lead SMS alerts</span> is checked before the subscriber replies YES,
                        the lead SMS status will stay pending and no text alerts will be sent yet.
                      </div>

                      <div className="text-xs leading-6 text-slate-600">
                        By providing a phone number and sending an SMS opt-in request, the subscriber agrees to receive SMS
                        new lead alerts from EveryCall by Creative Dynamic. Message frequency may vary. Message and data
                        rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.
                        Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes.
                      </div>

                      <div className="text-xs text-slate-600">
                        <a className="text-sky-700 underline" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
                        {' '}|{' '}
                        <a className="text-sky-700 underline" href="/terms" target="_blank" rel="noreferrer">SMS Terms</a>
                      </div>

                      <label className="flex items-start gap-3 text-xs text-slate-700">
                        <input
                          className="mt-0.5"
                          type="checkbox"
                          checked={formState.smsConsentConfirmed}
                          onChange={(event) => updateFormField('smsConsentConfirmed', event.target.checked)}
                        />
                        <span className="normal-case font-medium tracking-normal italic text-slate-700">
                          I confirm this subscriber has reviewed and agreed to the SMS disclosure above.
                        </span>
                      </label>

                      {formMode === 'edit' ? (
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => requestSmsOptIn(editingUserId)}
                            disabled={!formState.phoneNumber.trim() || formState.smsOptInStatus === 'opted_in' || !formState.smsConsentConfirmed}
                          >
                            {formState.smsOptInStatus === 'opted_in' ? 'SMS Already Enabled' : 'Send SMS Opt-In Request'}
                          </Button>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">
                          Save this recipient first, then reopen the form to send the SMS opt-in request.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-100 pt-6">
                  <Button variant="outline" type="button" onClick={closeForm} disabled={savingForm}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingForm}>
                    {savingForm ? (formMode === 'edit' ? 'Saving...' : 'Creating...') : (formMode === 'edit' ? 'Save Changes' : 'Create Recipient')}
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          <div className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="mb-3">
              <h2 className="mt-0 text-lg font-semibold">Lead Destinations</h2>
              <p className="mt-1 text-sm text-slate-500">
                These are the people and inboxes that receive new lead alerts. Roles and invitation status are hidden below in Team &amp; Access.
              </p>
            </div>
            <div style={{ height: rows.length ? 'auto' : 300 }}>
              <DataGrid
                rows={rows}
                columns={recipientColumns}
                autoHeight
                getRowHeight={() => 'auto'}
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                localeText={{ noRowsLabel: loading ? 'Loading recipients...' : 'No recipients or access records yet.' }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': {
                    alignItems: 'center',
                    lineHeight: '1.35',
                    whiteSpace: 'normal',
                    py: 1
                  },
                  '& .MuiDataGrid-cellContent': {
                    whiteSpace: 'normal',
                    overflow: 'visible',
                    textOverflow: 'clip',
                    lineHeight: '1.35'
                  },
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                  '& .MuiDataGrid-columnHeaderTitle': {
                    fontWeight: 600,
                    whiteSpace: 'normal',
                    lineHeight: '1.2'
                  },
                  '& .MuiDataGrid-virtualScroller': { overflowX: 'hidden' }
                }}
              />
            </div>
          </div>

          <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              onClick={() => setShowAccessSection((current) => !current)}
            >
              <div>
                <h2 className="m-0 text-lg font-semibold text-slate-900">Team &amp; Access</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Use this only when you need to manage workspace roles, invitation state, or access status.
                </p>
              </div>
              <span className="material-symbols-outlined text-slate-500">
                {showAccessSection ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {showAccessSection ? (
              <div className="border-t border-slate-200/70 px-3 pb-3 pt-3">
                <div style={{ height: rows.length ? 'auto' : 260 }}>
                  <DataGrid
                    rows={rows}
                    columns={accessColumns}
                    autoHeight
                    getRowHeight={() => 'auto'}
                    disableRowSelectionOnClick
                    pageSizeOptions={[10, 25, 50]}
                    initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                    localeText={{ noRowsLabel: loading ? 'Loading access records...' : 'No access records yet.' }}
                    sx={{
                      border: 'none',
                      '& .MuiDataGrid-cell': {
                        alignItems: 'center',
                        lineHeight: '1.35',
                        whiteSpace: 'normal',
                        py: 1
                      },
                      '& .MuiDataGrid-cellContent': {
                        whiteSpace: 'normal',
                        overflow: 'visible',
                        textOverflow: 'clip',
                        lineHeight: '1.35'
                      },
                      '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                      '& .MuiDataGrid-columnHeaderTitle': {
                        fontWeight: 600,
                        whiteSpace: 'normal',
                        lineHeight: '1.2'
                      },
                      '& .MuiDataGrid-virtualScroller': { overflowX: 'hidden' }
                    }}
                  />
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <GuidePanel title="Send Leads To Guide" eyebrow="How it works" icon="groups">
          <div>Use this page first for lead recipients. Team roles and access settings are still available, but they are intentionally pushed out of the main setup path.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Lead SMS requirements</div>
            <div className="mt-1 text-sm text-slate-600">SMS alerts can be turned on in advance, but they stay pending and will not send until the user replies YES.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Basic setup path</div>
            <div className="mt-1 text-sm text-slate-600">For a simple account, focus on email destinations, SMS destinations, and confirmation status. Ignore Team &amp; Access unless someone needs workspace access.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

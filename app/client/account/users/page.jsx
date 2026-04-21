'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';
import {
  CALL_CATEGORY_OPTIONS,
  formatCallCategoryLabel,
  getDefaultCallCategorySelection,
  sanitizeCallCategorySelection
} from '../../../../lib/callCategories';
import { formatPhoneDisplay } from '../../../../lib/phoneDisplay';

const ACTIVE_USER_LIMIT = 10;

function createEmptyForm() {
  return {
    name: '',
    email: '',
    phoneNumber: '',
    transferEnabled: false,
    transferExtension: '',
    forwardToNumber: '',
    role: 'member',
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

function formatRoleLabel(role) {
  if (role === 'member') return 'Standard User';
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'viewer') return 'Viewer';
  return String(role || '').trim() || '-';
}

function accessMeta(status) {
  if (status === 'active') {
    return {
      label: 'enabled',
      badgeClass: 'ok',
      helper: 'This person can use the workspace. Lead alerts can send if enabled.'
    };
  }
  if (status === 'invited') {
    return {
      label: 'invite pending',
      badgeClass: 'warn',
      helper: 'This person has not finished accepting access yet. Lead alerts stay paused until then.'
    };
  }
  if (status === 'suspended') {
    return {
      label: 'suspended',
      badgeClass: 'bad',
      helper: 'Workspace access is suspended. Lead alerts are paused.'
    };
  }
  return {
    label: 'disabled',
    badgeClass: 'bad',
    helper: 'Workspace access is disabled. Lead alerts are paused.'
  };
}

function statusSelectLabel(status) {
  if (status === 'active') return 'Enabled';
  if (status === 'invited') return 'Invite Pending';
  if (status === 'suspended') return 'Suspended';
  return 'Disabled';
}

export default function AccountUsersPage() {
  const [users, setUsers] = useState([]);
  const [formMode, setFormMode] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [formState, setFormState] = useState(createEmptyForm);
  const [loading, setLoading] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const [status, setStatus] = useState(null);

  const loadUsers = () => {
    setLoading(true);
    fetch('/api/v1/tenant/users')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load users.', tone: 'bad' });
          setLoading(false);
          return;
        }
        setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load users.', tone: 'bad' });
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
    setFormState({
      ...createEmptyForm(),
      status: activeUserLimitReached ? 'invited' : 'active'
    });
  };

  const openEditForm = (row) => {
    setFormMode('edit');
    setEditingUserId(row.id);
    setFormState({
      name: row.name || '',
      email: row.email || '',
      phoneNumber: row.phone || '',
      transferEnabled: Boolean(row.transferEnabled),
      transferExtension: row.transferExtension || '',
      forwardToNumber: row.forwardToNumber || '',
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
    loadUsers();
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
    if (!window.confirm('Delete this user?')) return;
    const resp = await fetch(`/api/v1/tenant/users?id=${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      setStatus({ message: 'Delete failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'User deleted.', tone: 'ok' });
    if (editingUserId === id) closeForm();
    loadUsers();
  };

  const setUserStatus = async (id, nextStatus) => {
    const targetUser = rows.find((row) => row.id === id);
    if (nextStatus === 'active' && targetUser?.status !== 'active' && activeUserLimitReached) {
      setStatus({ message: 'You can have up to 10 active people here. Disable one before enabling another.', tone: 'bad' });
      return;
    }
    const resp = await fetch('/api/v1/tenant/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', id, status: nextStatus })
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      setStatus({ message: body?.message || 'Could not update system access.', tone: 'bad' });
      return;
    }
    setStatus({
      message: nextStatus === 'active' ? 'System access enabled.' : 'System access disabled. Lead alerts are now paused for this user.',
      tone: 'ok'
    });
    if (editingUserId === id) {
      setFormState((current) => ({ ...current, status: nextStatus }));
    }
    loadUsers();
  };

  const saveUser = async (event) => {
    event.preventDefault();
    if (!formState.name.trim() || !formState.email.trim()) {
      setStatus({ message: 'Name and email are required.', tone: 'bad' });
      return;
    }

    const normalizedTransferExtension = formState.transferExtension.trim().replace(/\s+/g, '');
    if (normalizedTransferExtension && !/^\d{1,6}$/.test(normalizedTransferExtension)) {
      setStatus({ message: 'Extension must be 1 to 6 digits.', tone: 'bad' });
      return;
    }
    if (formState.transferEnabled && formState.status !== 'active') {
      setStatus({ message: 'Call transfer can only be enabled for active users.', tone: 'bad' });
      return;
    }
    if (formState.transferEnabled && !formState.forwardToNumber.trim()) {
      setStatus({ message: 'Enter a forward-to number before enabling call transfer.', tone: 'bad' });
      return;
    }

    const payload = {
      name: formState.name.trim(),
      email: formState.email.trim(),
      phoneNumber: formState.phoneNumber.trim(),
      transferEnabled: Boolean(formState.transferEnabled),
      transferExtension: normalizedTransferExtension,
      forwardToNumber: formState.forwardToNumber.trim(),
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

    const editingUser = formMode === 'edit'
      ? rows.find((row) => row.id === editingUserId)
      : null;
    const isActivatingExistingUser = payload.status === 'active' && editingUser?.status !== 'active';
    const isCreatingActiveUser = formMode !== 'edit' && payload.status === 'active';
    if ((isCreatingActiveUser || isActivatingExistingUser) && activeUserLimitReached) {
      setStatus({
        message: isCreatingActiveUser
          ? 'You can have up to 10 active people here. Choose Invite Pending or Disabled, or disable someone first.'
          : 'You can have up to 10 active people here. Disable one before enabling another.',
        tone: 'bad'
      });
      return;
    }

    setSavingForm(true);
    setStatus({ message: formMode === 'edit' ? 'Saving user...' : 'Creating user...', tone: 'warn' });
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

    setStatus({ message: formMode === 'edit' ? 'User updated.' : 'User created.', tone: 'ok' });
    closeForm();
    loadUsers();
  };

  const rows = useMemo(() => users.map((user, idx) => ({
    id: user.id || idx,
    name: user.name,
    email: user.email,
    phone: user.phone_number || '',
    transferEnabled: Boolean(user.transfer_enabled),
    transferExtension: user.transfer_extension || '',
    forwardToNumber: user.forward_to_number || '',
    role: user.role,
    status: user.status,
    smsOptIn: user.sms_opt_in_status || 'not_requested',
    leadAlertSmsEnabled: Boolean(user.lead_alert_sms_enabled),
    leadAlertEmailEnabled: Boolean(user.lead_alert_email_enabled),
    leadAlertSmsCategories: sanitizeCallCategorySelection(user.lead_alert_sms_categories, { fallbackToAll: Boolean(user.lead_alert_sms_enabled) }),
    leadAlertEmailCategories: sanitizeCallCategorySelection(user.lead_alert_email_categories, { fallbackToAll: Boolean(user.lead_alert_email_enabled) })
  })), [users]);
  const activeUserCount = useMemo(
    () => rows.filter((row) => row.status === 'active').length,
    [rows]
  );
  const activeUserLimitReached = activeUserCount >= ACTIVE_USER_LIMIT;
  const canSelectActiveStatus = !activeUserLimitReached || (formMode === 'edit' && formState.status === 'active');

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

  const userColumns = [
    { field: 'name', headerName: 'Name', flex: 0.85, minWidth: 110 },
    { field: 'email', headerName: 'Email', flex: 1.1, minWidth: 160 },
    {
      field: 'phone',
      headerName: 'Phone',
      flex: 0.75,
      minWidth: 115,
      renderCell: (params) => formatPhoneDisplay(params.value) || ''
    },
    {
      field: 'role',
      headerName: 'Role',
      flex: 0.8,
      minWidth: 120,
      renderCell: (params) => (
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">
          {formatRoleLabel(params.value)}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'System Access',
      flex: 0.95,
      minWidth: 135,
      renderCell: (params) => {
        const meta = accessMeta(params.value);
        return (
          <div className="flex flex-col py-1">
            <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
            <span className="mt-1 text-[11px] text-slate-500">{meta.helper}</span>
          </div>
        );
      }
    },
    {
      field: 'leadAlertEmailEnabled',
      headerName: 'Email Alerts',
      flex: 0.75,
      minWidth: 104,
      renderCell: (params) => (
        <div className="flex flex-col py-1">
          <span className={`badge ${params.value ? 'ok' : 'bad'}`}>
            {params.value ? 'on' : 'off'}
          </span>
          {params.value ? (
            <span className="mt-1 text-[11px] text-slate-500">{summarizeCategories(params.row.leadAlertEmailCategories)}</span>
          ) : null}
        </div>
      )
    },
    {
      field: 'leadAlertSmsEnabled',
      headerName: 'SMS Alerts',
      flex: 0.75,
      minWidth: 104,
      renderCell: (params) => (
        <div className="flex flex-col py-1">
          <span className={`badge ${
            !params.row.leadAlertSmsEnabled
              ? 'bad'
              : params.row.smsOptIn === 'opted_in'
                ? 'ok'
                : 'warn'
          }`}>
            {!params.row.leadAlertSmsEnabled
              ? 'off'
              : params.row.smsOptIn === 'opted_in'
                ? 'on'
                : 'pending'}
          </span>
          {params.row.leadAlertSmsEnabled ? (
            <span className="mt-1 text-[11px] text-slate-500">{summarizeCategories(params.row.leadAlertSmsCategories)}</span>
          ) : null}
        </div>
      )
    },
    {
      field: 'transferEnabled',
      headerName: 'Call Transfer',
      flex: 0.95,
      minWidth: 150,
      renderCell: (params) => {
        const details = [];
        if (params.row.transferExtension) {
          details.push(`Ext ${params.row.transferExtension}`);
        }
        if (params.row.forwardToNumber) {
          details.push(formatPhoneDisplay(params.row.forwardToNumber) || params.row.forwardToNumber);
        }
        return (
          <div className="flex flex-col py-1">
            <span className={`badge ${params.value ? 'ok' : 'bad'}`}>
              {params.value ? 'on' : 'off'}
            </span>
            <span className="mt-1 text-[11px] text-slate-500">
              {details.join(' • ') || 'No transfer destination'}
            </span>
          </div>
        );
      }
    },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      flex: 1.25,
      minWidth: 220,
      renderCell: (params) => (
        <div className="flex w-full justify-end gap-1.5">
          <button
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
            onClick={() => openEditForm(params.row)}
          >
            Edit
          </button>
          <button
            className={`inline-flex h-8 items-center rounded-md border border-input px-2 text-xs ${
              params.row.status !== 'active' && activeUserLimitReached
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : 'bg-background hover:bg-muted'
            }`}
            onClick={() => setUserStatus(params.row.id, params.row.status === 'active' ? 'disabled' : 'active')}
            disabled={params.row.status !== 'active' && activeUserLimitReached}
          >
            {params.row.status === 'active' ? 'Disable Access' : 'Enable Access'}
          </button>
          {params.row.status === 'invited' ? (
            <button
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
              onClick={() => resendInvite(params.row.id)}
            >
              Resend Invite
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
      tabs={accountNavItems}
      title="Users"
      subtitle="Manage workspace access and roles. Disabling access also pauses lead delivery for that user."
      status={status}
      primaryAction={{
        label: formMode ? 'Close Form' : 'Add User',
        brand: true,
        onClick: () => (formMode ? closeForm() : openCreateForm())
      }}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 gap-3">
          {formMode ? (
            <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(18,28,42,0.04)]">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-8 py-6">
                <div className="space-y-1">
                  <h2 className="mt-0 font-['Space_Grotesk'] text-lg font-bold text-slate-900">
                    {formMode === 'edit' ? 'Edit User' : 'Add User'}
                  </h2>
                  <div className="text-sm text-slate-500">
                    Manage who can enter the workspace here. Lead alert settings are visible too, but access is the master gate.
                  </div>
                </div>
                <Button variant="outline" type="button" onClick={closeForm} disabled={savingForm}>
                  Close
                </Button>
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
                      Changing the phone number resets SMS opt-in for this user.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClass}>Role</label>
                    <select
                      className={fieldControlClass}
                      value={formState.role}
                      onChange={(event) => updateFormField('role', event.target.value)}
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Standard User</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClass}>System Access</label>
                    <select
                      className={fieldControlClass}
                      value={formState.status}
                      onChange={(event) => updateFormField('status', event.target.value)}
                    >
                      <option value="active" disabled={!canSelectActiveStatus}>Enabled</option>
                      <option value="invited">Invite Pending</option>
                      <option value="disabled">Disabled</option>
                      <option value="suspended">Suspended</option>
                    </select>
                    <div className="ml-1 text-xs text-slate-500">
                      If access is not enabled, lead delivery pauses for this user automatically.
                    </div>
                    {!canSelectActiveStatus ? (
                      <div className="ml-1 text-xs text-amber-700">
                        The 10 active people limit is reached. Choose another status or disable someone first.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-4 border-t border-slate-100 pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <span className="material-symbols-outlined text-lg text-blue-700">call_split</span>
                    Call Transfer
                  </h3>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-5">
                    <label className="flex items-start gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={formState.transferEnabled}
                        onChange={(event) => updateFormField('transferEnabled', event.target.checked)}
                      />
                      <span className="normal-case font-medium tracking-normal text-slate-700">
                        Allow EveryCall to blind-transfer callers to this person
                      </span>
                    </label>
                    <div className="mt-3 ml-6 text-xs leading-6 text-slate-500">
                      Use this only for pre-approved internal destinations. The caller can ask for this person by name or extension, and EveryCall never reads the phone number aloud.
                    </div>

                    <div className="mt-5 ml-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={fieldLabelClass}>Extension</label>
                        <input
                          className={fieldControlClass}
                          type="text"
                          inputMode="numeric"
                          value={formState.transferExtension}
                          onChange={(event) => updateFormField('transferExtension', event.target.value)}
                          placeholder="101"
                        />
                        <div className="ml-1 text-xs text-slate-500">
                          Optional. Use 1 to 6 digits if you want callers to say an extension.
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className={fieldLabelClass}>Forward To Number</label>
                        <input
                          className={fieldControlClass}
                          type="tel"
                          value={formState.forwardToNumber}
                          onChange={(event) => updateFormField('forwardToNumber', event.target.value)}
                          placeholder="+1XXXXXXXXXX"
                        />
                        <div className="ml-1 text-xs text-slate-500">
                          Private destination number used only for transfer routing. This can be saved now and enabled when ready.
                        </div>
                      </div>
                    </div>

                    {formState.transferEnabled && formState.status !== 'active' ? (
                      <div className="mt-3 ml-6 text-xs text-amber-700">
                        Transfer stays available only for active users.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-4 border-t border-slate-100 pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <span className="material-symbols-outlined text-lg text-blue-700">notifications_active</span>
                    Lead Alert Preferences
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
                        The subscriber must explicitly consent before EveryCall sends SMS alerts. Saving a user does not automatically opt them in.
                      </div>

                      <div className="text-xs leading-6 text-slate-600">
                        If <span className="font-semibold text-slate-700">Receive SMS alerts</span> is checked before the subscriber replies YES,
                        the SMS status stays pending and no text alerts will be sent yet.
                      </div>

                      <div className="text-xs leading-6 text-slate-600">
                        By providing a phone number and sending an SMS opt-in request, the subscriber agrees to receive SMS
                        new lead alerts from EveryCall by Creative Dynamic. Message frequency may vary. Message and data
                        rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.
                        Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes.
                      </div>

                      <div className="text-xs text-slate-600">
                        <a className="text-sky-700 underline" href="https://everycall.io/privacy-policy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
                        {' '}|{' '}
                        <a className="text-sky-700 underline" href="https://everycall.io/terms-and-conditions.html" target="_blank" rel="noreferrer">SMS Terms</a>
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
                          Save this user first, then reopen the form to send the SMS opt-in request.
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
                    {savingForm ? (formMode === 'edit' ? 'Saving...' : 'Creating...') : (formMode === 'edit' ? 'Save User' : 'Create User')}
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          <div className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="mb-3">
              <h2 className="mt-0 text-lg font-semibold">Users</h2>
              <p className="mt-1 text-sm text-slate-500">
                Use this page to control workspace access. Disabling access also pauses email and SMS lead delivery for that person.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Active people: {activeUserCount} / {ACTIVE_USER_LIMIT}
              </p>
              {activeUserLimitReached ? (
                <p className="mt-1 text-sm text-amber-700">
                  The active limit is reached. Disable one before enabling another.
                </p>
              ) : null}
            </div>
            <div style={{ height: rows.length ? 'auto' : 300 }}>
              <DataGrid
                rows={rows}
                columns={userColumns}
                autoHeight
                getRowHeight={() => 'auto'}
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                localeText={{ noRowsLabel: loading ? 'Loading users...' : 'No users yet.' }}
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
        </div>

        <GuidePanel title="Users Guide" eyebrow="How it works" icon="manage_accounts">
          <div>Use this page to control workspace access and roles.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">System access</div>
            <div className="mt-1 text-sm text-slate-600">If access is disabled, email and SMS lead alerts stop for that person.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Call transfers</div>
            <div className="mt-1 text-sm text-slate-600">Transfers are blind and only route to active people with transfer enabled and a saved forward-to number. Callers can ask by name or extension.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Standard users</div>
            <div className="mt-1 text-sm text-slate-600">People added from Send Leads To appear here as Standard Users.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

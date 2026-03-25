'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';
import GuidePanel from '../_components/GuidePanel';
import ClientPage from '../_components/ClientPage';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

const EMPTY_FORM = {
  name: '',
  email: '',
  phoneNumber: '',
  role: 'member',
  status: 'active',
  leadAlertEmailEnabled: false,
  leadAlertSmsEnabled: false,
  smsConsentConfirmed: false,
  smsOptInStatus: 'not_requested'
};

export default function TeamPage() {
  const [users, setUsers] = useState([]);
  const [formMode, setFormMode] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading team users...', tone: 'warn' });

  const loadUsers = () => {
    setLoading(true);
    fetch('/api/v1/tenant/users')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load team users.', tone: 'bad' });
          setLoading(false);
          return;
        }
        setUsers(data.users || []);
        setStatus({ message: `Loaded ${data.users?.length || 0} team user(s).`, tone: 'ok' });
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load team users.', tone: 'bad' });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const closeForm = () => {
    setFormMode(null);
    setEditingUserId(null);
    setFormState(EMPTY_FORM);
  };

  const openCreateForm = () => {
    setFormMode('create');
    setEditingUserId(null);
    setFormState(EMPTY_FORM);
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
      smsConsentConfirmed: false,
      smsOptInStatus: row.smsOptIn || 'not_requested'
    });
  };

  const updateFormField = (field, value) => {
    setFormState((current) => ({ ...current, [field]: value }));
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
    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      setStatus({ message: body?.message || 'SMS opt-in request failed.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'SMS opt-in request sent.', tone: 'ok' });
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
      leadAlertSmsEnabled: Boolean(formState.leadAlertSmsEnabled)
    };

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
    role: user.role,
    status: user.status,
    smsOptIn: user.sms_opt_in_status || 'not_requested',
    leadAlertSmsEnabled: Boolean(user.lead_alert_sms_enabled),
    leadAlertEmailEnabled: Boolean(user.lead_alert_email_enabled)
  })), [users]);

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 150 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 220 },
    {
      field: 'phone',
      headerName: 'Phone',
      flex: 0.8,
      minWidth: 150,
      renderCell: (params) => formatPhoneDisplay(params.value) || ''
    },
    { field: 'role', headerName: 'Role', flex: 0.6, minWidth: 110 },
    {
      field: 'smsOptIn',
      headerName: 'SMS Opt-In',
      flex: 0.7,
      minWidth: 130,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'opted_in' ? 'ok' : params.value === 'pending' ? 'warn' : 'bad'}`}>
          {params.value}
        </span>
      )
    },
    {
      field: 'leadAlertEmailEnabled',
      headerName: 'Lead Email',
      flex: 0.65,
      minWidth: 115,
      renderCell: (params) => (
        <span className={`badge ${params.value ? 'ok' : 'bad'}`}>
          {params.value ? 'enabled' : 'off'}
        </span>
      )
    },
    {
      field: 'leadAlertSmsEnabled',
      headerName: 'Lead SMS',
      flex: 0.65,
      minWidth: 115,
      renderCell: (params) => (
        <span className={`badge ${params.value ? 'ok' : 'bad'}`}>
          {params.value ? 'enabled' : 'off'}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 115,
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
      minWidth: 190,
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
    <ClientPage
      title="Team"
      subtitle="Invite teammates, edit their details, and control who receives lead alerts."
      status={status}
      primaryAction={{
        label: formMode === 'create' ? 'Close User Form' : 'Add User',
        brand: true,
        onClick: () => (formMode === 'create' ? closeForm() : openCreateForm())
      }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          {formMode ? (
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="mt-0 text-lg font-semibold">
                  {formMode === 'edit' ? 'Edit Team User' : 'Add Team User'}
                </h2>
                <Button variant="outline" type="button" onClick={closeForm} disabled={savingForm}>
                  Close
                </Button>
              </div>
              <form className="grid gap-3" onSubmit={saveUser}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label>Name</label>
                    <input
                      value={formState.name}
                      onChange={(event) => updateFormField('name', event.target.value)}
                      placeholder="Jane Smith"
                    />
                  </div>
                  <div>
                    <label>Email</label>
                    <input
                      value={formState.email}
                      onChange={(event) => updateFormField('email', event.target.value)}
                      placeholder="jane@company.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label>Mobile Phone</label>
                    <input
                      value={formState.phoneNumber}
                      onChange={(event) => updateFormField('phoneNumber', event.target.value)}
                      placeholder="+1XXXXXXXXXX"
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      Changing the phone number resets SMS opt-in for that user.
                    </div>
                  </div>
                  <div>
                    <label>Role</label>
                    <select value={formState.role} onChange={(event) => updateFormField('role', event.target.value)}>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label>Status</label>
                    <select value={formState.status} onChange={(event) => updateFormField('status', event.target.value)}>
                      <option value="active">Active</option>
                      <option value="invited">Invited</option>
                      <option value="suspended">Suspended</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                  <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={formState.leadAlertEmailEnabled}
                        onChange={(event) => updateFormField('leadAlertEmailEnabled', event.target.checked)}
                      />
                      <span>Receive lead email alerts</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={formState.leadAlertSmsEnabled}
                        onChange={(event) => updateFormField('leadAlertSmsEnabled', event.target.checked)}
                      />
                      <span>Receive lead SMS alerts</span>
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">SMS Opt-In Workflow</div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    Current SMS status: <span className="font-medium text-slate-900">{formState.smsOptInStatus}</span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-700">
                    By providing a phone number and sending an SMS opt-in request, the subscriber agrees to receive SMS
                    new lead alerts from EveryCall by Creative Dynamic. Message frequency may vary. Message and data
                    rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of
                    purchase. Mobile information will not be shared with third parties or affiliates for marketing or
                    promotional purposes.
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">
                    <a className="text-sky-700 underline" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
                    {' '}|{' '}
                    <a className="text-sky-700 underline" href="/terms" target="_blank" rel="noreferrer">SMS Terms</a>
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={formState.smsConsentConfirmed}
                      onChange={(event) => updateFormField('smsConsentConfirmed', event.target.checked)}
                    />
                    <span>I confirm this subscriber has reviewed and agreed to the SMS disclosure above.</span>
                  </label>
                  {formMode === 'edit' ? (
                    <div className="mt-3">
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
                    <div className="mt-3 text-xs text-slate-500">
                      Save the user first, then reopen the form to send the SMS opt-in request.
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={savingForm}>
                    {savingForm ? (formMode === 'edit' ? 'Saving...' : 'Creating...') : (formMode === 'edit' ? 'Save Changes' : 'Create User')}
                  </Button>
                  <Button variant="outline" type="button" onClick={closeForm} disabled={savingForm}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Team Directory</h2>
            <div style={{ height: rows.length ? 'auto' : 300 }}>
              <DataGrid
                rows={rows}
                columns={columns}
                autoHeight
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                localeText={{ noRowsLabel: loading ? 'Loading users...' : 'No users yet.' }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
                }}
              />
            </div>
          </div>
        </div>

        <GuidePanel title="Team Guide" eyebrow="Guide">
          <div>Use Team to manage users, alert recipients, invitation state, and SMS opt-in status.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Lead SMS requirements</div>
            <div className="mt-1 text-sm text-slate-600">A user needs a mobile number and a confirmed SMS opt-in by replying YES before SMS alerts can be enabled.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Use Edit for</div>
            <div className="mt-1 text-sm text-slate-600">Name, email, phone, role, status, SMS setup, and lead alert preferences.</div>
          </div>
        </GuidePanel>
      </div>
    </ClientPage>
  );
}

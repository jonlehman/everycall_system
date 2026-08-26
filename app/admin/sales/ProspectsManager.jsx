'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  displayStatus,
  fetchSalesJson,
  normalizeCall,
  normalizeFollowup,
  normalizeProspect
} from './salesApi';

const EMPTY_FORM = Object.freeze({
  businessName: '',
  contactName: '',
  phone: '',
  website: '',
  email: '',
  leadDeliveryEmail: '',
  businessCategory: '',
  timezone: '',
  permission: 'no',
  emailPermission: 'no',
  suppressed: 'no',
  doNotCall: 'no',
  status: 'queued'
});

const STATUS_OPTIONS = Object.freeze([
  ['', 'All statuses'],
  ['queued', 'Queued'],
  ['ready_to_call', 'Ready to call'],
  ['callback_requested', 'Callback requested'],
  ['no_answer', 'No answer'],
  ['voicemail', 'Voicemail'],
  ['not_interested', 'Not interested'],
  ['do_not_call', 'Do not call'],
  ['suppressed', 'Suppressed'],
  ['deleted', 'Removed']
]);

function fieldClass() {
  return 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15';
}

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Button({ children, tone = 'secondary', className = '', ...props }) {
  const colors = tone === 'primary'
    ? 'border-[#004ac6] bg-[#004ac6] text-white hover:bg-[#003fa8]'
    : tone === 'danger'
      ? 'border-red-300 bg-white text-red-700 hover:bg-red-50'
      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50';
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3.5 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${colors} ${className}`}
    >
      {children}
    </button>
  );
}

function Pill({ value, tone = '' }) {
  const color = tone === 'danger' || ['deleted', 'do_not_call', 'failed', 'suppressed'].includes(value)
    ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'good' || ['completed', 'sent', 'ready_to_call'].includes(value)
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>
      {displayStatus(value)}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function yesNo(value) {
  return value === 'yes';
}

function formFromProspect(prospect) {
  return {
    businessName: prospect.businessName || '',
    contactName: prospect.contactName || '',
    phone: prospect.phone || '',
    website: prospect.website || '',
    email: prospect.email || '',
    leadDeliveryEmail: prospect.leadDeliveryEmail || '',
    businessCategory: prospect.businessCategory || '',
    timezone: prospect.timezone || '',
    permission: prospect.permission ? 'yes' : 'no',
    emailPermission: prospect.emailPermission ? 'yes' : 'no',
    suppressed: prospect.suppressed ? 'yes' : 'no',
    doNotCall: prospect.doNotCall ? 'yes' : 'no',
    status: prospect.status || 'queued'
  };
}

function Editor({ mode, form, setForm, busy, error, onCancel, onSave }) {
  const update = (key) => (event) => setForm((current) => ({
    ...current,
    [key]: event.target.value
  }));
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold text-slate-950">
            {mode === 'add' ? 'Add a prospect' : 'Edit prospect'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Keep this to the information needed for calling, follow-up, and lead delivery.
          </p>
        </div>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <form className="mt-4 grid gap-4" onSubmit={onSave}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Business name">
            <input required value={form.businessName} onChange={update('businessName')} className={fieldClass()} />
          </Field>
          <Field label="Contact name">
            <input value={form.contactName} onChange={update('contactName')} className={fieldClass()} />
          </Field>
          <Field label="Phone" hint="10-digit U.S. number or E.164">
            <input required type="tel" value={form.phone} onChange={update('phone')} placeholder="425-230-0121" className={fieldClass()} />
          </Field>
          <Field label="Website">
            <input type="url" value={form.website} onChange={update('website')} placeholder="https://example.com" className={fieldClass()} />
          </Field>
          <Field label="Contact email">
            <input type="email" value={form.email} onChange={update('email')} placeholder="owner@example.com" className={fieldClass()} />
          </Field>
          <Field label="Lead delivery email">
            <input type="email" value={form.leadDeliveryEmail} onChange={update('leadDeliveryEmail')} placeholder="leads@example.com" className={fieldClass()} />
          </Field>
          <Field label="Business category">
            <input value={form.businessCategory} onChange={update('businessCategory')} placeholder="plumbing" className={fieldClass()} />
          </Field>
          <Field label="Timezone" hint="IANA format">
            <input required value={form.timezone} onChange={update('timezone')} list="sales-timezones" placeholder="America/New_York" className={fieldClass()} />
            <datalist id="sales-timezones">
              <option value="America/New_York" />
              <option value="America/Chicago" />
              <option value="America/Denver" />
              <option value="America/Los_Angeles" />
            </datalist>
          </Field>
          {mode === 'edit' ? (
            <Field label="Queue status">
              <select value={form.status} onChange={update('status')} className={fieldClass()}>
                {STATUS_OPTIONS.filter(([value]) => value && value !== 'deleted').map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Permission to call">
            <select value={form.permission} onChange={update('permission')} className={fieldClass()}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field label="Permission to email">
            <select value={form.emailPermission} onChange={update('emailPermission')} className={fieldClass()}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field label="Suppressed">
            <select value={form.suppressed} onChange={update('suppressed')} className={fieldClass()}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Do not call">
            <select value={form.doNotCall} onChange={update('doNotCall')} className={fieldClass()}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#004ac6] bg-[#004ac6] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#003fa8] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-300"
          >
            {busy ? 'Saving…' : mode === 'add' ? 'Add prospect' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Activity({ prospectId, detail, loading, error, onRetry }) {
  if (loading) return <div className="p-4 text-sm text-slate-500">Loading call and follow-up activity…</div>;
  if (error) {
    return (
      <div className="p-4 text-sm text-red-700">
        {error} <button type="button" className="font-semibold underline" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  const calls = Array.isArray(detail?.calls) ? detail.calls.map(normalizeCall) : [];
  const followups = Array.isArray(detail?.followups) ? detail.followups.map(normalizeFollowup) : [];
  const notes = Array.isArray(detail?.notes) ? detail.notes : [];
  return (
    <div className="grid gap-4 bg-slate-50 p-4 lg:grid-cols-2">
      <section>
        <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-slate-600">Call outcomes</h3>
        <div className="mt-2 grid gap-2">
          {calls.length ? calls.map((call) => (
            <article key={call.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Pill value={call.outcome || call.state} />
                <time className="text-xs text-slate-500">{formatDate(call.outcomeRecordedAt || call.endedAt || call.createdAt)}</time>
              </div>
              {call.outcomeNotes ? <p className="mb-0 mt-2 whitespace-pre-wrap text-slate-700">{call.outcomeNotes}</p> : null}
            </article>
          )) : <p className="m-0 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">No calls recorded.</p>}
        </div>
      </section>

      <section>
        <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-slate-600">Follow-ups</h3>
        <div className="mt-2 grid gap-2">
          {followups.length ? followups.map((followup) => (
            <article key={followup.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Pill value={followup.status} tone={followup.lastErrorCode ? 'danger' : ''} />
                <span className="font-medium text-slate-800">{displayStatus(followup.outcome)}</span>
              </div>
              <p className="mb-0 mt-2 text-xs text-slate-500">
                {followup.completedAt ? `Completed ${formatDate(followup.completedAt)}` : `Next attempt ${formatDate(followup.availableAt)}`}
                {followup.maxAttempts ? ` · ${followup.attempts}/${followup.maxAttempts} attempts` : ''}
              </p>
              {followup.lastErrorMessage ? <p className="mb-0 mt-2 text-red-700">{followup.lastErrorMessage}</p> : null}
            </article>
          )) : <p className="m-0 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">No follow-ups recorded.</p>}
        </div>
      </section>

      {notes.length ? (
        <section className="lg:col-span-2">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-slate-600">Notes</h3>
          <div className="mt-2 grid gap-2">
            {notes.map((note) => (
              <article key={note.noteId} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <p className="m-0 whitespace-pre-wrap text-slate-700">{note.body}</p>
                <time className="mt-2 block text-xs text-slate-500">{formatDate(note.createdAt)}</time>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <span className="sr-only">Activity for {prospectId}</span>
    </div>
  );
}

export default function ProspectsManager({ onProspectsChanged }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [nextQueuePosition, setNextQueuePosition] = useState(null);
  const [editorMode, setEditorMode] = useState('');
  const [editingProspect, setEditingProspect] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [details, setDetails] = useState({});
  const [detailLoadingId, setDetailLoadingId] = useState('');
  const [detailErrors, setDetailErrors] = useState({});
  const [deletingId, setDeletingId] = useState('');

  const queryString = useCallback((cursor = 0) => {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('afterQueuePosition', String(cursor));
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (includeDeleted || status === 'deleted') params.set('includeDeleted', 'true');
    return params.toString();
  }, [includeDeleted, search, status]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (includeDeleted || status === 'deleted') params.set('includeDeleted', 'true');
    const suffix = params.toString();
    return `/api/v1/admin/sales/prospects/export${suffix ? `?${suffix}` : ''}`;
  }, [includeDeleted, search, status]);

  const loadProspects = useCallback(async ({ append = false, cursor = 0 } = {}) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/prospects?${queryString(cursor)}`);
      const next = Array.isArray(payload.prospects) ? payload.prospects.map(normalizeProspect) : [];
      setProspects((current) => append ? [...current, ...next] : next);
      setNextQueuePosition(payload.nextQueuePosition || null);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load prospects.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadProspects();
  }, [loadProspects]);

  const openAdd = () => {
    setEditingProspect(null);
    setForm({ ...EMPTY_FORM });
    setEditorError('');
    setEditorMode('add');
  };

  const openEdit = (prospect) => {
    setEditingProspect(prospect);
    setForm(formFromProspect(prospect));
    setEditorError('');
    setEditorMode('edit');
  };

  const closeEditor = () => {
    if (editorBusy) return;
    setEditorMode('');
    setEditingProspect(null);
    setEditorError('');
  };

  const saveProspect = async (event) => {
    event.preventDefault();
    setEditorBusy(true);
    setEditorError('');
    setNotice('');
    try {
      if (editorMode === 'add') {
        await fetchSalesJson('/api/v1/admin/sales/prospects', {
          method: 'POST',
          body: JSON.stringify({
            business_name: form.businessName.trim(),
            contact_name: form.contactName.trim(),
            phone: form.phone.trim(),
            website: form.website.trim(),
            email: form.email.trim(),
            lead_delivery_email: form.leadDeliveryEmail.trim(),
            business_category: form.businessCategory.trim(),
            timezone: form.timezone.trim(),
            permission: form.permission,
            email_permission: form.emailPermission,
            suppressed: form.suppressed,
            do_not_call: form.doNotCall
          })
        });
        setNotice('Prospect added.');
      } else if (editingProspect?.id) {
        await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(editingProspect.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            businessName: form.businessName.trim(),
            contactName: form.contactName.trim(),
            phoneE164: form.phone.trim(),
            websiteUrl: form.website.trim(),
            contactEmail: form.email.trim(),
            leadDeliveryEmail: form.leadDeliveryEmail.trim(),
            businessCategory: form.businessCategory.trim(),
            timezone: form.timezone.trim(),
            permissionGranted: yesNo(form.permission),
            emailPermission: yesNo(form.emailPermission),
            suppressed: yesNo(form.suppressed),
            doNotCall: yesNo(form.doNotCall),
            status: form.status,
            expectedRowVersion: editingProspect.rowVersion
          })
        });
        setDetails((current) => ({ ...current, [editingProspect.id]: undefined }));
        setNotice('Prospect updated.');
      }
      setEditorMode('');
      setEditingProspect(null);
      setEditorError('');
      await loadProspects();
      await onProspectsChanged?.();
    } catch (saveError) {
      setEditorError(saveError?.message || 'Could not save the prospect.');
    } finally {
      setEditorBusy(false);
    }
  };

  const loadDetail = async (prospectId, { force = false } = {}) => {
    if (!force && details[prospectId]) return;
    setDetailLoadingId(prospectId);
    setDetailErrors((current) => ({ ...current, [prospectId]: '' }));
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospectId)}`);
      setDetails((current) => ({ ...current, [prospectId]: payload.prospect || null }));
    } catch (detailError) {
      setDetailErrors((current) => ({
        ...current,
        [prospectId]: detailError?.message || 'Could not load this prospect activity.'
      }));
    } finally {
      setDetailLoadingId('');
    }
  };

  const toggleActivity = (prospectId) => {
    const next = expandedId === prospectId ? '' : prospectId;
    setExpandedId(next);
    if (next) void loadDetail(next);
  };

  const deleteProspect = async (prospect) => {
    const confirmed = window.confirm(
      `Delete ${prospect.businessName}?\n\nThis removes the prospect from the active list and cancels pending work. Call outcomes and follow-up history are retained.`
    );
    if (!confirmed) return;
    setDeletingId(prospect.id);
    setError('');
    setNotice('');
    try {
      await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedRowVersion: prospect.rowVersion })
      });
      setNotice(`${prospect.businessName} was removed from active prospects.`);
      setExpandedId('');
      await loadProspects();
      await onProspectsChanged?.();
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete the prospect.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">Prospects</h2>
            <p className="mt-1 text-sm text-slate-500">
              Manage the calling list and review its activity without adding CRM pipelines or tasks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={exportHref} className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-800 no-underline transition hover:bg-slate-50">
              Export CSV
            </a>
            <Button tone="primary" onClick={openAdd}>Add prospect</Button>
          </div>
        </div>

        <form
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search business, contact, phone, or website"
            aria-label="Search prospects"
            className={fieldClass()}
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className={fieldClass()}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
          </select>
          <button type="submit" className="min-h-10 rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Search</button>
        </form>

        <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} />
          Show removed prospects
        </label>
      </section>

      {editorMode ? (
        <Editor
          mode={editorMode}
          form={form}
          setForm={setForm}
          busy={editorBusy}
          error={editorError}
          onCancel={closeEditor}
          onSave={saveProspect}
        />
      ) : null}

      {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="m-0 text-sm font-medium text-slate-700" aria-live="polite">
            {loading ? 'Loading prospects…' : `${prospects.length} prospect${prospects.length === 1 ? '' : 's'} loaded`}
          </p>
          <Button onClick={() => { void loadProspects(); }} disabled={loading}>Refresh</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Business</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Last outcome</th>
                <th className="px-4 py-3 font-semibold">Follow-up</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && !prospects.length ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No prospects match these filters.</td></tr>
              ) : null}
              {prospects.map((prospect) => (
                <ProspectRows
                  key={prospect.id}
                  prospect={prospect}
                  expanded={expandedId === prospect.id}
                  detail={details[prospect.id]}
                  detailLoading={detailLoadingId === prospect.id}
                  detailError={detailErrors[prospect.id]}
                  deleting={deletingId === prospect.id}
                  onToggle={() => toggleActivity(prospect.id)}
                  onRetry={() => { void loadDetail(prospect.id, { force: true }); }}
                  onEdit={() => openEdit(prospect)}
                  onDelete={() => { void deleteProspect(prospect); }}
                />
              ))}
            </tbody>
          </table>
        </div>

        {nextQueuePosition ? (
          <div className="border-t border-slate-200 p-4 text-center">
            <Button onClick={() => { void loadProspects({ append: true, cursor: nextQueuePosition }); }} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ProspectRows({
  prospect,
  expanded,
  detail,
  detailLoading,
  detailError,
  deleting,
  onToggle,
  onRetry,
  onEdit,
  onDelete
}) {
  return (
    <>
      <tr className={expanded ? 'bg-blue-50/30' : 'bg-white'}>
        <td className="px-4 py-3 align-top">
          <div className="font-semibold text-slate-950">{prospect.businessName || 'Unnamed prospect'}</div>
          <div className="mt-1 text-xs text-slate-500">{prospect.businessCategory || 'No category'} · {prospect.timezone || 'No timezone'}</div>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="text-slate-800">{prospect.contactName || 'No contact name'}</div>
          <a href={`tel:${prospect.phone}`} className="mt-1 block text-xs text-[#004ac6]">{prospect.phone || 'No phone'}</a>
          {prospect.email ? <a href={`mailto:${prospect.email}`} className="mt-1 block max-w-[220px] truncate text-xs text-[#004ac6]">{prospect.email}</a> : null}
        </td>
        <td className="px-4 py-3 align-top">
          <Pill value={prospect.status} />
          <div className="mt-2 text-xs text-slate-500">
            {prospect.permission ? 'Call permitted' : 'No call permission'}
            {prospect.suppressed ? ' · Suppressed' : ''}
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          {prospect.outcome ? <Pill value={prospect.outcome} /> : <span className="text-slate-400">None</span>}
          <div className="mt-2 text-xs text-slate-500">{formatDate(prospect.lastOutcomeAt)}</div>
        </td>
        <td className="px-4 py-3 align-top">
          {prospect.latestFollowup ? <Pill value={prospect.latestFollowup.status} /> : <span className="text-slate-400">None</span>}
          {prospect.latestFollowup?.outcome ? <div className="mt-2 text-xs text-slate-500">{displayStatus(prospect.latestFollowup.outcome)}</div> : null}
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex justify-end gap-2">
            <Button onClick={onToggle}>{expanded ? 'Hide activity' : 'Activity'}</Button>
            {prospect.status !== 'deleted' ? <Button onClick={onEdit}>Edit</Button> : null}
            {prospect.status !== 'deleted' ? <Button tone="danger" onClick={onDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button> : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="p-0">
            <Activity
              prospectId={prospect.id}
              detail={detail}
              loading={detailLoading}
              error={detailError}
              onRetry={onRetry}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

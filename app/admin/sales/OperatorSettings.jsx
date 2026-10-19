'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchSalesJson, displayStatus } from './salesApi';
import { Card, Field, TextInput, ActionButton, ErrorNotice, Detail } from './SalesUi';

export default function OperatorSettings() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetchSalesJson('/api/v1/admin/sales/operator-settings?list=true')
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  const selectOperator = (id) => {
    setSelectedId(id);
    setSaved('');
    setError('');
    const row = data.operators.find((operator) => String(operator.id) === id);
    setDraft(row ? { displayName: row.displayName || '', callerIdNumber: row.callerIdNumber || '', telnyxTelephonyCredentialId: row.telnyxTelephonyCredentialId || '', active: row.settingsUserId ? Boolean(row.active) : true } : null);
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setSaved('');
    try {
      const result = await fetchSalesJson('/api/v1/admin/sales/operator-settings', { method: 'PUT', body: JSON.stringify({ adminUserId: Number(selectedId), ...draft }) });
      setData((current) => ({ ...current, operators: current.operators.map((operator) => String(operator.id) === selectedId ? { ...operator, ...result.settings, settingsUserId: result.settings.adminUserId } : operator) }));
      setSaved('Operator settings saved.');
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  return <div className="grid gap-4">
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="m-0 text-lg font-semibold">Operator settings</h2><p className="mt-1 text-sm text-slate-500">Manage calling access and dedicated sales phone settings for each rep.</p></div><Link className="text-sm font-semibold text-blue-700 underline" href="/admin/users">Create or reset a Sales account</Link></div>
      <ErrorNotice message={error} />
      {!data ? <p className="mt-3 text-sm text-slate-500">{error ? 'Operator settings could not be loaded.' : 'Loading operators…'}</p> : <form onSubmit={save} className="mt-4 grid max-w-2xl gap-4">
        <Field label="Operator"><select disabled={busy} value={selectedId} onChange={(e) => selectOperator(e.target.value)} className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Select an operator</option>{data.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.username || operator.email} ({displayStatus(operator.role)}){operator.active === false ? ' — Disabled' : ''}</option>)}</select></Field>
        {draft ? <>
          <Field label="Display name"><TextInput value={draft.displayName} disabled={busy} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} maxLength={200} /></Field>
          <Field label="Sales caller ID" hint="Leave blank to use the deployment's dedicated sales caller ID."><TextInput type="tel" value={draft.callerIdNumber} disabled={busy} onChange={(e) => setDraft({ ...draft, callerIdNumber: e.target.value })} placeholder="+12065550100" /></Field>
          <Field label="Telnyx sales telephony credential ID" hint="Use a credential on the dedicated sales connection with Park Outbound Calls enabled. Leave blank to use the deployment default."><TextInput value={draft.telnyxTelephonyCredentialId} disabled={busy} onChange={(e) => setDraft({ ...draft, telnyxTelephonyCredentialId: e.target.value })} maxLength={240} /></Field>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.active} disabled={busy} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Operator active</label>
          <p className="m-0 text-xs text-slate-500">Disabling a Sales operator prevents Sales session access. Save access changes between calls.</p>
          <ActionButton className="w-fit" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save operator settings'}</ActionButton>
        </> : null}
        {saved ? <p role="status" className="text-sm text-emerald-700">{saved}</p> : null}
      </form>}
    </Card>
    {data?.policy ? <Card><h2 className="m-0 text-base font-semibold">Calling policy</h2><p className="mt-1 text-sm text-slate-500">These settings are managed in the sales deployment configuration.</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><Detail label="Outbound enabled" value={data.policy.outboundEnabled ? 'Yes' : 'No'} /><Detail label="Local calling window" value={`${data.policy.callingWindowStart}–${data.policy.callingWindowEnd}`} /><Detail label="Missing timezone" value={displayStatus(data.policy.missingTimezonePolicy)} /></div><p className="mt-4 text-xs text-slate-500">The calling window follows each prospect's timezone; matching start and end times allow the full day. Provider credentials, campaign IDs, and rollout gates remain deployment-managed.</p></Card> : null}
  </div>;
}

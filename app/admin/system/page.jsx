'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';

function toneClass(tone) {
  if (tone === 'bad') return 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900';
  if (tone === 'ok') return 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900';
  if (tone === 'warn') return 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900';
  return 'rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function RuntimeFlag({ label, active }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${active ? 'text-emerald-700' : 'text-red-700'}`}>
        {active ? 'Configured' : 'Missing'}
      </div>
    </div>
  );
}

function RecentTable({ title, emptyLabel, columns, rows }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="m-0 text-lg font-semibold text-slate-900">{title}</h2>
      {rows?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${index}`} className="border-b border-slate-100 last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-2 align-top text-slate-700">
                      {column.render ? column.render(row[column.key], row) : (row[column.key] || '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 text-sm text-slate-500">{emptyLabel}</div>
      )}
    </div>
  );
}

export default function AdminSystemPage() {
  const [phrase, setPhrase] = useState('');
  const [telnyxSmsNumber, setTelnyxSmsNumber] = useState('');
  const [telnyxSmsNumberId, setTelnyxSmsNumberId] = useState('');
  const [telnyxSmsMessagingProfileId, setTelnyxSmsMessagingProfileId] = useState('');
  const [configStatus, setConfigStatus] = useState({ message: 'Loading system config...', tone: 'warn' });
  const [debugStatus, setDebugStatus] = useState({ message: 'Loading SMS diagnostics...', tone: 'warn' });
  const [testStatus, setTestStatus] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [testMode, setTestMode] = useState('opt_in');
  const [debugData, setDebugData] = useState({
    config: null,
    runtime: {
      telnyxApiKeyConfigured: false,
      telnyxPublicKeyConfigured: false
    },
    recentHealth: [],
    recentFailovers: [],
    recentDeliveries: []
  });

  const loadConfig = async () => {
    setConfigStatus({ message: 'Loading system config...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config');
      const data = resp.ok ? await resp.json() : null;
      if (!data) {
        setConfigStatus({ message: 'Failed to load system config.', tone: 'bad' });
        return;
      }
      setPhrase(data?.config?.global_emergency_phrase || '');
      setTelnyxSmsNumber(data?.config?.telnyx_sms_number || '');
      setTelnyxSmsNumberId(data?.config?.telnyx_sms_number_id || '');
      setTelnyxSmsMessagingProfileId(data?.config?.telnyx_sms_messaging_profile_id || '');
      setConfigStatus({ message: 'System config loaded.', tone: 'ok' });
    } catch {
      setConfigStatus({ message: 'Failed to load system config.', tone: 'bad' });
    }
  };

  const loadDiagnostics = async () => {
    setDebugStatus({ message: 'Loading SMS diagnostics...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/sms/debug');
      const data = resp.ok ? await resp.json() : null;
      if (!data) {
        setDebugStatus({ message: 'Failed to load SMS diagnostics.', tone: 'bad' });
        return;
      }
      setDebugData({
        config: data.config || null,
        runtime: data.runtime || {
          telnyxApiKeyConfigured: false,
          telnyxPublicKeyConfigured: false
        },
        recentHealth: data.recentHealth || [],
        recentFailovers: data.recentFailovers || [],
        recentDeliveries: data.recentDeliveries || []
      });
      setDebugStatus({ message: 'SMS diagnostics loaded.', tone: 'ok' });
    } catch {
      setDebugStatus({ message: 'Failed to load SMS diagnostics.', tone: 'bad' });
    }
  };

  useEffect(() => {
    loadConfig();
    loadDiagnostics();
  }, []);

  const saveConfig = async () => {
    if (!phrase.trim()) {
      setConfigStatus({ message: 'Global emergency phrase is required.', tone: 'bad' });
      return;
    }
    setConfigStatus({ message: 'Saving system config...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalEmergencyPhrase: phrase.trim(),
          telnyxSmsNumber: telnyxSmsNumber.trim(),
          telnyxSmsNumberId: telnyxSmsNumberId.trim(),
          telnyxSmsMessagingProfileId: telnyxSmsMessagingProfileId.trim()
        })
      });
      setConfigStatus(resp.ok
        ? { message: 'System config saved.', tone: 'ok' }
        : { message: 'Save failed.', tone: 'bad' });
      if (resp.ok) {
        loadDiagnostics();
      }
    } catch {
      setConfigStatus({ message: 'Save failed.', tone: 'bad' });
    }
  };

  const sendTestSms = async () => {
    if (!testPhone.trim()) {
      setTestStatus({ message: 'Enter a destination phone number first.', tone: 'bad' });
      return;
    }
    setTestStatus({ message: 'Sending test SMS...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testPhone.trim(),
          mode: testMode
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setTestStatus({ message: data?.message || 'Test SMS failed.', tone: 'bad' });
        return;
      }
      setTestStatus({
        message: data?.providerMessageId
          ? `Test SMS accepted by Telnyx. Message ID: ${data.providerMessageId}.`
          : 'Test SMS accepted by Telnyx.',
        tone: 'ok'
      });
      loadDiagnostics();
    } catch {
      setTestStatus({ message: 'Test SMS failed.', tone: 'bad' });
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">System Config</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadDiagnostics}>Refresh SMS Diagnostics</Button>
        </div>
      </div>

      <div className={toneClass(configStatus.tone)}>
        {configStatus.message}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">Global Emergency Phrase</label>
        <textarea
          className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
        />

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">Shared Telnyx SMS Number</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsNumber}
              onChange={(event) => setTelnyxSmsNumber(event.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Telnyx SMS Number ID</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsNumberId}
              onChange={(event) => setTelnyxSmsNumberId(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Telnyx Messaging Profile ID</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsMessagingProfileId}
              onChange={(event) => setTelnyxSmsMessagingProfileId(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveConfig}>Save System Config</Button>
        </div>
      </div>

      <div className={toneClass(debugStatus.tone)}>
        {debugStatus.message}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RuntimeFlag label="Shared SMS Number" active={Boolean(debugData?.config?.telnyx_sms_number)} />
        <RuntimeFlag label="Messaging Profile ID" active={Boolean(debugData?.config?.telnyx_sms_messaging_profile_id)} />
        <RuntimeFlag label="TELNYX_API_KEY" active={Boolean(debugData?.runtime?.telnyxApiKeyConfigured)} />
        <RuntimeFlag label="TELNYX_PUBLIC_KEY" active={Boolean(debugData?.runtime?.telnyxPublicKeyConfigured)} />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
        Outbound test sends only confirm that EveryCall can hand the message to Telnyx. Final carrier delivery still depends on the sender being properly 10DLC-registered and the webhook public key being correct if you want inbound/failover events to validate.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="m-0 text-lg font-semibold text-slate-900">Send Test SMS</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div>
            <label className="block text-sm font-medium text-slate-700">Destination Phone Number</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Message Type</label>
            <select
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={testMode}
              onChange={(event) => setTestMode(event.target.value)}
            >
              <option value="opt_in">Opt-In Copy</option>
              <option value="test">Generic Test Copy</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={sendTestSms}>Send Test SMS</Button>
          </div>
        </div>
        {testStatus?.message ? (
          <div className={`mt-4 ${toneClass(testStatus.tone)}`}>
            {testStatus.message}
          </div>
        ) : null}
      </div>

      <RecentTable
        title="Recent SMS Channel Health"
        emptyLabel="No recent SMS channel health records."
        rows={debugData.recentHealth}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'status', label: 'Status' },
          { key: 'last_error_code', label: 'Error Code' },
          { key: 'last_error_message', label: 'Error Message' },
          { key: 'updated_at', label: 'Updated', render: (value) => formatTimestamp(value) }
        ]}
      />

      <RecentTable
        title="Recent SMS Failovers"
        emptyLabel="No recent SMS failover events."
        rows={debugData.recentFailovers}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'provider_message_id', label: 'Message ID' },
          { key: 'reason', label: 'Reason' },
          { key: 'created_at', label: 'Recorded', render: (value) => formatTimestamp(value) }
        ]}
      />

      <RecentTable
        title="Recent SMS Notification Deliveries"
        emptyLabel="No recent SMS delivery attempts."
        rows={debugData.recentDeliveries}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'status', label: 'Status' },
          { key: 'provider_reference', label: 'Message ID' },
          { key: 'last_error_code', label: 'Error Code' },
          { key: 'last_error_message', label: 'Error Message' },
          { key: 'updated_at', label: 'Updated', render: (value) => formatTimestamp(value) }
        ]}
      />
    </section>
  );
}

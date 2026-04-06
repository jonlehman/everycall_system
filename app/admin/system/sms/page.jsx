'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { RecentTable, RuntimeFlag, formatTimestamp, toneClass } from '../_components/systemShared';

function emptyConfig() {
  return {
    global_emergency_phrase: '',
    default_trial_days: 30,
    billing_plans_json: [],
    telnyx_sms_number: '',
    telnyx_sms_number_id: '',
    telnyx_sms_messaging_profile_id: ''
  };
}

export default function AdminSystemSmsPage() {
  const [config, setConfig] = useState(emptyConfig());
  const [telnyxSmsNumber, setTelnyxSmsNumber] = useState('');
  const [telnyxSmsNumberId, setTelnyxSmsNumberId] = useState('');
  const [telnyxSmsMessagingProfileId, setTelnyxSmsMessagingProfileId] = useState('');
  const [configStatus, setConfigStatus] = useState({ message: 'Loading SMS settings...', tone: 'warn' });
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
    setConfigStatus({ message: 'Loading SMS settings...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config');
      const data = resp.ok ? await resp.json() : null;
      if (!data?.config) {
        setConfigStatus({ message: 'Failed to load SMS settings.', tone: 'bad' });
        return;
      }
      setConfig(data.config);
      setTelnyxSmsNumber(data.config.telnyx_sms_number || '');
      setTelnyxSmsNumberId(data.config.telnyx_sms_number_id || '');
      setTelnyxSmsMessagingProfileId(data.config.telnyx_sms_messaging_profile_id || '');
      setConfigStatus({ message: 'SMS settings loaded.', tone: 'ok' });
    } catch {
      setConfigStatus({ message: 'Failed to load SMS settings.', tone: 'bad' });
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
    setConfigStatus({ message: 'Saving SMS settings...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalEmergencyPhrase: config.global_emergency_phrase || '',
          defaultTrialDays: Number(config.default_trial_days || 30),
          billingPlans: Array.isArray(config.billing_plans_json) ? config.billing_plans_json : [],
          telnyxSmsNumber: telnyxSmsNumber.trim(),
          telnyxSmsNumberId: telnyxSmsNumberId.trim(),
          telnyxSmsMessagingProfileId: telnyxSmsMessagingProfileId.trim()
        })
      });
      if (!resp.ok) {
        setConfigStatus({ message: 'Save failed.', tone: 'bad' });
        return;
      }
      await loadConfig();
      await loadDiagnostics();
      setConfigStatus({ message: 'SMS settings saved.', tone: 'ok' });
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
        <div>
          <h2 className="m-0 text-xl font-semibold text-slate-900">SMS</h2>
          <p className="mt-1 text-sm text-slate-500">
            Shared Telnyx sender details, live diagnostics, and outbound test messages.
          </p>
        </div>
        <Button variant="outline" onClick={loadDiagnostics}>Refresh Diagnostics</Button>
      </div>

      <div className={toneClass(configStatus.tone)}>{configStatus.message}</div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="block">Shared Telnyx SMS Number</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsNumber}
              onChange={(event) => setTelnyxSmsNumber(event.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block">Telnyx SMS Number ID</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsNumberId}
              onChange={(event) => setTelnyxSmsNumberId(event.target.value)}
            />
          </div>
          <div>
            <label className="block">Telnyx Messaging Profile ID</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsMessagingProfileId}
              onChange={(event) => setTelnyxSmsMessagingProfileId(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveConfig}>Save SMS Settings</Button>
        </div>
      </div>

      <div className={toneClass(debugStatus.tone)}>{debugStatus.message}</div>

      <div className="grid gap-4 md:grid-cols-2">
        <RuntimeFlag label="Shared SMS Number" active={Boolean(debugData?.config?.telnyx_sms_number)} />
        <RuntimeFlag label="Messaging Profile ID" active={Boolean(debugData?.config?.telnyx_sms_messaging_profile_id)} />
        <RuntimeFlag label="TELNYX_API_KEY" active={Boolean(debugData?.runtime?.telnyxApiKeyConfigured)} />
        <RuntimeFlag label="TELNYX_PUBLIC_KEY" active={Boolean(debugData?.runtime?.telnyxPublicKeyConfigured)} />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
        Outbound test sends only confirm that EveryCall can hand the message to Telnyx. Final carrier delivery still depends on the sender being properly 10DLC-registered and the webhook public key being correct if you want inbound and failover events to validate.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="m-0 text-lg font-semibold text-slate-900">Send Test SMS</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div>
            <label className="block">Destination Phone Number</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block">Message Type</label>
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
        title="Recent SMS Deliveries"
        emptyLabel="No recent SMS deliveries."
        rows={debugData.recentDeliveries}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'message_text', label: 'Message' },
          { key: 'provider_message_id', label: 'Message ID' },
          { key: 'created_at', label: 'Sent', render: (value) => formatTimestamp(value) }
        ]}
      />
    </section>
  );
}

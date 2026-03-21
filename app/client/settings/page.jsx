'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu'
];

export default function SettingsPage() {
  const [tenant, setTenant] = useState({ name: '-', plan: '-', data_region: '-' });
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [notes, setNotes] = useState('');
  const [leadAlertsEnabled, setLeadAlertsEnabled] = useState(false);
  const [leadAlertSmsEnabled, setLeadAlertSmsEnabled] = useState(false);
  const [leadAlertEmailEnabled, setLeadAlertEmailEnabled] = useState(false);
  const [leadAlertEmailIncludeTranscript, setLeadAlertEmailIncludeTranscript] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading account settings...', tone: 'warn' });

  const loadSettings = () => {
    setLoading(true);
    setStatus({ message: 'Loading account settings...', tone: 'warn' });
    fetch('/api/v1/settings')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load account settings.', tone: 'bad' });
          setLoading(false);
          return;
        }
        setTenant(data.tenant || { name: '-', plan: '-', data_region: '-' });
        setTimezone(data.settings?.timezone || 'America/Los_Angeles');
        setNotes(data.settings?.notes || '');
        setLeadAlertsEnabled(Boolean(data.settings?.lead_alerts_enabled));
        setLeadAlertSmsEnabled(Boolean(data.settings?.lead_alert_sms_enabled));
        setLeadAlertEmailEnabled(Boolean(data.settings?.lead_alert_email_enabled));
        setLeadAlertEmailIncludeTranscript(
          data.settings?.lead_alert_email_include_transcript === undefined
            ? true
            : Boolean(data.settings?.lead_alert_email_include_transcript)
        );
        setStatus({ message: 'Account settings loaded.', tone: 'ok' });
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load account settings.', tone: 'bad' });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setStatus({ message: 'Saving account settings...', tone: 'warn' });
    const resp = await fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timezone,
        notes,
        leadAlertsEnabled,
        leadAlertSmsEnabled,
        leadAlertEmailEnabled,
        leadAlertEmailIncludeTranscript
      })
    });
    setSaving(false);
    if (!resp.ok) {
      setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'Account settings saved.', tone: 'ok' });
  };

  return (
    <ClientPage
      title="Account Settings"
      subtitle="Confirm your account profile and operational defaults."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save Settings', brand: true, onClick: saveSettings, disabled: saving || loading }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Account Snapshot</h2>
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-[180px_1fr]">
              <div>Tenant</div><div>{tenant.name || '-'}</div>
              <div>Plan</div><div>{tenant.plan || '-'}</div>
              <div>Data Region</div><div>{tenant.data_region || '-'}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Operational Defaults</h2>
            <div className="grid gap-3">
              <div>
                <label>Timezone</label>
                <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                  {TIMEZONES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Internal Notes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Compliance notes, handoff preferences, or team instructions."
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="button" onClick={saveSettings} disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
              <Button variant="outline" type="button" onClick={loadSettings} disabled={saving}>Reload</Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">New Lead Notifications</h2>
            <div className="grid gap-3 text-sm">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={leadAlertsEnabled}
                  onChange={(event) => setLeadAlertsEnabled(event.target.checked)}
                />
                <div>
                  <div className="font-medium text-slate-900">Enable new lead notifications</div>
                  <div className="text-slate-500">Turn on outbound alerts when a new call lead is captured.</div>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={leadAlertSmsEnabled}
                  onChange={(event) => setLeadAlertSmsEnabled(event.target.checked)}
                  disabled={!leadAlertsEnabled}
                />
                <div>
                  <div className="font-medium text-slate-900">Send SMS summaries</div>
                  <div className="text-slate-500">Text recipients a short lead summary with contact details.</div>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={leadAlertEmailEnabled}
                  onChange={(event) => setLeadAlertEmailEnabled(event.target.checked)}
                  disabled={!leadAlertsEnabled}
                />
                <div>
                  <div className="font-medium text-slate-900">Send email notifications</div>
                  <div className="text-slate-500">Email recipients the lead summary plus additional context from the call.</div>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={leadAlertEmailIncludeTranscript}
                  onChange={(event) => setLeadAlertEmailIncludeTranscript(event.target.checked)}
                  disabled={!leadAlertsEnabled || !leadAlertEmailEnabled}
                />
                <div>
                  <div className="font-medium text-slate-900">Include transcript in email</div>
                  <div className="text-slate-500">Attach the full transcript to the lead email for follow-up review.</div>
                </div>
              </label>
            </div>
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Choose who receives these alerts on the Team page. SMS still requires each recipient to opt in by text.
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Help</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-500">
            <li>Use timezone and notes to keep routing and handoff behavior consistent.</li>
            <li>Lead alerts only send to team users you enable as recipients.</li>
            <li>If region or plan needs to change, contact support.</li>
            <li>Save changes before leaving this page.</li>
          </ul>
        </div>
      </div>
    </ClientPage>
  );
}

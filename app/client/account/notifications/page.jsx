'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

export default function AccountNotificationsPage() {
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [notes, setNotes] = useState('');
  const [leadAlertsEnabled, setLeadAlertsEnabled] = useState(false);
  const [leadAlertSmsEnabled, setLeadAlertSmsEnabled] = useState(false);
  const [leadAlertEmailEnabled, setLeadAlertEmailEnabled] = useState(false);
  const [leadAlertEmailIncludeTranscript, setLeadAlertEmailIncludeTranscript] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading notification settings...', tone: 'warn' });

  const loadSettings = () => {
    setLoading(true);
    setStatus({ message: 'Loading notification settings...', tone: 'warn' });
    fetch('/api/v1/settings')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load notification settings.', tone: 'bad' });
          setLoading(false);
          return;
        }
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
        setStatus({ message: 'Notification settings loaded.', tone: 'ok' });
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load notification settings.', tone: 'bad' });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setStatus({ message: 'Saving notification settings...', tone: 'warn' });
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
    setStatus({ message: 'Notification settings saved.', tone: 'ok' });
  };

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Notifications"
      subtitle="Control tenant-wide new lead notification behavior. Individual recipients are still managed on Team."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save Notifications', brand: true, onClick: saveSettings, disabled: saving || loading }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
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

          <div className="mt-3 flex gap-2">
            <Button type="button" onClick={saveSettings} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save Notifications'}
            </Button>
            <Button variant="outline" type="button" onClick={loadSettings} disabled={saving}>Reload</Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">How it works</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-500">
            <li>These switches control tenant-wide notification behavior.</li>
            <li>Choose actual recipients on the Team page.</li>
            <li>SMS still requires each recipient to opt in by replying YES.</li>
            <li>Email can optionally include the full transcript.</li>
          </ul>
        </div>
      </div>
    </SectionPage>
  );
}

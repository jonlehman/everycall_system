'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SalesReceptionistNumberBadge from '../../_components/SalesReceptionistNumberBadge';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';

export default function ReceptionistNotificationsPage() {
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
      tabs={receptionistNavItems}
      title="Notifications"
      subtitle="Control tenant-wide new lead notification behavior. Individual recipients are still managed on Team."
      status={status}
      headerAside={<SalesReceptionistNumberBadge />}
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

        <GuidePanel title="Notifications Guide" eyebrow="How it works" icon="notifications">
          <div>These switches control tenant-wide lead notification behavior for the whole account.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Choose recipients on Team</div>
            <div className="mt-1 text-sm text-slate-600">The Team page controls who actually receives email or SMS lead alerts.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">SMS and transcript rules</div>
            <div className="mt-1 text-sm text-slate-600">SMS still requires recipient opt-in by replying YES, and email can optionally include the full transcript.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

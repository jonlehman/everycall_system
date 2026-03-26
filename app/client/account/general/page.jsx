'use client';

import { useEffect, useState } from 'react';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu'
];

function normalizeCallerIdName(value) {
  return String(value || '')
    .replace(/[^a-z0-9 ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15);
}

export default function AccountGeneralPage() {
  const [tenant, setTenant] = useState({ name: '-', plan: '-', data_region: '-', telnyx_voice_number: '', telnyx_voice_number_id: '' });
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [notes, setNotes] = useState('');
  const [callerIdName, setCallerIdName] = useState('');
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
        const nextTenant = data.tenant || { name: '-', plan: '-', data_region: '-', telnyx_voice_number: '', telnyx_voice_number_id: '' };
        setTenant(nextTenant);
        setTimezone(data.settings?.timezone || 'America/Los_Angeles');
        setNotes(data.settings?.notes || '');
        const hasStoredCallerIdName = Boolean(data.settings) && Object.prototype.hasOwnProperty.call(data.settings, 'caller_id_name');
        setCallerIdName(hasStoredCallerIdName ? (data.settings?.caller_id_name || '') : normalizeCallerIdName(nextTenant?.name || ''));
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
    setStatus({ message: 'Saving general settings...', tone: 'warn' });
    const resp = await fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timezone,
        notes,
        callerIdName,
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
    const data = await resp.json().catch(() => null);
    if (data?.callerIdName !== undefined) {
      setCallerIdName(data.callerIdName || '');
    }
    if (data?.providerSync?.ok === false) {
      setStatus({ message: data.providerSync.message || 'General settings saved, but caller ID sync failed.', tone: 'warn' });
      return;
    }
    if (data?.providerSync?.pending) {
      setStatus({ message: data.providerSync.message || 'General settings saved.', tone: 'ok' });
      return;
    }
    setStatus({ message: 'General settings saved.', tone: 'ok' });
  };

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Account"
      subtitle="Manage your account profile and defaults that affect day-to-day operations."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save General', brand: true, onClick: saveSettings, disabled: saving || loading }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Account Snapshot</h2>
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-[180px_1fr]">
              <div>Tenant</div><div>{tenant.name || '-'}</div>
              <div>Plan</div><div>{tenant.plan || '-'}</div>
              <div>Data Region</div><div>{tenant.data_region || '-'}</div>
              <div>Sales Receptionist Number</div><div>{tenant.telnyx_voice_number || 'Not assigned yet'}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Business Timezone</h2>
            <div className="grid gap-3">
              <div>
                <select aria-label="Timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                  {TIMEZONES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <GuidePanel title="Account Guide" eyebrow="How it works" icon="settings">
          <div>Use this page for account-level details like your plan, assigned sales receptionist number, and business timezone.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Account Snapshot</div>
            <div className="mt-1 text-sm text-slate-600">Review your tenant name, plan, region, and assigned sales receptionist number here.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Business Timezone</div>
            <div className="mt-1 text-sm text-slate-600">Set the local timezone the system should use for account-level scheduling and display defaults.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Use Notifications for</div>
            <div className="mt-1 text-sm text-slate-600">Lead alert delivery settings and transcript preferences.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

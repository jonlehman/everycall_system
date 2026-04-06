'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { toneClass } from '../_components/systemShared';

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

export default function AdminSystemGeneralPage() {
  const [config, setConfig] = useState(emptyConfig());
  const [phrase, setPhrase] = useState('');
  const [status, setStatus] = useState({ message: 'Loading general settings...', tone: 'warn' });

  const loadConfig = async () => {
    setStatus({ message: 'Loading general settings...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config');
      const data = resp.ok ? await resp.json() : null;
      if (!data?.config) {
        setStatus({ message: 'Failed to load general settings.', tone: 'bad' });
        return;
      }
      setConfig(data.config);
      setPhrase(data.config.global_emergency_phrase || '');
      setStatus({ message: 'General settings loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Failed to load general settings.', tone: 'bad' });
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const saveConfig = async () => {
    if (!phrase.trim()) {
      setStatus({ message: 'Global emergency phrase is required.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'Saving general settings...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalEmergencyPhrase: phrase.trim(),
          defaultTrialDays: Number(config.default_trial_days || 30),
          billingPlans: Array.isArray(config.billing_plans_json) ? config.billing_plans_json : [],
          telnyxSmsNumber: config.telnyx_sms_number || '',
          telnyxSmsNumberId: config.telnyx_sms_number_id || '',
          telnyxSmsMessagingProfileId: config.telnyx_sms_messaging_profile_id || ''
        })
      });
      if (!resp.ok) {
        setStatus({ message: 'Save failed.', tone: 'bad' });
        return;
      }
      await loadConfig();
      setStatus({ message: 'General settings saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Save failed.', tone: 'bad' });
    }
  };

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="m-0 text-xl font-semibold text-slate-900">General</h2>
        <p className="mt-1 text-sm text-slate-500">
          Shared platform text and non-billing defaults used across admin and tenant setup.
        </p>
      </div>

      <div className={toneClass(status.tone)}>{status.message}</div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block">Global Emergency Phrase</label>
        <textarea
          className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
        />
        <p className="mt-3 text-sm text-slate-500">
          This phrase is used as the platform-wide default for emergency escalation behavior.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveConfig}>Save General Settings</Button>
        </div>
      </div>
    </section>
  );
}

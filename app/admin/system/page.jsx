'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';

export default function AdminSystemPage() {
  const [phrase, setPhrase] = useState('');
  const [telnyxSmsNumber, setTelnyxSmsNumber] = useState('');
  const [telnyxSmsNumberId, setTelnyxSmsNumberId] = useState('');
  const [telnyxSmsMessagingProfileId, setTelnyxSmsMessagingProfileId] = useState('');
  const [status, setStatus] = useState('');

  const loadConfig = async () => {
    setStatus('Loading...');
    try {
      const data = await fetch('/api/v1/system/config').then((resp) => (resp.ok ? resp.json() : null));
      setPhrase(data?.config?.global_emergency_phrase || '');
      setTelnyxSmsNumber(data?.config?.telnyx_sms_number || '');
      setTelnyxSmsNumberId(data?.config?.telnyx_sms_number_id || '');
      setTelnyxSmsMessagingProfileId(data?.config?.telnyx_sms_messaging_profile_id || '');
      setStatus('Loaded.');
    } catch {
      setStatus('Failed to load.');
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const saveConfig = async () => {
    if (!phrase.trim()) {
      setStatus('Global emergency phrase is required.');
      return;
    }
    setStatus('Saving...');
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
      setStatus(resp.ok ? 'Saved.' : 'Save failed.');
    } catch {
      setStatus('Save failed.');
    }
  };

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">System Config</h1>
      </div>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <label>Global Emergency Phrase</label>
        <textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} />
        <label className="mt-3">Shared Telnyx SMS Number</label>
        <input value={telnyxSmsNumber} onChange={(event) => setTelnyxSmsNumber(event.target.value)} placeholder="+1XXXXXXXXXX" />
        <label className="mt-3">Telnyx SMS Number ID</label>
        <input value={telnyxSmsNumberId} onChange={(event) => setTelnyxSmsNumberId(event.target.value)} />
        <label className="mt-3">Telnyx Messaging Profile ID</label>
        <input value={telnyxSmsMessagingProfileId} onChange={(event) => setTelnyxSmsMessagingProfileId(event.target.value)} />
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={saveConfig}>Save System Config</Button>
          <span className="text-sm text-slate-500">{status}</span>
        </div>
      </div>
    </section>
  );
}

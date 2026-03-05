'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';

export default function AdminSystemPage() {
  const [phrase, setPhrase] = useState('');
  const [personality, setPersonality] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [numbersSymbols, setNumbersSymbols] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [faqUsage, setFaqUsage] = useState('');
  const [gatewayFieldSchema, setGatewayFieldSchema] = useState('');
  const [gatewayToolDefinitions, setGatewayToolDefinitions] = useState('');
  const [gatewaySessionConfig, setGatewaySessionConfig] = useState('');
  const [telnyxSmsNumber, setTelnyxSmsNumber] = useState('');
  const [telnyxSmsNumberId, setTelnyxSmsNumberId] = useState('');
  const [telnyxSmsMessagingProfileId, setTelnyxSmsMessagingProfileId] = useState('');
  const [status, setStatus] = useState('Ready.');

  const loadConfig = () => {
    setStatus('Loading...');
    fetch('/api/v1/system/config')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        setPhrase(data?.config?.global_emergency_phrase || '');
        setPersonality(data?.config?.personality_prompt || '');
        setDateTime(data?.config?.datetime_prompt || '');
        setNumbersSymbols(data?.config?.numbers_symbols_prompt || '');
        setConfirmation(data?.config?.confirmation_prompt || '');
        setFaqUsage(data?.config?.faq_usage_prompt || '');
        setGatewayFieldSchema(data?.config?.gateway_field_schema ? JSON.stringify(data.config.gateway_field_schema, null, 2) : '');
        setGatewayToolDefinitions(data?.config?.gateway_tool_definitions ? JSON.stringify(data.config.gateway_tool_definitions, null, 2) : '');
        setGatewaySessionConfig(data?.config?.gateway_session_config ? JSON.stringify(data.config.gateway_session_config, null, 2) : '');
        setTelnyxSmsNumber(data?.config?.telnyx_sms_number || '');
        setTelnyxSmsNumberId(data?.config?.telnyx_sms_number_id || '');
        setTelnyxSmsMessagingProfileId(data?.config?.telnyx_sms_messaging_profile_id || '');
        setStatus('Loaded.');
      })
      .catch(() => setStatus('Failed to load.'));
  };

  const saveConfig = () => {
    if (!phrase.trim()) {
      setStatus('Phrase is required.');
      return;
    }
    setStatus('Saving...');
    fetch('/api/v1/system/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        globalEmergencyPhrase: phrase.trim(),
        personalityPrompt: personality.trim(),
        dateTimePrompt: dateTime.trim(),
        numbersSymbolsPrompt: numbersSymbols.trim(),
        confirmationPrompt: confirmation.trim(),
        faqUsagePrompt: faqUsage.trim(),
        gatewayFieldSchema: gatewayFieldSchema.trim(),
        gatewayToolDefinitions: gatewayToolDefinitions.trim(),
        gatewaySessionConfig: gatewaySessionConfig.trim(),
        telnyxSmsNumber: telnyxSmsNumber.trim(),
        telnyxSmsNumberId: telnyxSmsNumberId.trim(),
        telnyxSmsMessagingProfileId: telnyxSmsMessagingProfileId.trim()
      })
    })
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data?.ok) {
          setStatus('Save failed.');
          return;
        }
        setStatus('Saved.');
      })
      .catch(() => setStatus('Save failed.'));
  };

  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">System Config</h1>
      </div>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <label>Global Emergency Phrase</label>
        <textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} />
        <label className="mt-3">Personality</label>
        <textarea value={personality} onChange={(event) => setPersonality(event.target.value)} />
        <label className="mt-3">Date &amp; Time</label>
        <textarea value={dateTime} onChange={(event) => setDateTime(event.target.value)} />
        <label className="mt-3">Numbers &amp; Symbols</label>
        <textarea value={numbersSymbols} onChange={(event) => setNumbersSymbols(event.target.value)} />
        <label className="mt-3">Confirmation</label>
        <textarea value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <label className="mt-3">When to Use the FAQ</label>
        <textarea value={faqUsage} onChange={(event) => setFaqUsage(event.target.value)} />
        <label className="mt-3">Gateway Field Schema (JSON)</label>
        <textarea value={gatewayFieldSchema} onChange={(event) => setGatewayFieldSchema(event.target.value)} />
        <label className="mt-3">Gateway Tool Definitions (JSON)</label>
        <textarea value={gatewayToolDefinitions} onChange={(event) => setGatewayToolDefinitions(event.target.value)} />
        <label className="mt-3">Gateway Session Config (JSON)</label>
        <textarea value={gatewaySessionConfig} onChange={(event) => setGatewaySessionConfig(event.target.value)} />
        <label className="mt-3">Telnyx SMS Number (Shared)</label>
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

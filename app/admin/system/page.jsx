'use client';

import { useEffect, useState } from 'react';

export default function AdminSystemPage() {
  const [phrase, setPhrase] = useState('');
  const [personality, setPersonality] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [numbersSymbols, setNumbersSymbols] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [faqUsage, setFaqUsage] = useState('');
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
    <section className="screen active">
      <div className="topbar"><h1>System Config</h1></div>
      <div className="card">
        <label>Global Emergency Phrase</label>
        <textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} />
        <label style={{ marginTop: 12 }}>Personality</label>
        <textarea value={personality} onChange={(event) => setPersonality(event.target.value)} />
        <label style={{ marginTop: 12 }}>Date &amp; Time</label>
        <textarea value={dateTime} onChange={(event) => setDateTime(event.target.value)} />
        <label style={{ marginTop: 12 }}>Numbers &amp; Symbols</label>
        <textarea value={numbersSymbols} onChange={(event) => setNumbersSymbols(event.target.value)} />
        <label style={{ marginTop: 12 }}>Confirmation</label>
        <textarea value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <label style={{ marginTop: 12 }}>When to Use the FAQ</label>
        <textarea value={faqUsage} onChange={(event) => setFaqUsage(event.target.value)} />
        <label style={{ marginTop: 12 }}>Telnyx SMS Number (Shared)</label>
        <input value={telnyxSmsNumber} onChange={(event) => setTelnyxSmsNumber(event.target.value)} placeholder="+1XXXXXXXXXX" />
        <label style={{ marginTop: 12 }}>Telnyx SMS Number ID</label>
        <input value={telnyxSmsNumberId} onChange={(event) => setTelnyxSmsNumberId(event.target.value)} />
        <label style={{ marginTop: 12 }}>Telnyx Messaging Profile ID</label>
        <input value={telnyxSmsMessagingProfileId} onChange={(event) => setTelnyxSmsMessagingProfileId(event.target.value)} />
        <div className="toolbar">
          <button className="btn brand" onClick={saveConfig}>Save System Config</button>
          <span className="muted">{status}</span>
        </div>
      </div>
    </section>
  );
}

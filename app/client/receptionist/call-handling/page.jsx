'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export default function CallHandlingPage() {
  const voiceOptions = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
  const [primaryQueue, setPrimaryQueue] = useState('Dispatch Team');
  const [emergencyBehavior, setEmergencyBehavior] = useState('Immediate Transfer');
  const [afterHours, setAfterHours] = useState('Collect details and dispatch callback');
  const [businessHours, setBusinessHours] = useState('Mon-Fri 7:00 AM - 8:00 PM');
  const [greetingText, setGreetingText] = useState('');
  const [voiceType, setVoiceType] = useState('marin');
  const [status, setStatus] = useState({ message: 'Loading call handling...', tone: 'warn' });
  const [saving, setSaving] = useState(false);
  const [sampleStatus, setSampleStatus] = useState('');
  const sampleAudioRef = useRef(null);
  const sampleUrlRef = useRef('');

  const loadState = async () => {
    setStatus({ message: 'Loading call handling...', tone: 'warn' });
    try {
      const [routingData, runtimeData] = await Promise.all([
        fetchJson('/api/v1/routing'),
        fetchJson('/api/v1/knowledge/runtime-profile')
      ]);
      if (!routingData?.ok || !runtimeData?.ok) {
        setStatus({ message: 'Could not load call handling settings.', tone: 'bad' });
        return;
      }
      setPrimaryQueue(routingData.routing?.primary_queue || 'Dispatch Team');
      setEmergencyBehavior(routingData.routing?.emergency_behavior || 'Immediate Transfer');
      setAfterHours(routingData.routing?.after_hours_behavior || 'Collect details and dispatch callback');
      setBusinessHours(routingData.routing?.business_hours || 'Mon-Fri 7:00 AM - 8:00 PM');
      setGreetingText(runtimeData.profile?.greeting_text || '');
      setVoiceType(runtimeData.profile?.session_config?.voice || 'marin');
      setStatus({ message: 'Call handling settings loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load call handling settings.', tone: 'bad' });
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  const saveState = async () => {
    setSaving(true);
    setStatus({ message: 'Saving call handling...', tone: 'warn' });
    try {
      const [routingResp, runtimeResp] = await Promise.all([
        fetchJson('/api/v1/routing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryQueue,
            emergencyBehavior,
            afterHoursBehavior: afterHours,
            businessHours
          })
        }),
        fetchJson('/api/v1/knowledge/runtime-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: {
              greetingText,
              sessionConfig: {
                voice: voiceType
              }
            }
          })
        })
      ]);
      if (!routingResp?.ok || !runtimeResp?.ok) {
        setStatus({ message: 'Could not save call handling settings.', tone: 'bad' });
        return;
      }
      setStatus({ message: 'Call handling settings saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save call handling settings.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const playSample = async () => {
    setSampleStatus('Loading sample...');
    try {
      const resp = await fetch(`/api/v1/voice/sample?voice=${encodeURIComponent(voiceType)}`);
      if (!resp.ok) {
        setSampleStatus('Sample failed.');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
      sampleUrlRef.current = url;
      if (sampleAudioRef.current) {
        sampleAudioRef.current.src = url;
        await sampleAudioRef.current.play();
      }
      setSampleStatus('');
    } catch {
      setSampleStatus('Sample failed.');
    }
  };

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Call Handling"
      subtitle="Control business hours, fallback routing, greeting copy, and the voice callers hear."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save Call Handling', brand: true, onClick: saveState, disabled: saving }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Routing</h2>
            <label>Primary Queue</label>
            <select value={primaryQueue} onChange={(event) => setPrimaryQueue(event.target.value)}>
              <option>Dispatch Team</option>
              <option>Owner Only</option>
            </select>
            <label className="mt-2.5">Emergency Behavior</label>
            <select value={emergencyBehavior} onChange={(event) => setEmergencyBehavior(event.target.value)}>
              <option>Immediate Transfer</option>
              <option>Priority Queue</option>
            </select>
            <label className="mt-2.5">After Hours</label>
            <select value={afterHours} onChange={(event) => setAfterHours(event.target.value)}>
              <option>Collect details and dispatch callback</option>
              <option>Forward to on-call</option>
            </select>
            <label className="mt-2.5">Business Hours</label>
            <textarea value={businessHours} onChange={(event) => setBusinessHours(event.target.value)} />
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Greeting And Voice</h2>
            <label>Greeting</label>
            <textarea value={greetingText} onChange={(event) => setGreetingText(event.target.value)} />
            <label className="mt-2.5">Voice</label>
            <select value={voiceType} onChange={(event) => setVoiceType(event.target.value)}>
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" type="button" onClick={playSample}>Play Voice Sample</Button>
              <span className="text-sm text-slate-500">{sampleStatus}</span>
            </div>
            <audio ref={sampleAudioRef} preload="none" />
          </section>
        </div>

        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">What belongs here</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-500">
            <li>Who gets the call next when the agent needs to hand off.</li>
            <li>What to do after hours or when the situation is urgent.</li>
            <li>The greeting text and voice profile callers hear.</li>
            <li>Save routing and voice together so live behavior stays consistent.</li>
          </ul>
        </section>
      </div>
    </SectionPage>
  );
}

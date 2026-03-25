'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import SectionPage from '../../_components/SectionPage';
import GuidePanel from '../../_components/GuidePanel';
import { receptionistNavItems } from '../../_components/navigation';
import StepSection from '../../_components/StepSection';

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
      primaryAction={{ label: saving ? 'Saving...' : 'Save', brand: true, onClick: saveState, disabled: saving }}
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <StepSection
            step="01"
            title="Call Routing"
            description="Define who gets the handoff, how emergencies are treated, and what callers should expect outside business hours."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label>Primary Queue</label>
                <select value={primaryQueue} onChange={(event) => setPrimaryQueue(event.target.value)}>
                  <option>Dispatch Team</option>
                  <option>Owner Only</option>
                </select>
              </div>
              <div>
                <label>Emergency Behavior</label>
                <select value={emergencyBehavior} onChange={(event) => setEmergencyBehavior(event.target.value)}>
                  <option>Immediate Transfer</option>
                  <option>Priority Queue</option>
                </select>
              </div>
              <div>
                <label>Business Hours</label>
                <textarea value={businessHours} onChange={(event) => setBusinessHours(event.target.value)} />
              </div>
              <div>
                <label>After Hours Protocol</label>
                <select value={afterHours} onChange={(event) => setAfterHours(event.target.value)}>
                  <option>Collect details and dispatch callback</option>
                  <option>Forward to on-call</option>
                </select>
              </div>
            </div>
          </StepSection>

          <StepSection
            step="02"
            title="Greeting & Voice"
            description="Set the copy callers hear first and choose the voice profile used for live responses."
          >
            <div className="grid gap-3">
              <div>
                <label>Welcome Message</label>
                <textarea value={greetingText} onChange={(event) => setGreetingText(event.target.value)} />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <label>Voice Selection</label>
                  <select value={voiceType} onChange={(event) => setVoiceType(event.target.value)}>
                    {voiceOptions.map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </div>
                <Button variant="outline" type="button" onClick={playSample}>
                  Play Voice Sample
                </Button>
              </div>

              {sampleStatus ? <div className="text-sm text-slate-500">{sampleStatus}</div> : null}
              <audio ref={sampleAudioRef} preload="none" />
            </div>
          </StepSection>
        </div>

        <GuidePanel title="Call Handling Guide" eyebrow="Guide">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4f73a8]">What belongs here</div>
            <p className="mb-0 mt-2">
              Use this page for routing logic, business hours, after-hours behavior, greeting text, and caller voice settings.
            </p>
          </div>

          <div className="grid gap-3">
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">Call Routing</div>
              <div className="mt-1 text-sm text-slate-600">Choose the primary handoff path and how urgent or after-hours calls should behave.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">Greeting & Voice</div>
              <div className="mt-1 text-sm text-slate-600">Set the first line callers hear and the voice profile used during the conversation.</div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d6e4ff] bg-[#f5f8ff] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4f73a8]">Tip</div>
            <div className="mt-2 text-sm text-slate-600">Save routing and voice together so the live receptionist behavior stays consistent.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

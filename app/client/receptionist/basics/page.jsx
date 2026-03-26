'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';
import StepSection from '../../_components/StepSection';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

const voiceOptions = [
  { value: 'alloy', label: 'Alloy', description: 'Balanced' },
  { value: 'ash', label: 'Ash', description: 'Clear' },
  { value: 'ballad', label: 'Ballad', description: 'Warm' },
  { value: 'coral', label: 'Coral', description: 'Expressive' },
  { value: 'echo', label: 'Echo', description: 'Conversational' },
  { value: 'sage', label: 'Sage', description: 'Calm' },
  { value: 'shimmer', label: 'Shimmer', description: 'Bright' },
  { value: 'verse', label: 'Verse', description: 'Animated' },
  { value: 'marin', label: 'Marin', description: 'Best Quality' },
  { value: 'cedar', label: 'Cedar', description: 'Best Quality' }
];

const guideByStep = {
  '01': {
    title: 'Identity',
    body: 'Set the assistant and business names callers hear so the sales receptionist always speaks in the right voice for your company.',
    tip: 'Use the exact business name your callers already recognize.'
  },
  '02': {
    title: 'Greeting',
    body: 'Set the first sentence callers hear before the receptionist begins gathering details.',
    tip: 'Keep the greeting short so callers quickly know they reached the right business.'
  },
  '03': {
    title: 'Call Routing',
    body: 'Set business hours, emergency behavior, and after-hours handling so callers are routed the right way during each operating state.',
    tip: 'Match these settings to what your team can actually support after hours.'
  },
  '04': {
    title: 'Voice Selection',
    body: 'Choose the live voice callers hear during the conversation and test it before saving.',
    tip: 'Pick the voice that best matches your business tone and pace.'
  }
};

export default function ReceptionistBasicsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading sales receptionist basics...', tone: 'warn' });
  const [sampleStatus, setSampleStatus] = useState('');
  const [activeStep, setActiveStep] = useState('01');
  const [form, setForm] = useState({
    assistantName: '',
    businessName: '',
    companyDescription: '',
    openingLine: '',
    primaryQueue: 'Dispatch Team',
    emergencyBehavior: 'Immediate Transfer',
    afterHours: 'Collect details and dispatch callback',
    businessHours: 'Mon-Fri 7:00 AM - 8:00 PM',
    voiceType: 'marin'
  });

  const sampleAudioRef = useRef(null);
  const sampleUrlRef = useRef('');

  const loadBasics = async () => {
    setLoading(true);
    setStatus({ message: 'Loading sales receptionist basics...', tone: 'warn' });
    try {
      const [profileData, routingData, runtimeData] = await Promise.all([
        fetchJson('/api/v1/knowledge/prompt-profile'),
        fetchJson('/api/v1/routing'),
        fetchJson('/api/v1/knowledge/runtime-profile')
      ]);
      const profile = profileData?.profile || null;
      const routing = routingData?.routing || null;
      const runtimeProfile = runtimeData?.profile || null;
      setForm({
        assistantName: profile?.assistant_name || '',
        businessName: profile?.business_name || '',
        companyDescription: profile?.company_description || '',
        openingLine: profile?.opening_line || '',
        primaryQueue: routing?.primary_queue || 'Dispatch Team',
        emergencyBehavior: routing?.emergency_behavior || 'Immediate Transfer',
        afterHours: routing?.after_hours_behavior || 'Collect details and dispatch callback',
        businessHours: routing?.business_hours || 'Mon-Fri 7:00 AM - 8:00 PM',
        voiceType: runtimeProfile?.session_config?.voice || 'marin'
      });
      setStatus({ message: 'Sales receptionist basics loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load sales receptionist basics.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBasics();
    return () => {
      if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    };
  }, []);

  const saveBasics = async () => {
    setSaving(true);
    setStatus({ message: 'Saving sales receptionist basics...', tone: 'warn' });
    try {
      const [profileResp, routingResp, runtimeResp] = await Promise.all([
        fetchJson('/api/v1/knowledge/prompt-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: {
              assistantName: form.assistantName,
              businessName: form.businessName,
              companyDescription: form.companyDescription,
              openingLine: form.openingLine
            }
          })
        }),
        fetchJson('/api/v1/routing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryQueue: form.primaryQueue,
            emergencyBehavior: form.emergencyBehavior,
            afterHoursBehavior: form.afterHours,
            businessHours: form.businessHours
          })
        }),
        fetchJson('/api/v1/knowledge/runtime-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: {
              greetingText: form.openingLine,
              sessionConfig: {
                voice: form.voiceType
              }
            }
          })
        })
      ]);
      if (!profileResp?.ok || !routingResp?.ok || !runtimeResp?.ok) {
        setStatus({ message: 'Could not save sales receptionist basics.', tone: 'bad' });
        return;
      }
      setStatus({ message: 'Sales receptionist basics saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save sales receptionist basics.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const playSample = async () => {
    setSampleStatus('Loading sample...');
    try {
      const resp = await fetch(`/api/v1/voice/sample?voice=${encodeURIComponent(form.voiceType)}`);
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

  const activeGuide = guideByStep[activeStep] || guideByStep['01'];
  const activeCardClassName = 'ring-2 ring-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.05)]';

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Basics"
      subtitle="Set the business identity, greeting, routing, and voice used by your sales receptionist."
      status={status}
      statusChip={{ tone: 'ok', label: 'Sales Receptionist Active' }}
      primaryAction={{ label: saving ? 'Saving...' : 'Save', brand: true, onClick: saveBasics, disabled: saving || loading }}
    >
      <div className="grid grid-cols-1 gap-4 pb-[288px] xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <div onClick={() => setActiveStep('01')} onFocusCapture={() => setActiveStep('01')}>
            <StepSection
              step="01"
              title="Identity"
              description="Define the business identity the receptionist speaks from when answering calls."
              contentClassName={activeStep === '01' ? activeCardClassName : ''}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label>Assistant Name</label>
                  <input
                    value={form.assistantName}
                    onChange={(event) => setForm((current) => ({ ...current, assistantName: event.target.value }))}
                    placeholder="EveryCall"
                  />
                </div>
                <div>
                  <label>Business Name</label>
                  <input
                    value={form.businessName}
                    onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
                    placeholder="Harts Services"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label>Company Description</label>
                <textarea
                  value={form.companyDescription}
                  onChange={(event) => setForm((current) => ({ ...current, companyDescription: event.target.value }))}
                  style={{ minHeight: 72 }}
                  placeholder="Briefly describe the business, service area, and what callers usually need help with."
                />
              </div>
            </StepSection>
          </div>

          <div onClick={() => setActiveStep('02')} onFocusCapture={() => setActiveStep('02')}>
            <StepSection
              step="02"
              title="Greeting"
              description="Set the first sentence callers hear before the receptionist begins gathering details."
              contentClassName={activeStep === '02' ? activeCardClassName : ''}
            >
              <label>Greeting</label>
              <textarea
                value={form.openingLine}
                onChange={(event) => setForm((current) => ({ ...current, openingLine: event.target.value }))}
                style={{ minHeight: 72 }}
                placeholder="Thanks for calling..."
              />
            </StepSection>
          </div>

          <div onClick={() => setActiveStep('03')} onFocusCapture={() => setActiveStep('03')}>
            <StepSection
              step="03"
              title="Call Routing"
              description="Define who gets the handoff, how emergencies are treated, and what callers should expect outside business hours."
              contentClassName={activeStep === '03' ? activeCardClassName : ''}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label>Primary Queue</label>
                  <select value={form.primaryQueue} onChange={(event) => setForm((current) => ({ ...current, primaryQueue: event.target.value }))}>
                    <option>Dispatch Team</option>
                    <option>Owner Only</option>
                  </select>
                </div>
                <div>
                  <label>Emergency Behavior</label>
                  <select value={form.emergencyBehavior} onChange={(event) => setForm((current) => ({ ...current, emergencyBehavior: event.target.value }))}>
                    <option>Immediate Transfer</option>
                    <option>Priority Queue</option>
                  </select>
                </div>
                <div>
                  <label>Business Hours</label>
                  <input value={form.businessHours} onChange={(event) => setForm((current) => ({ ...current, businessHours: event.target.value }))} />
                </div>
                <div>
                  <label>After Hours Protocol</label>
                  <select value={form.afterHours} onChange={(event) => setForm((current) => ({ ...current, afterHours: event.target.value }))}>
                    <option>Collect details and dispatch callback</option>
                    <option>Forward to on-call</option>
                  </select>
                </div>
              </div>
            </StepSection>
          </div>

          <div onClick={() => setActiveStep('04')} onFocusCapture={() => setActiveStep('04')}>
            <StepSection
              step="04"
              title="Voice Selection"
              description="Choose the voice profile used for live responses and test it before saving."
              contentClassName={activeStep === '04' ? activeCardClassName : ''}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <label>Voice Selection</label>
                  <select value={form.voiceType} onChange={(event) => setForm((current) => ({ ...current, voiceType: event.target.value }))}>
                    {voiceOptions.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label} ({voice.description})</option>
                    ))}
                  </select>
                </div>
                <Button variant="outline" type="button" onClick={playSample}>
                  Play Voice Sample
                </Button>
              </div>

              {sampleStatus ? <div className="mt-3 text-sm text-slate-500">{sampleStatus}</div> : null}
              <audio ref={sampleAudioRef} preload="none" />

              <div className="mt-4 flex gap-2">
                <Button onClick={saveBasics} disabled={saving || loading}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" onClick={loadBasics} disabled={saving}>
                  Reload
                </Button>
              </div>
            </StepSection>
          </div>
        </div>

        <GuidePanel title="Basics Guide" eyebrow={`Step ${activeStep}`} icon="person_4">
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">{activeGuide.title}</div>
            <div className="mt-1 text-sm text-slate-600">{activeGuide.body}</div>
          </div>
          <div className="rounded-2xl border border-[#d6e4ff] bg-[#f5f8ff] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#004ac6]">Tip</div>
            <div className="mt-2 text-sm italic text-slate-600">{activeGuide.tip}</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

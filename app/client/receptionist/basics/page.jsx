'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SalesReceptionistNumberBadge from '../../_components/SalesReceptionistNumberBadge';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';
import StepSection from '../../_components/StepSection';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

function isInteractiveGuideTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, a, label, [role="button"]'));
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

const guideByContext = {
  assistantName: {
    step: '01',
    title: 'Assistant Name',
    body: 'This is the name the sales receptionist uses for itself when speaking to callers.',
    tip: 'Keep it short and easy to understand on the phone.'
  },
  businessName: {
    step: '01',
    title: 'Business Name',
    body: 'This is the company name callers should hear during the conversation.',
    tip: 'Use the exact business name your callers already recognize.'
  },
  companyDescription: {
    step: '01',
    title: 'Company Description',
    body: 'This helps the sales receptionist understand what the business does, who it serves, and the kinds of calls it should expect.',
    tip: 'Keep it factual and concise so the receptionist stays grounded in the right context.'
  },
  businessHours: {
    step: '01',
    title: 'Business Hours',
    body: 'These hours tell the sales receptionist when the business is considered open versus after hours.',
    tip: 'Match this to the real schedule your team can support.'
  },
  greeting: {
    step: '02',
    title: 'Greeting',
    body: 'This is the first line callers hear before the receptionist starts collecting information.',
    tip: 'Keep the greeting short so callers quickly know they reached the right business.'
  },
  primaryQueue: {
    step: '03',
    title: 'Primary Queue',
    body: 'This sets the normal handoff path when a live transfer or follow-up should go to your main team.',
    tip: 'Choose the team or destination that should own most incoming calls.'
  },
  emergencyBehavior: {
    step: '03',
    title: 'Emergency Behavior',
    body: 'This tells the receptionist how to treat urgent calls that need faster handling than a normal lead.',
    tip: 'Use the most reliable path your business can actually support in urgent situations.'
  },
  afterHours: {
    step: '03',
    title: 'After Hours Protocol',
    body: 'This controls what the receptionist should do when callers reach you outside normal business hours.',
    tip: 'Set an after-hours path that matches your real callback or on-call process.'
  },
  voiceSelection: {
    step: '04',
    title: 'Voice Selection',
    body: 'This chooses the live voice the sales receptionist uses during calls.',
    tip: 'Pick the voice that best matches your business tone and pace.'
  },
  voiceSample: {
    step: '04',
    title: 'Voice Sample',
    body: 'Play a short sample to hear the currently selected voice before saving it to the live runtime profile.',
    tip: 'Test the voice before saving so the live experience matches your expectations.'
  }
};

export default function ReceptionistBasicsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading sales receptionist basics...', tone: 'warn' });
  const [sampleStatus, setSampleStatus] = useState('');
  const [activeGuideKey, setActiveGuideKey] = useState('assistantName');
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
    const greetingText = String(form.openingLine || '').trim();
    if (!greetingText) {
      setSampleStatus('Add a greeting first.');
      return;
    }
    setSampleStatus('Loading sample...');
    try {
      const resp = await fetch('/api/v1/voice/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice: form.voiceType,
          text: greetingText
        })
      });
      const samplePath = resp.headers.get('X-EveryCall-Voice-Sample-Path');
      const sampleModel = resp.headers.get('X-EveryCall-Voice-Sample-Model');
      const sampleVoice = resp.headers.get('X-EveryCall-Voice-Sample-Voice');
      const sampleFormat = resp.headers.get('X-EveryCall-Voice-Sample-Format');
      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        if (typeof window !== 'undefined') {
          const errorLines = ['Voice sample failed.'];
          if (errorText) errorLines.push(`Server response: ${errorText.slice(0, 240)}`);
          window.alert(errorLines.join('\n'));
        }
        setSampleStatus('Sample failed.');
        return;
      }
      if (typeof window !== 'undefined') {
        const diagnosticLines = [
          'Voice sample diagnostics:',
          `Path: ${samplePath || 'unknown'}`,
          `Model: ${sampleModel || 'unknown'}`,
          `Voice: ${sampleVoice || form.voiceType}`,
          `Format: ${sampleFormat || 'unknown'}`
        ];
        window.alert(diagnosticLines.join('\n'));
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

  const activeGuide = guideByContext[activeGuideKey] || guideByContext.assistantName;
  const activeStep = activeGuide.step || '01';
  const activeCardClassName = 'ring-2 ring-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.05)]';

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Basics"
      subtitle="Set the business identity, greeting, routing, and voice used by your sales receptionist."
      status={status}
      statusChip={{ tone: 'ok', label: 'Sales Receptionist Active' }}
      headerAside={<SalesReceptionistNumberBadge />}
    >
      <div className="grid grid-cols-1 gap-4 pb-[288px] xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <div onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('assistantName');
          }}>
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
                    onFocus={() => setActiveGuideKey('assistantName')}
                    placeholder="EveryCall"
                  />
                </div>
                <div>
                  <label>Business Name</label>
                  <input
                    value={form.businessName}
                    onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
                    onFocus={() => setActiveGuideKey('businessName')}
                    placeholder="Harts Services"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label>Company Description</label>
                <textarea
                  value={form.companyDescription}
                  onChange={(event) => setForm((current) => ({ ...current, companyDescription: event.target.value }))}
                  onFocus={() => setActiveGuideKey('companyDescription')}
                  style={{ minHeight: 72 }}
                  placeholder="Briefly describe the business, service area, and what callers usually need help with."
                />
              </div>

              <div className="mt-3">
                <label>Business Hours</label>
                <input
                  value={form.businessHours}
                  onChange={(event) => setForm((current) => ({ ...current, businessHours: event.target.value }))}
                  onFocus={() => setActiveGuideKey('businessHours')}
                />
              </div>
            </StepSection>
          </div>

          <div className="mt-12" onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('greeting');
          }}>
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
                onFocus={() => setActiveGuideKey('greeting')}
                style={{ minHeight: 72 }}
                placeholder="Thanks for calling..."
              />
            </StepSection>
          </div>

          <div className="mt-12" onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('primaryQueue');
          }}>
            <StepSection
              step="03"
              title="Call Routing"
              description="Define who gets the handoff, how emergencies are treated, and what callers should expect outside business hours."
              contentClassName={activeStep === '03' ? activeCardClassName : ''}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label>Primary Queue</label>
                  <select
                    value={form.primaryQueue}
                    onChange={(event) => setForm((current) => ({ ...current, primaryQueue: event.target.value }))}
                    onFocus={() => setActiveGuideKey('primaryQueue')}
                  >
                    <option>Dispatch Team</option>
                    <option>Owner Only</option>
                  </select>
                </div>
                <div>
                  <label>Emergency Behavior</label>
                  <select
                    value={form.emergencyBehavior}
                    onChange={(event) => setForm((current) => ({ ...current, emergencyBehavior: event.target.value }))}
                    onFocus={() => setActiveGuideKey('emergencyBehavior')}
                  >
                    <option>Immediate Transfer</option>
                    <option>Priority Queue</option>
                  </select>
                </div>
                <div>
                  <label>After Hours Protocol</label>
                  <select
                    value={form.afterHours}
                    onChange={(event) => setForm((current) => ({ ...current, afterHours: event.target.value }))}
                    onFocus={() => setActiveGuideKey('afterHours')}
                  >
                    <option>Collect details and dispatch callback</option>
                    <option>Forward to on-call</option>
                  </select>
                </div>
              </div>
            </StepSection>
          </div>

          <div className="mt-12" onClick={(event) => {
            if (isInteractiveGuideTarget(event.target)) return;
            setActiveGuideKey('voiceSelection');
          }}>
            <StepSection
              step="04"
              title="Voice Selection"
              description="Choose the voice profile used for live responses and test it before saving."
              contentClassName={activeStep === '04' ? activeCardClassName : ''}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <label>Voice Selection</label>
                  <select
                    value={form.voiceType}
                    onChange={(event) => setForm((current) => ({ ...current, voiceType: event.target.value }))}
                    onFocus={() => setActiveGuideKey('voiceSelection')}
                  >
                    {voiceOptions.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label} ({voice.description})</option>
                    ))}
                  </select>
                </div>
                <Button variant="outline" type="button" onClick={playSample} onFocus={() => setActiveGuideKey('voiceSample')}>
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

        <GuidePanel
          title="Basics Guide"
          eyebrow={`Step ${activeStep}`}
          icon="person_4"
          className="self-start xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto"
        >
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

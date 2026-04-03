'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SalesReceptionistNumberHeaderAside from '../../_components/SalesReceptionistNumberHeaderAside';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';
import StepSection from '../../_components/StepSection';
import {
  BUSINESS_HOURS_DAY_LABELS,
  createBusinessHoursConfig
} from '../../../../lib/businessHours';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

function isInteractiveGuideTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, a, label, [role="button"]'));
}

function buildDocumentPendingState({ approvedDocuments = [], latestLiveBuild = null } = {}) {
  const appliedDocumentIds = new Set(
    Array.isArray(latestLiveBuild?.intake_metadata_json?.uploaded_document_ids)
      ? latestLiveBuild.intake_metadata_json.uploaded_document_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : []
  );
  const approvedDocumentIds = new Set(
    approvedDocuments
      .map((document) => String(document?.uploaded_document_id || '').trim())
      .filter(Boolean)
  );
  const pendingApprovedDocuments = approvedDocuments.filter((document) => !appliedDocumentIds.has(String(document?.uploaded_document_id || '').trim()));
  const removedLiveDocumentIds = Array.from(appliedDocumentIds).filter((id) => !approvedDocumentIds.has(id));
  return {
    hasPendingChanges: pendingApprovedDocuments.length > 0 || removedLiveDocumentIds.length > 0
  };
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
  businessPhone: {
    step: '01',
    title: 'Business Phone',
    body: 'This is the business’s main public phone number, separate from the Sales Receptionist Number that EveryCall provisions.',
    tip: 'Use the normal business line your callers already know or see on your website.'
  },
  salesReceptionistNumber: {
    step: '01',
    title: 'Sales Receptionist Number',
    body: 'This is the EveryCall phone number your AI sales receptionist answers live. Your business phone system should forward callers to this number when you want EveryCall to pick up the call.',
    tip: 'Set this number as the forwarding destination in your phone system so inbound callers reach the sales receptionist.'
  },
  businessHours: {
    step: '01',
    title: 'Business Hours',
    body: 'Set the weekly hours that define when calls count as business hours versus after hours.',
    tip: 'Keep this aligned with the real hours your team can actually support.'
  },
  greeting: {
    step: '02',
    title: 'Greeting',
    body: 'This is the first line callers hear before the receptionist starts collecting information.',
    tip: 'Keep the greeting short so callers quickly know they reached the right business.'
  },
  voiceSelection: {
    step: '03',
    title: 'Voice Selection',
    body: 'This chooses the live voice the sales receptionist uses during calls.',
    tip: 'Pick the voice that best matches your business tone and pace.'
  },
  voiceSample: {
    step: '03',
    title: 'Voice Sample',
    body: 'Play a short sample to hear the currently selected voice before saving it to the live runtime profile.',
    tip: 'Test the voice before saving so the live experience matches your expectations.'
  }
};

const basicsGuideOverview = {
  title: 'What This Page Does',
  body: 'This page sets the business identity, main business phone, greeting, and voice your sales receptionist uses every time it answers a call.',
  detail: 'These basics help callers know they reached the right business and shape how the receptionist sounds before deeper business knowledge is added on the Knowledge page.'
};

export default function ReceptionistBasicsPage() {
  const defaultHoursConfig = createBusinessHoursConfig({ timezone: 'America/Los_Angeles' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading sales receptionist basics...', tone: 'warn' });
  const [knowledgeStatusChip, setKnowledgeStatusChip] = useState({ tone: 'ok', label: 'Sales Receptionist Active' });
  const [sampleStatus, setSampleStatus] = useState('');
  const [activeGuideKey, setActiveGuideKey] = useState('assistantName');
  const [form, setForm] = useState({
    assistantName: '',
    businessName: '',
    companyDescription: '',
    businessPhone: '',
    openingLine: '',
    primaryQueue: 'Dispatch Team',
    emergencyBehavior: 'Immediate Transfer',
    afterHours: 'Collect details and dispatch callback',
    businessHoursConfig: defaultHoursConfig,
    voiceType: 'marin'
  });

  const sampleAudioRef = useRef(null);
  const sampleUrlRef = useRef('');
  const guidePanelRef = useRef(null);

  const loadBasics = async () => {
    setLoading(true);
    setStatus({ message: 'Loading sales receptionist basics...', tone: 'warn' });
    try {
      const [profileData, routingData, runtimeData, settingsData, buildData, documentData] = await Promise.all([
        fetchJson('/api/v1/knowledge/prompt-profile'),
        fetchJson('/api/v1/routing'),
        fetchJson('/api/v1/knowledge/runtime-profile'),
        fetchJson('/api/v1/settings'),
        fetchJson('/api/v1/knowledge/builds'),
        fetchJson('/api/v1/knowledge/uploaded-documents')
      ]);
      const profile = profileData?.profile || null;
      const routing = routingData?.routing || null;
      const runtimeProfile = runtimeData?.profile || null;
      const timezone = settingsData?.settings?.timezone || 'America/Los_Angeles';
      setForm({
        assistantName: profile?.assistant_name || '',
        businessName: profile?.business_name || '',
        companyDescription: profile?.company_description || '',
        businessPhone: settingsData?.tenant?.primary_number || '',
        openingLine: profile?.opening_line || '',
        primaryQueue: routing?.primary_queue || 'Dispatch Team',
        emergencyBehavior: routing?.emergency_behavior || 'Immediate Transfer',
        afterHours: routing?.after_hours_behavior || 'Collect details and dispatch callback',
        businessHoursConfig: createBusinessHoursConfig(
          routing?.business_hours_config || { businessHours: routing?.business_hours || '', timezone },
          timezone
        ),
        voiceType: runtimeProfile?.session_config?.voice || 'marin'
      });
      const builds = Array.isArray(buildData?.builds) ? buildData.builds : [];
      const activeBuildId = String(buildData?.activeBuild?.active_build_id || '').trim();
      const latestLiveBuild = builds.find((build) => String(build?.build_id || '').trim() === activeBuildId) || builds[0] || null;
      const approvedDocuments = Array.isArray(documentData?.documents)
        ? documentData.documents.filter((document) => String(document?.status || '').trim() === 'approved')
        : [];
      const hasPendingDocumentChanges = buildDocumentPendingState({
        approvedDocuments,
        latestLiveBuild
      }).hasPendingChanges;
      setKnowledgeStatusChip(
        hasPendingDocumentChanges
          ? { tone: 'warn', label: 'Documents Pending' }
          : { tone: 'ok', label: 'Sales Receptionist Active' }
      );
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
      const [profileResp, routingResp, runtimeResp, settingsResp] = await Promise.all([
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
            businessHoursConfig: form.businessHoursConfig
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
        }),
        fetchJson('/api/v1/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryNumber: form.businessPhone
          })
        })
      ]);
      if (!profileResp?.ok || !routingResp?.ok || !runtimeResp?.ok || !settingsResp?.ok) {
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

  const activeGuide = guideByContext[activeGuideKey] || guideByContext.assistantName;
  const activeStep = activeGuide.step || '01';
  const activeCardClassName = 'ring-2 ring-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.05)]';
  const businessHoursConfig = createBusinessHoursConfig(form.businessHoursConfig || defaultHoursConfig, defaultHoursConfig.timezone);
  const updateBusinessHoursDay = (day, patch) => {
    setForm((current) => {
      const currentConfig = createBusinessHoursConfig(current.businessHoursConfig || defaultHoursConfig, defaultHoursConfig.timezone);
      const weeklyHours = currentConfig.weeklyHours.map((row) => (
        row.day === day ? { ...row, ...patch } : row
      ));
      return {
        ...current,
        businessHoursConfig: createBusinessHoursConfig({
          ...currentConfig,
          weeklyHours
        }, currentConfig.timezone)
      };
    });
  };
  const openSalesReceptionistNumberGuide = () => {
    setActiveGuideKey('salesReceptionistNumber');
    guidePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Basics"
      subtitle="Set the business identity, greeting, and voice used by your sales receptionist."
      status={status}
      statusChip={knowledgeStatusChip}
      headerAside={<SalesReceptionistNumberHeaderAside onHelpClick={openSalesReceptionistNumberGuide} />}
    >
      <div className="grid grid-cols-1 items-start gap-4 pb-[288px] xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 gap-3">
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
                <label>Business Phone</label>
                <input
                  type="tel"
                  value={form.businessPhone}
                  onChange={(event) => setForm((current) => ({ ...current, businessPhone: event.target.value }))}
                  onFocus={() => setActiveGuideKey('businessPhone')}
                  placeholder="(555) 000-0000"
                />
              </div>

              <div className="mt-3">
                <label>Business Hours</label>
                <div
                  className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white"
                  onFocus={() => setActiveGuideKey('businessHours')}
                >
                  {businessHoursConfig.weeklyHours.map((row) => (
                    <div key={row.day} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[72px_110px_minmax(0,1fr)]">
                      <div className="text-sm font-semibold text-slate-900">{BUSINESS_HOURS_DAY_LABELS[row.day] || row.day}</div>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                        <input
                          checked={Boolean(row.enabled)}
                          type="checkbox"
                          onChange={(event) => updateBusinessHoursDay(row.day, { enabled: event.target.checked })}
                        />
                        Open
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="time"
                          value={row.openTime === '24:00' ? '23:59' : row.openTime}
                          disabled={!row.enabled}
                          onChange={(event) => updateBusinessHoursDay(row.day, { openTime: event.target.value })}
                        />
                        <input
                          type="time"
                          value={row.closeTime === '24:00' ? '23:59' : row.closeTime}
                          disabled={!row.enabled}
                          onChange={(event) => updateBusinessHoursDay(row.day, { closeTime: event.target.value })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Times use your local time zone set in Account.
                </div>
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
            setActiveGuideKey('voiceSelection');
          }}>
            <StepSection
              step="03"
              title="Voice Selection"
              description="Choose the voice profile used for live responses and test it before saving."
              contentClassName={activeStep === '03' ? activeCardClassName : ''}
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

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Next Steps</h2>
            <p className="m-0 mt-2 text-sm text-slate-600">
              Once the business identity, greeting, and voice feel right, move into Knowledge so the Sales Receptionist can answer specific business questions more confidently.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/client/receptionist/knowledge" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_rgba(0,74,198,0.16)]">
                Open Knowledge
              </Link>
              <Link href="/client/team" className="inline-flex rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
                Open Users
              </Link>
            </div>
          </section>
        </div>

        <div ref={guidePanelRef}>
          <GuidePanel
            title="Basics Guide"
            eyebrow=""
            icon="person_4"
            className="self-start xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto"
          >
            <div className="rounded-2xl border border-[#d6e4ff] bg-[#f5f8ff] p-3">
              <div className="font-semibold text-slate-900">{basicsGuideOverview.title}</div>
              <div className="mt-1 text-sm text-slate-600">{basicsGuideOverview.body}</div>
              <div className="mt-2 text-sm text-slate-600">{basicsGuideOverview.detail}</div>
            </div>
            <div className="text-[11px] font-extrabold normal-case tracking-normal text-slate-500">{`Step ${activeStep}`}</div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">{activeGuide.title}</div>
              <div className="mt-1 text-sm text-slate-600">{activeGuide.body}</div>
            </div>
            <div className="rounded-2xl border border-[#d6e4ff] bg-[#f5f8ff] p-3">
              <div className="text-[11px] font-semibold normal-case tracking-normal text-[#004ac6]">Tip</div>
              <div className="mt-2 text-sm italic text-slate-600">{activeGuide.tip}</div>
            </div>
          </GuidePanel>
        </div>
      </div>
    </SectionPage>
  );
}

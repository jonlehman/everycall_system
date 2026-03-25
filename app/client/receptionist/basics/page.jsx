'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';
import StepSection from '../../_components/StepSection';

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export default function ReceptionistBasicsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading receptionist basics...', tone: 'warn' });
  const [form, setForm] = useState({
    assistantName: '',
    businessName: '',
    companyDescription: '',
    openingLine: ''
  });

  const loadProfile = async () => {
    setLoading(true);
    setStatus({ message: 'Loading receptionist basics...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/prompt-profile');
      const profile = data?.profile || null;
      setForm({
        assistantName: profile?.assistant_name || '',
        businessName: profile?.business_name || '',
        companyDescription: profile?.company_description || '',
        openingLine: profile?.opening_line || ''
      });
      setStatus({ message: 'Receptionist basics loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load receptionist basics.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    setStatus({ message: 'Saving receptionist basics...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/prompt-profile', {
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
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not save receptionist basics.', tone: 'bad' });
        return;
      }
      setStatus({ message: 'Receptionist basics saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save receptionist basics.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Receptionist Basics"
      subtitle="Set the business-facing identity and opening copy for your call receptionist."
      status={status}
      statusChip={{ tone: 'ok', label: 'Receptionist Identity Active' }}
      primaryAction={{ label: saving ? 'Saving...' : 'Save', brand: true, onClick: saveProfile, disabled: saving || loading }}
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[7fr_3fr]">
        <div className="grid gap-3">
          <StepSection
            step="01"
            title="Identity"
            description="Define the business identity the receptionist speaks from when answering calls."
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
                style={{ minHeight: 120 }}
                placeholder="Briefly describe the business, service area, and what callers usually need help with."
              />
            </div>
          </StepSection>

          <StepSection
            step="02"
            title="Opening Line"
            description="Set the first sentence callers hear before the receptionist begins gathering details."
          >
            <label>Opening Line</label>
            <textarea
              value={form.openingLine}
              onChange={(event) => setForm((current) => ({ ...current, openingLine: event.target.value }))}
              placeholder="Thanks for calling..."
            />

            <div className="mt-3 flex gap-2">
              <Button onClick={saveProfile} disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={loadProfile} disabled={saving}>
                Reload
              </Button>
            </div>
          </StepSection>
        </div>

        <GuidePanel title="Basics Guide" eyebrow="What belongs here?" icon="person_4">
          <p className="mb-0">
            Use Basics for the name, business framing, and opening copy the receptionist uses when answering calls.
          </p>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Use Call Handling for</div>
            <div className="mt-1 text-sm text-slate-600">Business hours, routing behavior, emergency logic, after-hours behavior, and voice selection.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

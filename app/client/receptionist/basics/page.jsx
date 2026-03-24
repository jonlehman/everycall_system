'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';

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
      primaryAction={{ label: saving ? 'Saving...' : 'Save Basics', brand: true, onClick: saveProfile, disabled: saving || loading }}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Presentation</h2>
          <div className="text-sm text-slate-600">
            These are the tenant-controlled identity fields the phone agent speaks from. Routing rules and advanced tool policy stay elsewhere.
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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

          <label className="mt-2.5">Company Description</label>
          <textarea
            value={form.companyDescription}
            onChange={(event) => setForm((current) => ({ ...current, companyDescription: event.target.value }))}
            style={{ minHeight: 120 }}
            placeholder="Briefly describe the business, service area, and what callers usually need help with."
          />

          <label className="mt-2.5">Opening Line</label>
          <textarea
            value={form.openingLine}
            onChange={(event) => setForm((current) => ({ ...current, openingLine: event.target.value }))}
            placeholder="Thanks for calling..."
          />

          <div className="mt-3 flex gap-2">
            <Button onClick={saveProfile} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save Basics'}
            </Button>
            <Button variant="outline" onClick={loadProfile} disabled={saving}>
              Reload
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">What belongs here</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-500">
            <li>Assistant name and business name spoken to callers.</li>
            <li>Business description used to frame answers and lead collection.</li>
            <li>The main greeting line the caller hears first.</li>
            <li>Use Call Handling for routing, hours, and voice.</li>
          </ul>
        </div>
      </div>
    </SectionPage>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '../../../../components/ui/button';
import { formatPhoneDisplay } from '../../../../lib/phoneDisplay';
import SalesReceptionistNumberBadge from '../../_components/SalesReceptionistNumberBadge';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';

function buildClientChecklistFields(phoneNumber) {
  const formattedPhoneNumber = formatPhoneDisplay(phoneNumber) || 'your Sales Receptionist Number';
  return [
  {
    key: 'hours_confirmed',
    label: 'Business hours confirmed',
    hint: 'Confirm the hours in Basics are current.'
  },
  {
    key: 'address_confirmed',
    label: 'Business address confirmed',
    hint: 'Confirm the business address callers should reference.'
  },
  {
    key: 'service_area_confirmed',
    label: 'Service area confirmed',
    hint: 'Confirm the locations the business actively serves.'
  },
  {
    key: 'calls_forwarded_to_receptionist',
    label: 'Forward calls to Sales Receptionist Number',
    hint: `In your business's phone system, forward missed calls to ${formattedPhoneNumber}.`
  },
  {
    key: 'sample_calls_passed',
    label: 'Sample calls passed',
    hint: 'Run a few test calls and confirm the receptionist responds correctly.'
  },
  {
    key: 'handoff_path_tested',
    label: 'Handoff path tested',
    hint: 'Confirm urgent or escalated calls reach the right destination.'
  },
  {
    key: 'outcome_capture_tested',
    label: 'Lead capture tested',
    hint: 'Confirm name, callback number, and notes are saving correctly.'
  }
];
}

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

function formatStatusLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ready_for_go_live') return 'Active';
  if (normalized === 'live') return 'Launch Confirmed';
  if (normalized === 'in_progress') return 'In Progress';
  if (normalized === 'not_started') return 'Not Started';
  if (normalized === 'blocked') return 'Blocked';
  return normalized ? normalized.replaceAll('_', ' ') : 'Unknown';
}

function statusBadgeClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'live' || normalized === 'ready_for_go_live') return 'badge ok';
  if (normalized === 'blocked') return 'badge bad';
  return 'badge warn';
}

export default function LaunchReadinessPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading launch readiness...', tone: 'warn' });
  const [readiness, setReadiness] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [phoneNumber, setPhoneNumber] = useState('');

  const loadReadiness = async () => {
    setLoading(true);
    setStatus({ message: 'Loading launch readiness...', tone: 'warn' });
    try {
      const [readinessData, settingsData] = await Promise.all([
        fetchJson('/api/v1/knowledge/readiness'),
        fetchJson('/api/v1/settings')
      ]);
      if (!readinessData?.ok) {
        setStatus({ message: readinessData?.message || 'Could not load launch readiness.', tone: 'bad' });
        return;
      }
      setReadiness(readinessData.readiness || null);
      setChecklist(readinessData.readiness?.checklist || {});
      setPhoneNumber(String(settingsData?.tenant?.telnyx_voice_number || '').trim());
      setStatus({ message: 'Launch readiness loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load launch readiness.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReadiness();
  }, []);

  const saveChecklist = async () => {
    setSaving(true);
    setStatus({ message: 'Saving launch readiness...', tone: 'warn' });
    try {
      const payload = {
        checklist
      };
      const data = await fetchJson('/api/v1/knowledge/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not save launch readiness.', tone: 'bad' });
        return;
      }
      setReadiness(data.readiness || null);
      setChecklist(data.readiness?.checklist || {});
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('everycall:readiness-updated', { detail: data.readiness || null }));
      }
      setStatus({ message: 'Launch readiness saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save launch readiness.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const computedInputs = readiness?.computed_inputs || {};
  const readinessStatus = String(readiness?.status || '').trim().toLowerCase();
  const clientChecklistFields = useMemo(() => buildClientChecklistFields(phoneNumber), [phoneNumber]);
  const clientCompletionCount = useMemo(
    () => clientChecklistFields.filter(({ key }) => Boolean(checklist?.[key])).length,
    [checklist, clientChecklistFields]
  );
  const liveBuildSelected = Boolean(computedInputs.active_build_id)
    && computedInputs.active_build_id === computedInputs.latest_build_id;
  const latestBuildPublished = computedInputs.latest_build_status === 'published';

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Go Live Checklist"
      subtitle="Complete the client checklist and confirm the live knowledge build before launch."
      status={status}
      headerAside={<SalesReceptionistNumberBadge />}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Launch Status</div>
          <div className="mt-2">
            <span className={statusBadgeClass(readiness?.status)}>{formatStatusLabel(readiness?.status)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Client Checklist</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{clientCompletionCount}/{clientChecklistFields.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Knowledge Runtime</div>
          <div className="mt-2">
            <span className={latestBuildPublished && liveBuildSelected ? 'badge ok' : 'badge warn'}>
              {latestBuildPublished && liveBuildSelected ? 'live build published' : 'needs attention'}
            </span>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">Client Checklist</h2>
        <div className="text-sm text-slate-600">
          These are the client-side confirmations that still matter to the actual readiness engine.
        </div>
        <div className="mt-3 grid gap-2">
          {clientChecklistFields.map(({ key, label, hint }) => (
            <label key={key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(checklist?.[key])}
                  onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                />
                <div className="font-normal normal-case tracking-normal">
                  <div className="font-medium normal-case tracking-normal text-slate-900">{label}</div>
                  <div className="mt-1 text-sm font-normal normal-case tracking-normal text-slate-600">{hint}</div>
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => saveChecklist()} disabled={saving}>{saving ? 'Saving...' : 'Save Checklist'}</Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="m-0 text-lg font-semibold">Next Steps</h2>
        <p className="m-0 mt-2 text-sm text-slate-600">
          Once the checklist is green and the published build is the live runtime, keep an eye on Calls for the first live leads and use Integrations if those outcomes need to land in other systems.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/client/calls" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_rgba(0,74,198,0.16)]">
            Open Calls
          </Link>
          <Link href="/client/account/integrations" className="inline-flex rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
            Open Integrations
          </Link>
        </div>
      </section>
    </SectionPage>
  );
}

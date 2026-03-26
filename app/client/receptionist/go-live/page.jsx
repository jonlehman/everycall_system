'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button, buttonVariants } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';

const CLIENT_CHECKLIST_FIELDS = [
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
    key: 'phone_confirmed',
    label: 'Main business phone confirmed',
    hint: 'Confirm the primary callback number is correct.'
  },
  {
    key: 'after_hours_configured',
    label: 'After-hours plan confirmed',
    hint: 'Confirm the after-hours routing and callback plan.'
  },
  {
    key: 'service_area_confirmed',
    label: 'Service area confirmed',
    hint: 'Confirm the locations the business actively serves.'
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

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

function formatStatusLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ready_for_go_live') return 'Ready to Launch';
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
  const [buildState, setBuildState] = useState({ activeBuild: null, builds: [] });

  const loadReadiness = async () => {
    setLoading(true);
    setStatus({ message: 'Loading launch readiness...', tone: 'warn' });
    try {
      const [readinessData, buildData] = await Promise.all([
        fetchJson('/api/v1/knowledge/readiness'),
        fetchJson('/api/v1/knowledge/builds')
      ]);
      if (!readinessData?.ok) {
        setStatus({ message: readinessData?.message || 'Could not load launch readiness.', tone: 'bad' });
        return;
      }
      setReadiness(readinessData.readiness || null);
      setChecklist(readinessData.readiness?.checklist || {});
      setBuildState({
        activeBuild: buildData?.activeBuild || null,
        builds: buildData?.builds || []
      });
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

  const saveChecklist = async (requestedGoLive = undefined) => {
    setSaving(true);
    setStatus({ message: 'Saving launch readiness...', tone: 'warn' });
    try {
      const payload = {
        checklist,
        ...(requestedGoLive === undefined ? {} : { requestedGoLive })
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
      setStatus({ message: 'Launch readiness saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save launch readiness.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const computedInputs = readiness?.computed_inputs || {};
  const readinessStatus = String(readiness?.status || '').trim().toLowerCase();
  const latestBuild = buildState.builds[0] || null;
  const clientCompletionCount = useMemo(
    () => CLIENT_CHECKLIST_FIELDS.filter(({ key }) => Boolean(checklist?.[key])).length,
    [checklist]
  );
  const launchFlagSet = Boolean(readiness?.requested_go_live);
  const liveBuildSelected = Boolean(computedInputs.active_build_id)
    && computedInputs.active_build_id === computedInputs.latest_build_id;
  const latestBuildPublished = computedInputs.latest_build_status === 'published';
  const canMarkReady = readinessStatus === 'ready_for_go_live' && !launchFlagSet;

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Go Live Checklist"
      subtitle="Complete the client checklist and confirm the live knowledge build before launch."
      status={status}
      primaryAction={{ label: loading ? 'Loading...' : 'Reload', brand: true, onClick: loadReadiness, disabled: loading }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Launch Status</div>
          <div className="mt-2">
            <span className={statusBadgeClass(readiness?.status)}>{formatStatusLabel(readiness?.status)}</span>
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {launchFlagSet ? 'Ready flag is set for this tenant.' : 'Ready flag is not set yet.'}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Client Checklist</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{clientCompletionCount}/{CLIENT_CHECKLIST_FIELDS.length}</div>
          <div className="text-sm text-slate-600">Business confirmations and launch testing completed.</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Knowledge Runtime</div>
          <div className="mt-2">
            <span className={latestBuildPublished && liveBuildSelected ? 'badge ok' : 'badge warn'}>
              {latestBuildPublished && liveBuildSelected ? 'live build ready' : 'needs attention'}
            </span>
          </div>
          <div className="mt-2 text-sm text-slate-600">The latest published build should match the live runtime.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Client Checklist</h2>
          <div className="text-sm text-slate-600">
            These are the client-side confirmations that still matter to the actual readiness engine.
          </div>
          <div className="mt-3 grid gap-2">
            {CLIENT_CHECKLIST_FIELDS.map(({ key, label, hint }) => (
              <label key={key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(checklist?.[key])}
                    onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  <div>
                    <div className="font-medium text-slate-900">{label}</div>
                    <div className="mt-1 text-sm text-slate-600">{hint}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => saveChecklist()} disabled={saving}>{saving ? 'Saving...' : 'Save Checklist'}</Button>
            <Button variant="outline" onClick={() => saveChecklist(true)} disabled={saving || !canMarkReady}>
              Mark Ready
            </Button>
            {launchFlagSet ? (
              <Button variant="outline" onClick={() => saveChecklist(false)} disabled={saving}>
                Clear Ready Flag
              </Button>
            ) : null}
          </div>
          {!canMarkReady && !launchFlagSet ? (
            <div className="mt-2 text-sm text-slate-500">
              Mark Ready becomes available after all launch requirements are complete.
            </div>
          ) : null}
        </section>

        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Knowledge Runtime</h2>
            <div className="grid gap-2 text-sm text-slate-600">
              <div>Latest build status: <span className="font-medium text-slate-900">{latestBuild?.status || 'none'}</span></div>
              <div>Latest build published: <span className="font-medium text-slate-900">{latestBuildPublished ? 'Yes' : 'No'}</span></div>
              <div>Active build selected: <span className="font-medium text-slate-900">{computedInputs.active_build_id ? 'Yes' : 'No'}</span></div>
              <div>Latest build matches live runtime: <span className="font-medium text-slate-900">{liveBuildSelected ? 'Yes' : 'No'}</span></div>
            </div>
            <div className="mt-3">
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/receptionist/knowledge">
                Open Knowledge
              </Link>
            </div>
          </section>
        </div>
      </div>
    </SectionPage>
  );
}

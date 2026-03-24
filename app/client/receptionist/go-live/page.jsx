'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import SectionPage from '../../_components/SectionPage';
import { receptionistNavItems } from '../../_components/navigation';

const CHECKLIST_FIELDS = [
  ['hours_confirmed', 'Business hours confirmed'],
  ['address_confirmed', 'Address confirmed'],
  ['phone_confirmed', 'Phone number confirmed'],
  ['after_hours_configured', 'After-hours strategy configured'],
  ['service_area_confirmed', 'Service area confirmed'],
  ['dangerous_question_reviewed', 'Dangerous question guardrails reviewed'],
  ['hard_overrides_reviewed', 'Hard overrides reviewed'],
  ['temporary_notices_checked', 'Temporary notices checked'],
  ['approved_answer_snippets_reviewed', 'Approved answer snippets reviewed'],
  ['sample_calls_passed', 'Sample calls passed'],
  ['handoff_path_tested', 'Handoff path tested'],
  ['outcome_capture_tested', 'Outcome capture tested'],
  ['pack_eval_suites_passed', 'Pack eval suites passed']
];

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export default function GoLivePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading go-live checklist...', tone: 'warn' });
  const [readiness, setReadiness] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [buildState, setBuildState] = useState({ activeBuild: null, builds: [] });

  const loadReadiness = async () => {
    setLoading(true);
    setStatus({ message: 'Loading go-live checklist...', tone: 'warn' });
    try {
      const [readinessData, buildData] = await Promise.all([
        fetchJson('/api/v1/knowledge/readiness'),
        fetchJson('/api/v1/knowledge/builds')
      ]);
      if (!readinessData?.ok) {
        setStatus({ message: readinessData?.message || 'Could not load go-live readiness.', tone: 'bad' });
        return;
      }
      setReadiness(readinessData.readiness || null);
      setChecklist(readinessData.readiness?.checklist || {});
      setBuildState({
        activeBuild: buildData?.activeBuild || null,
        builds: buildData?.builds || []
      });
      setStatus({ message: 'Go-live checklist loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load go-live readiness.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReadiness();
  }, []);

  const saveChecklist = async (requestedGoLive = undefined) => {
    setSaving(true);
    setStatus({ message: 'Saving go-live checklist...', tone: 'warn' });
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
        setStatus({ message: data?.message || 'Could not save go-live readiness.', tone: 'bad' });
        return;
      }
      setReadiness(data.readiness || null);
      setChecklist(data.readiness?.checklist || {});
      setStatus({ message: 'Go-live readiness saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save go-live readiness.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const completionCount = useMemo(
    () => CHECKLIST_FIELDS.filter(([key]) => Boolean(checklist?.[key])).length,
    [checklist]
  );

  const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
  const latestBuild = buildState.builds[0] || null;

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Go Live"
      subtitle="Track readiness, confirm blockers are resolved, and request go-live review when the tenant is ready."
      status={status}
      primaryAction={{ label: loading ? 'Loading...' : 'Reload', brand: true, onClick: loadReadiness, disabled: loading }}
    >
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Readiness Status</div>
            <div className="text-2xl font-bold text-slate-900">{readiness?.status || 'not_started'}</div>
          </div>
          <div className="text-sm text-slate-600">{completionCount}/{CHECKLIST_FIELDS.length} checklist items complete</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Go-Live Inputs</h2>
          <div className="grid gap-2">
            {CHECKLIST_FIELDS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(checklist?.[key])}
                  onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => saveChecklist()} disabled={saving}>{saving ? 'Saving...' : 'Save Checklist'}</Button>
            <Button variant="outline" onClick={() => saveChecklist(true)} disabled={saving}>Request Go Live</Button>
          </div>
        </section>

        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Current Blockers</h2>
            {blockers.length ? (
              <ul className="list-disc pl-5 text-sm text-slate-600">
                {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : (
              <div className="text-sm text-emerald-700">No blockers. This tenant is ready for go live.</div>
            )}
            <div className="mt-4 text-xs uppercase tracking-wide text-slate-500">Review Mode</div>
            <div className="mt-1 text-sm text-slate-700">{readiness?.review_mode || 'immediate_save'}</div>
            <div className="mt-4 text-xs uppercase tracking-wide text-slate-500">Requested Go Live</div>
            <div className="mt-1 text-sm text-slate-700">{readiness?.requested_go_live ? 'Yes' : 'No'}</div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Live Build Status</h2>
            <div className="text-sm text-slate-600">
              Active build: {buildState.activeBuild?.active_build_id || 'none'}
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Previous build: {buildState.activeBuild?.previous_build_id || 'none'}
            </div>
            {latestBuild ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Latest Build</div>
                <div>ID: {latestBuild.build_id}</div>
                <div>Status: {latestBuild.status}</div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">No builds have been created yet.</div>
            )}
          </section>
        </div>
      </div>
    </SectionPage>
  );
}

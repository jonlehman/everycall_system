'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';

function splitLines(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

function ArtifactStat({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default function KnowledgePage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ message: 'Loading knowledge workspace...', tone: 'warn' });
  const [savingIntent, setSavingIntent] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [buildBusy, setBuildBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [publishingBuildId, setPublishingBuildId] = useState('');
  const [rollingBackBuildId, setRollingBackBuildId] = useState('');

  const [intentForm, setIntentForm] = useState({
    businessCallIntentId: '',
    primaryGoal: '',
    preferredOutcomes: 'callback_request, message_taken, transfer',
    toneRules: 'Be clear, short, and helpful on every turn.\nAnswer direct questions before continuing the script.\nAsk one question at a time.'
  });
  const [runtimeForm, setRuntimeForm] = useState({
    greetingText: '',
    voice: 'marin',
    aiDisclosure: '',
    uncertaintyPhrase: '',
    pricingFallback: '',
    closingPhrase: ''
  });
  const [buildForm, setBuildForm] = useState({ websiteUrl: '' });
  const [previewQuery, setPreviewQuery] = useState('');

  const [readiness, setReadiness] = useState(null);
  const [buildState, setBuildState] = useState({ activeBuild: null, builds: [], assignments: [] });
  const [overrides, setOverrides] = useState([]);
  const [guardrails, setGuardrails] = useState([]);
  const [callOutcomeSchema, setCallOutcomeSchema] = useState(null);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [preview, setPreview] = useState(null);

  const loadWorkspace = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setStatus({ message: 'Loading knowledge workspace...', tone: 'warn' });
    }
    try {
      const [
        intentData,
        runtimeData,
        readinessData,
        buildData,
        overrideData,
        guardrailData,
        outcomeData,
        documentData
      ] = await Promise.all([
        fetchJson('/api/v1/knowledge/business-call-intent'),
        fetchJson('/api/v1/knowledge/runtime-profile'),
        fetchJson('/api/v1/knowledge/readiness'),
        fetchJson('/api/v1/knowledge/builds'),
        fetchJson('/api/v1/knowledge/overrides'),
        fetchJson('/api/v1/knowledge/guardrails'),
        fetchJson('/api/v1/knowledge/call-outcome-schema'),
        fetchJson('/api/v1/knowledge/uploaded-documents')
      ]);

      const activeIntent = intentData?.activeIntent || intentData?.approvedIntent || intentData?.intents?.[0] || null;
      const profile = runtimeData?.profile || null;
      const readinessState = readinessData?.readiness || null;
      const builds = buildData?.builds || [];

      setIntentForm({
        businessCallIntentId: activeIntent?.business_call_intent_id || '',
        primaryGoal: activeIntent?.primary_goal || '',
        preferredOutcomes: Array.isArray(activeIntent?.preferred_outcomes_json)
          ? activeIntent.preferred_outcomes_json.join(', ')
          : 'callback_request, message_taken, transfer',
        toneRules: Array.isArray(activeIntent?.tone_rules_json)
          ? activeIntent.tone_rules_json.join('\n')
          : 'Be clear, short, and helpful on every turn.\nAnswer direct questions before continuing the script.\nAsk one question at a time.'
      });
      setRuntimeForm({
        greetingText: profile?.greeting_text || '',
        voice: profile?.session_config?.voice || 'marin',
        aiDisclosure: profile?.wording_defaults?.ai_disclosure || '',
        uncertaintyPhrase: profile?.wording_defaults?.uncertainty_phrase || '',
        pricingFallback: profile?.wording_defaults?.pricing_fallback || '',
        closingPhrase: profile?.wording_defaults?.closing_phrase || ''
      });
      setReadiness(readinessState);
      setBuildState({
        activeBuild: buildData?.activeBuild || null,
        builds,
        assignments: buildData?.assignments || []
      });
      setOverrides(Array.isArray(overrideData?.overrides) ? overrideData.overrides : []);
      setGuardrails(Array.isArray(guardrailData?.guardrails) ? guardrailData.guardrails : []);
      setCallOutcomeSchema(outcomeData?.activeSchema || outcomeData?.schemas?.[0] || null);
      setUploadedDocuments(Array.isArray(documentData?.documents) ? documentData.documents : []);
      setBuildForm((current) => ({
        websiteUrl: current.websiteUrl || buildData?.intakeWebsiteUrl || builds[0]?.metadata_json?.website_url || ''
      }));
      setStatus({ message: 'Knowledge workspace loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load the knowledge workspace.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  const saveBusinessIntent = async () => {
    setSavingIntent(true);
    setStatus({ message: 'Saving Business Call Intent...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/business-call-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: {
            businessCallIntentId: intentForm.businessCallIntentId || undefined,
            status: 'approved_live',
            primaryGoal: intentForm.primaryGoal,
            preferredOutcomes: splitCsv(intentForm.preferredOutcomes),
            toneRules: splitLines(intentForm.toneRules)
          }
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not save Business Call Intent.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: 'Business Call Intent saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save Business Call Intent.', tone: 'bad' });
    } finally {
      setSavingIntent(false);
    }
  };

  const saveRuntimeProfile = async () => {
    setSavingProfile(true);
    setStatus({ message: 'Saving runtime profile...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/runtime-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: {
            greetingText: runtimeForm.greetingText,
            sessionConfig: {
              voice: runtimeForm.voice
            },
            wordingDefaults: {
              aiDisclosure: runtimeForm.aiDisclosure,
              uncertaintyPhrase: runtimeForm.uncertaintyPhrase,
              pricingFallback: runtimeForm.pricingFallback,
              closingPhrase: runtimeForm.closingPhrase
            }
          }
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not save runtime profile.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: 'Runtime profile saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save runtime profile.', tone: 'bad' });
    } finally {
      setSavingProfile(false);
    }
  };

  const createBuild = async () => {
    setBuildBusy(true);
    setStatus({ message: 'Creating build...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl: buildForm.websiteUrl.trim() || undefined
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Build failed.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: `Build ${data.build?.build_id || 'created'} completed.`, tone: 'ok' });
    } catch {
      setStatus({ message: 'Build failed.', tone: 'bad' });
    } finally {
      setBuildBusy(false);
    }
  };

  const publishBuild = async (buildId) => {
    setPublishingBuildId(buildId);
    setStatus({ message: 'Publishing build...', tone: 'warn' });
    try {
      const data = await fetchJson(`/api/v1/knowledge/builds/${encodeURIComponent(buildId)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Publish failed.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: `Build ${buildId} published.`, tone: 'ok' });
    } catch {
      setStatus({ message: 'Publish failed.', tone: 'bad' });
    } finally {
      setPublishingBuildId('');
    }
  };

  const rollbackBuild = async (buildId) => {
    setRollingBackBuildId(buildId);
    setStatus({ message: 'Rolling back active build...', tone: 'warn' });
    try {
      const data = await fetchJson(`/api/v1/knowledge/builds/${encodeURIComponent(buildId)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Rollback failed.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: `Rolled back to build ${buildId}.`, tone: 'ok' });
    } catch {
      setStatus({ message: 'Rollback failed.', tone: 'bad' });
    } finally {
      setRollingBackBuildId('');
    }
  };

  const runRuntimePreview = async () => {
    setPreviewBusy(true);
    setStatus({ message: 'Assembling runtime preview...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/runtime-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: previewQuery })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Runtime preview failed.', tone: 'bad' });
        return;
      }
      setPreview(data);
      setStatus({ message: 'Runtime preview ready.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Runtime preview failed.', tone: 'bad' });
    } finally {
      setPreviewBusy(false);
    }
  };

  const latestBuild = buildState.builds[0] || null;
  const readinessSummary = useMemo(() => ({
    blockers: Array.isArray(readiness?.blockers) ? readiness.blockers : [],
    status: readiness?.status || 'not_started'
  }), [readiness]);

  return (
    <ClientPage
      title="Knowledge Workspace"
      subtitle="Manage the single knowledge build pipeline, runtime defaults, and build publishing."
      status={status}
      primaryAction={{ label: loading ? 'Loading...' : 'Reload', brand: true, onClick: () => loadWorkspace(), disabled: loading }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <ArtifactStat label="Assignments" value={buildState.assignments.length} />
        <ArtifactStat label="Builds" value={buildState.builds.length} />
        <ArtifactStat label="Overrides" value={overrides.length} />
        <ArtifactStat label="Guardrails" value={guardrails.length} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Business Call Intent</h2>
            <label>Primary Goal</label>
            <textarea
              value={intentForm.primaryGoal}
              onChange={(event) => setIntentForm((current) => ({ ...current, primaryGoal: event.target.value }))}
            />
            <label className="mt-2.5">Preferred Outcomes</label>
            <input
              value={intentForm.preferredOutcomes}
              onChange={(event) => setIntentForm((current) => ({ ...current, preferredOutcomes: event.target.value }))}
            />
            <label className="mt-2.5">Tone Rules</label>
            <textarea
              value={intentForm.toneRules}
              onChange={(event) => setIntentForm((current) => ({ ...current, toneRules: event.target.value }))}
              style={{ minHeight: 120 }}
            />
            <div className="mt-3">
              <Button onClick={saveBusinessIntent} disabled={savingIntent}>{savingIntent ? 'Saving...' : 'Save Intent'}</Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Runtime Defaults</h2>
            <label>Greeting</label>
            <textarea
              value={runtimeForm.greetingText}
              onChange={(event) => setRuntimeForm((current) => ({ ...current, greetingText: event.target.value }))}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label>Voice</label>
                <select value={runtimeForm.voice} onChange={(event) => setRuntimeForm((current) => ({ ...current, voice: event.target.value }))}>
                  {['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].map((voice) => (
                    <option key={voice} value={voice}>{voice}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>AI Disclosure</label>
                <input
                  value={runtimeForm.aiDisclosure}
                  onChange={(event) => setRuntimeForm((current) => ({ ...current, aiDisclosure: event.target.value }))}
                />
              </div>
              <div>
                <label>Uncertainty Phrase</label>
                <input
                  value={runtimeForm.uncertaintyPhrase}
                  onChange={(event) => setRuntimeForm((current) => ({ ...current, uncertaintyPhrase: event.target.value }))}
                />
              </div>
              <div>
                <label>Pricing Fallback</label>
                <input
                  value={runtimeForm.pricingFallback}
                  onChange={(event) => setRuntimeForm((current) => ({ ...current, pricingFallback: event.target.value }))}
                />
              </div>
            </div>
            <label className="mt-2.5">Closing Phrase</label>
            <input
              value={runtimeForm.closingPhrase}
              onChange={(event) => setRuntimeForm((current) => ({ ...current, closingPhrase: event.target.value }))}
            />
            <div className="mt-3">
              <Button onClick={saveRuntimeProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Runtime Defaults'}</Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Build Pipeline</h2>
            <label>Website URL</label>
            <input
              value={buildForm.websiteUrl}
              onChange={(event) => setBuildForm({ websiteUrl: event.target.value })}
              placeholder="https://example.com"
            />
            {!latestBuild && buildForm.websiteUrl ? (
              <div className="mt-2 text-sm text-slate-600">
                Pre-filled from intake. You can change it before creating the first build.
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={createBuild} disabled={buildBusy}>{buildBusy ? 'Building...' : 'Create Build'}</Button>
            </div>
            {latestBuild ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Latest Build</div>
                <div>ID: {latestBuild.build_id}</div>
                <div>Status: {latestBuild.status}</div>
                <div>Warnings: {Array.isArray(latestBuild.warnings_json) ? latestBuild.warnings_json.length : 0}</div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Readiness</h2>
            <div className={`badge ${readinessSummary.blockers.length ? 'warn' : 'ok'}`}>{readinessSummary.status}</div>
            <div className="mt-2 text-sm text-slate-600">
              Active build: {buildState.activeBuild?.active_build_id || 'none'}
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Outcome schema: {callOutcomeSchema?.call_outcome_schema_id || 'missing'}
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Uploaded docs: {uploadedDocuments.length}
            </div>
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Blockers</div>
              {readinessSummary.blockers.length ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
                  {readinessSummary.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-emerald-700">Ready for go live.</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Published Builds</h2>
            <div className="grid gap-2">
              {buildState.builds.length ? buildState.builds.map((build) => (
                <div key={build.build_id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{build.version || build.build_id}</div>
                      <div className="text-xs text-slate-500">{build.build_id}</div>
                    </div>
                    <span className={`badge ${build.status === 'published' ? 'ok' : 'warn'}`}>{build.status}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    Cards: {build.artifact_counts_json?.cards || 0} · Facts: {build.artifact_counts_json?.facts || 0}
                  </div>
                  {Array.isArray(build.warnings_json) && build.warnings_json.length ? (
                    <div className="mt-2 text-xs text-amber-700">{build.warnings_json.join(', ')}</div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => publishBuild(build.build_id)}
                      disabled={publishingBuildId === build.build_id}
                    >
                      {publishingBuildId === build.build_id ? 'Publishing...' : 'Publish'}
                    </Button>
                    {buildState.activeBuild?.previous_build_id === build.build_id || build.status === 'published' ? (
                      <Button
                        variant="outline"
                        onClick={() => rollbackBuild(build.build_id)}
                        disabled={rollingBackBuildId === build.build_id}
                      >
                        {rollingBackBuildId === build.build_id ? 'Rolling back...' : 'Rollback'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-slate-500">No builds yet.</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Runtime Preview</h2>
            <label>Representative Query</label>
            <input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="Do you handle after-hours emergencies?" />
            <div className="mt-3">
              <Button onClick={runRuntimePreview} disabled={previewBusy || !previewQuery.trim()}>{previewBusy ? 'Running...' : 'Run Preview'}</Button>
            </div>
            {preview ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Preview Result</div>
                <div>Selected cards: {preview.runtimeBundle?.selected_cards?.length || 0}</div>
                <div>Runtime mode: {preview.runtimeBundle?.runtime_mode || '-'}</div>
                <div>Prompt tokens: {preview.tokenCounts?.prompt_payload_tokens || 0}</div>
                <div>Bundle tokens: {preview.tokenCounts?.runtime_bundle_tokens || 0}</div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </ClientPage>
  );
}

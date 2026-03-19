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

function formatLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ensureSentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildRepresentativeAnswer(answerPacket) {
  const packet = answerPacket || {};
  const direct = Array.isArray(packet.direct_answer_points) ? packet.direct_answer_points.filter(Boolean) : [];
  const qualifiers = Array.isArray(packet.qualifiers) ? packet.qualifiers.filter(Boolean) : [];
  const limits = Array.isArray(packet.limits_or_exclusions) ? packet.limits_or_exclusions.filter(Boolean) : [];
  const nextSteps = Array.isArray(packet.next_step_options) ? packet.next_step_options.filter(Boolean) : [];
  const unsupported = Array.isArray(packet.unsupported_requested_items) ? packet.unsupported_requested_items.filter(Boolean) : [];
  const shouldLeadWithNextStep = !direct.length || unsupported.length > 0 || String(packet.runtime_mode || '').trim() !== 'answer';

  const parts = [];
  if (direct.length) {
    parts.push(direct.slice(0, 2).map(ensureSentence).join(' '));
  }
  if (qualifiers.length) {
    parts.push(`Key qualifiers: ${qualifiers.slice(0, 2).join('; ')}.`);
  }
  if (limits.length) {
    parts.push(`Limits or exclusions: ${limits.slice(0, 2).join('; ')}.`);
  }
  if (unsupported.length) {
    parts.push(`Confirmed details are not available for: ${unsupported.slice(0, 2).join('; ')}.`);
  }
  if (nextSteps.length && shouldLeadWithNextStep) {
    parts.push(`Likely next step: ${ensureSentence(nextSteps[0])}`);
  }
  return parts.join(' ').trim() || 'No representative answer is available for this preview yet.';
}

function PreviewList({ title, items, emptyText = 'None.', formatter = (item) => item }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {values.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {values.map((item, index) => <li key={`${title}-${index}`}>{formatter(item)}</li>)}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-slate-500">{emptyText}</div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ message: 'Loading knowledge workspace...', tone: 'warn' });
  const [savingPromptProfile, setSavingPromptProfile] = useState(false);
  const [buildBusy, setBuildBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [publishingBuildId, setPublishingBuildId] = useState('');
  const [rollingBackBuildId, setRollingBackBuildId] = useState('');

  const [promptProfileForm, setPromptProfileForm] = useState({
    assistantName: '',
    businessName: '',
    companyDescription: '',
    openingLine: '',
    aiDisclosureLine: '',
    leadGoal: '',
    requiredContactFields: '',
    closingPhrase: '',
    basicNoToolAllowedStatement: ''
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
        promptProfileData,
        readinessData,
        buildData,
        overrideData,
        guardrailData,
        outcomeData,
        documentData
      ] = await Promise.all([
        fetchJson('/api/v1/knowledge/prompt-profile'),
        fetchJson('/api/v1/knowledge/readiness'),
        fetchJson('/api/v1/knowledge/builds'),
        fetchJson('/api/v1/knowledge/overrides'),
        fetchJson('/api/v1/knowledge/guardrails'),
        fetchJson('/api/v1/knowledge/call-outcome-schema'),
        fetchJson('/api/v1/knowledge/uploaded-documents')
      ]);

      const promptProfile = promptProfileData?.profile || null;
      const readinessState = readinessData?.readiness || null;
      const builds = buildData?.builds || [];

      setPromptProfileForm({
        assistantName: promptProfile?.assistant_name || '',
        businessName: promptProfile?.business_name || '',
        companyDescription: promptProfile?.company_description || '',
        openingLine: promptProfile?.opening_line || '',
        aiDisclosureLine: promptProfile?.ai_disclosure_line || '',
        leadGoal: promptProfile?.lead_goal || '',
        requiredContactFields: splitLines(promptProfile?.required_contact_fields || []).join('\n'),
        closingPhrase: promptProfile?.closing_phrase || '',
        basicNoToolAllowedStatement: promptProfile?.basic_no_tool_allowed_statement || ''
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
        websiteUrl: current.websiteUrl || buildData?.bootstrapWebsiteUrl || builds[0]?.metadata_json?.website_url || ''
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

  const savePromptProfile = async () => {
    setSavingPromptProfile(true);
    setStatus({ message: 'Saving receptionist presentation settings...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/knowledge/prompt-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: {
            assistantName: promptProfileForm.assistantName,
            businessName: promptProfileForm.businessName,
            companyDescription: promptProfileForm.companyDescription,
            openingLine: promptProfileForm.openingLine,
            aiDisclosureLine: promptProfileForm.aiDisclosureLine,
            leadGoal: promptProfileForm.leadGoal,
            requiredContactFields: splitLines(promptProfileForm.requiredContactFields),
            closingPhrase: promptProfileForm.closingPhrase,
            basicNoToolAllowedStatement: promptProfileForm.basicNoToolAllowedStatement
          }
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not save receptionist presentation settings.', tone: 'bad' });
        return;
      }
      await loadWorkspace({ silent: true });
      setStatus({ message: 'Receptionist presentation settings saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not save receptionist presentation settings.', tone: 'bad' });
    } finally {
      setSavingPromptProfile(false);
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
  const previewAnswerPacket = preview?.answerPacket || null;
  const previewRuntimeBundle = preview?.runtimeBundle || null;
  const previewPlanner = preview?.planner || null;
  const representativeAnswer = buildRepresentativeAnswer(previewAnswerPacket);
  const forcedSupportModeActive = Boolean(
    previewAnswerPacket?.metadata?.forced_support_mode || previewRuntimeBundle?.forced_support_mode
  );

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
            <h2 className="mt-0 text-lg font-semibold">Receptionist Presentation</h2>
            <div className="text-sm text-slate-600">
              These are the business-facing fields tenants should control. Behavior rules, capture logic, and tool policy stay on the admin side.
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label>Assistant Name</label>
                <input
                  value={promptProfileForm.assistantName}
                  onChange={(event) => setPromptProfileForm((current) => ({ ...current, assistantName: event.target.value }))}
                />
              </div>
              <div>
                <label>Business Name</label>
                <input
                  value={promptProfileForm.businessName}
                  onChange={(event) => setPromptProfileForm((current) => ({ ...current, businessName: event.target.value }))}
                />
              </div>
            </div>

            <label className="mt-2.5">Company Description</label>
            <textarea
              value={promptProfileForm.companyDescription}
              onChange={(event) => setPromptProfileForm((current) => ({ ...current, companyDescription: event.target.value }))}
              style={{ minHeight: 96 }}
            />
            <div className="mt-1 text-sm text-slate-600">
              This becomes the business-context narrative in the startup prompt. If you leave it blank, EveryCall inherits from the latest approved website/build summary when possible.
            </div>

            <label className="mt-2.5">Opening Line</label>
            <textarea
              value={promptProfileForm.openingLine}
              onChange={(event) => setPromptProfileForm((current) => ({ ...current, openingLine: event.target.value }))}
            />
            <div className="mt-1 text-sm text-slate-600">
              AI disclosure, callback capture defaults, and closing language use system defaults unless an admin changes them.
            </div>

            <div className="mt-3">
              <Button onClick={savePromptProfile} disabled={savingPromptProfile}>
                {savingPromptProfile ? 'Saving...' : 'Save Receptionist Presentation'}
              </Button>
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
                Pre-filled from tenant setup. You can change it before creating the first build.
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
            <div className="text-sm text-slate-600">
              Ask a caller-style question to see the representative answer packet the phone AI would likely speak from.
            </div>
            <label className="mt-2.5">Representative Query</label>
            <input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="Do you handle after-hours emergencies?" />
            <div className="mt-3">
              <Button onClick={runRuntimePreview} disabled={previewBusy || !previewQuery.trim()}>{previewBusy ? 'Running...' : 'Run Preview'}</Button>
            </div>
            {preview ? (
              <div className="mt-3 grid gap-3">
                {forcedSupportModeActive ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    Forced-support experiment is active. Retrieved coverage is being promoted as <strong>Strong</strong> and
                    bundle confidence is forced to <strong>0.99</strong> for this preview.
                  </div>
                ) : null}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-semibold text-slate-900">Representative Answer</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">{representativeAnswer}</div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <ArtifactStat label="Runtime Mode" value={formatLabel(previewRuntimeBundle?.runtime_mode || '-')} />
                  <ArtifactStat label="Selected Cards" value={previewRuntimeBundle?.selected_cards?.length || 0} />
                  <ArtifactStat label="Used Facts" value={previewRuntimeBundle?.selected_answer_facts?.length || 0} />
                  <ArtifactStat label="Confidence Score" value={previewRuntimeBundle?.confidence_score ?? '-'} />
                  <ArtifactStat label="Prompt Tokens" value={preview.tokenCounts?.prompt_payload_tokens || 0} />
                  <ArtifactStat label="Bundle Tokens" value={preview.tokenCounts?.runtime_bundle_tokens || 0} />
                </div>

                <div className="grid gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">Coverage Support</div>
                    {Array.isArray(previewAnswerPacket?.coverage) && previewAnswerPacket.coverage.length ? (
                      <div className="mt-2 grid gap-2">
                        {previewAnswerPacket.coverage.map((item) => (
                          <div key={item.requested_coverage_item_text} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium text-slate-900">{item.requested_coverage_item_text}</div>
                              <span className={`badge ${item.support_strength === 'strong' ? 'ok' : item.support_strength === 'partial' ? 'warn' : 'bad'}`}>
                                {formatLabel(item.support_strength)}
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              Cards: {(item.used_card_ids || []).length} · Facts: {(item.used_fact_ids || []).length}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-500">No coverage items were returned.</div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">Selected Cards</div>
                    {Array.isArray(previewRuntimeBundle?.selected_cards) && previewRuntimeBundle.selected_cards.length ? (
                      <div className="mt-2 grid gap-2">
                        {previewRuntimeBundle.selected_cards.map((card) => (
                          <div key={card.knowledge_card_id} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="font-medium text-slate-900">{card.canonical_name}</div>
                            <div className="mt-1 text-sm text-slate-700">{card.speakable_summary}</div>
                            {Array.isArray(card.selected_facts) && card.selected_facts.length ? (
                              <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
                                {card.selected_facts.map((fact) => (
                                  <li key={fact.fact_id}>{fact.claim}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-500">No cards selected.</div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <PreviewList
                      title="Direct Answer Points"
                      items={previewAnswerPacket?.direct_answer_points}
                      emptyText="No direct answer points were assembled."
                    />
                    <PreviewList
                      title="Qualifiers"
                      items={previewAnswerPacket?.qualifiers}
                    />
                    <PreviewList
                      title="Limits or Exclusions"
                      items={previewAnswerPacket?.limits_or_exclusions}
                    />
                    <PreviewList
                      title="Next Step Options"
                      items={previewAnswerPacket?.next_step_options}
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">Used Facts</div>
                    {Array.isArray(previewRuntimeBundle?.selected_answer_facts) && previewRuntimeBundle.selected_answer_facts.length ? (
                      <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                        {previewRuntimeBundle.selected_answer_facts.map((fact) => (
                          <li key={fact.fact_id}>
                            {fact.claim}
                            {fact.fact_role ? <span className="text-slate-500"> ({formatLabel(fact.fact_role)})</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-sm text-slate-500">No facts selected.</div>
                    )}
                  </div>
                </div>

                <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Advanced Details</summary>
                  <div className="mt-3 grid gap-3">
                    <PreviewList
                      title="Planner Coverage Items"
                      items={previewPlanner?.coverage_items}
                      emptyText="No planner coverage items returned."
                    />
                    <PreviewList
                      title="Planner Next-Step Suggestions"
                      items={previewPlanner?.next_step_suggestions}
                      emptyText="No planner next-step suggestions returned."
                    />
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">Structured Answer Packet</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {JSON.stringify(previewAnswerPacket, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">Runtime Bundle</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {JSON.stringify(previewRuntimeBundle, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </ClientPage>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function setByPath(object, path, value) {
  const next = cloneValue(object);
  let cursor = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor[path[index]] = cursor[path[index]] && typeof cursor[path[index]] === 'object'
      ? cursor[path[index]]
      : {};
    cursor = cursor[path[index]];
  }
  cursor[path[path.length - 1]] = value;
  return next;
}

function joinLines(values) {
  return Array.isArray(values) ? values.join('\n') : '';
}

function splitLines(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDisplayValue(value) {
  if (value === undefined || value === null || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function fieldHasDraftChange(savedEffectiveValue, draftValue) {
  return JSON.stringify(savedEffectiveValue ?? null) !== JSON.stringify(draftValue ?? null);
}

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-900">{label}</span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      {children}
    </label>
  );
}

function TextInput(props) {
  return <input {...props} className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()} />;
}

function TextArea(props) {
  return <textarea {...props} className={`min-h-[96px] rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()} />;
}

function LayerCard({ title, description, onReset, children, resetLabel = 'Reset to Saved' }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {onReset ? (
          <Button variant="outline" size="sm" onClick={onReset}>{resetLabel}</Button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}

function PreviewBlock({ title, description, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PromptSection({ title, description, editor, preview }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="grid gap-4">{editor}</div>
        <div className="grid gap-4">{preview}</div>
      </div>
    </section>
  );
}

function CodeBlock({ value }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap">
      {String(value || '')}
    </pre>
  );
}

function RulesList({ title, items }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {values.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {values.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-slate-500">None active.</div>
      )}
    </div>
  );
}

function FormGroup({ title, description, children }) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {description ? <div className="mt-1 text-xs text-slate-500">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function SourceBadge({ source }) {
  const isOverride = source === 'tenant_override';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
      isOverride ? 'bg-amber-100 text-amber-900' : 'bg-slate-200 text-slate-700'
    }`}>
      {isOverride ? 'Tenant override' : 'Inherited default'}
    </span>
  );
}

function DraftBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
      Draft changed
    </span>
  );
}

function TenantFieldState({ fieldState, draftValue }) {
  const hasDraftChange = fieldHasDraftChange(fieldState?.effective_value, draftValue);
  return (
    <div className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">Saved source</span>
        <SourceBadge source={fieldState?.source} />
        {hasDraftChange ? <DraftBadge /> : null}
      </div>
      <div className="whitespace-pre-wrap">
        <span className="font-medium text-slate-700">Saved override:</span> {formatDisplayValue(fieldState?.override_value)}
      </div>
      <div className="whitespace-pre-wrap">
        <span className="font-medium text-slate-700">Default:</span> {formatDisplayValue(fieldState?.default_value)}
      </div>
      <div className="whitespace-pre-wrap">
        <span className="font-medium text-slate-700">Effective now:</span> {formatDisplayValue(draftValue)}
      </div>
    </div>
  );
}

function PreviewVariantPanel({ label, children }) {
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function PreviewModeContent({ mode, draft, live, render }) {
  if (mode === 'compare') {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <PreviewVariantPanel label="Draft Effective">
          {render(draft)}
        </PreviewVariantPanel>
        <PreviewVariantPanel label="Live Effective">
          {render(live)}
        </PreviewVariantPanel>
      </div>
    );
  }
  return render(mode === 'live' ? live : draft);
}

function renderTenantValueList(values) {
  return (
    <dl className="grid gap-2 text-sm text-slate-700">
      <div><dt className="font-semibold text-slate-900">Greeting</dt><dd>{values?.greetingText || 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">AI disclosure</dt><dd>{values?.aiDisclosure || 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">Uncertainty phrase</dt><dd>{values?.uncertaintyPhrase || 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">Pricing fallback</dt><dd>{values?.pricingFallback || 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">Closing phrase</dt><dd>{values?.closingPhrase || 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">Require knowledge lookup</dt><dd>{values ? (values.requireKnowledgeLookup ? 'Yes' : 'No') : 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">Max clarifying questions</dt><dd>{values?.maxClarifyingQuestions ?? 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">End call only after spoken close</dt><dd>{values ? (values.allowEndCallOnlyAfterSpokenClose ? 'Yes' : 'No') : 'None set.'}</dd></div>
      <div><dt className="font-semibold text-slate-900">Concise responses</dt><dd>{values ? (values.conciseResponses ? 'Yes' : 'No') : 'None set.'}</dd></div>
    </dl>
  );
}

function toTenantProfileOverride(profile) {
  if (!profile) return null;
  return {
    greeting_text: profile.greeting_text || '',
    session_config: profile.session_config || {},
    tool_policy: profile.tool_policy || {},
    wording_defaults: profile.wording_defaults || {},
    runtime_defaults: profile.runtime_defaults || {}
  };
}

export default function AdminPromptConfigPage() {
  const [loading, setLoading] = useState(true);
  const [loadingTenant, setLoadingTenant] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState('');
  const [defaults, setDefaults] = useState(null);
  const [savedConfig, setSavedConfig] = useState(null);
  const [config, setConfig] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [savedTenantProfile, setSavedTenantProfile] = useState(null);
  const [tenantProfile, setTenantProfile] = useState(null);
  const [tenantFieldSources, setTenantFieldSources] = useState(null);
  const [runtimeEntryMode, setRuntimeEntryMode] = useState('customer_call');
  const [previewQuery, setPreviewQuery] = useState('');
  const [previewMode, setPreviewMode] = useState('draft');
  const [preview, setPreview] = useState(null);

  const selectedTenantRecord = tenants.find((tenant) => tenant.tenant_key === selectedTenant) || null;

  const loadPreview = async (
    tenantKey = selectedTenant,
    entryMode = runtimeEntryMode,
    query = previewQuery,
    draftConfig = config,
    draftTenantProfile = tenantProfile
  ) => {
    if (!tenantKey) return;
    setPreviewing(true);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          runtimeEntryMode: entryMode,
          previewQuery: query,
          config: draftConfig,
          runtimeProfile: toTenantProfileOverride(draftTenantProfile)
        })
      });
      setPreview(data);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const loadTenantProfile = async (tenantKey = selectedTenant, { silent = false } = {}) => {
    if (!tenantKey) return;
    setLoadingTenant(true);
    if (!silent) {
      setStatus('Loading tenant runtime profile...');
    }
    try {
      const data = await fetchJson(`/api/v1/admin/system/prompts/tenant-runtime-profile?tenantKey=${encodeURIComponent(tenantKey)}`);
      setSavedTenantProfile(data.profile);
      setTenantProfile(data.profile);
      setTenantFieldSources(data.field_sources || {});
      if (!silent) {
        setStatus('Tenant runtime profile loaded.');
      }
      await loadPreview(tenantKey, runtimeEntryMode, previewQuery, config, data.profile);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load tenant runtime profile.');
    } finally {
      setLoadingTenant(false);
    }
  };

  const loadPage = async () => {
    setLoading(true);
    setStatus('Loading prompt configuration...');
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts');
      const nextTenant = data.tenants?.[0]?.tenant_key || '';
      setDefaults(data.defaults);
      setSavedConfig(data.config);
      setConfig(data.config);
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
      setSelectedTenant((current) => current || nextTenant);
      setStatus('Prompt configuration loaded.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load prompt configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    if (!loading && selectedTenant) {
      void loadTenantProfile(selectedTenant, { silent: true });
    }
  }, [loading, selectedTenant]);

  useEffect(() => {
    if (!loading && selectedTenant && tenantProfile) {
      void loadPreview(selectedTenant, runtimeEntryMode, previewQuery, config, tenantProfile);
    }
  }, [runtimeEntryMode]);

  const updateConfig = (path, value) => {
    setConfig((current) => setByPath(current, path, value));
  };

  const updateTenantProfile = (path, value) => {
    setTenantProfile((current) => setByPath(current, path, value));
  };

  const resetLayer = (path) => {
    setConfig((current) => setByPath(current, path, cloneValue(path.reduce((cursor, key) => cursor?.[key], savedConfig))));
  };

  const saveConfig = async () => {
    setSavingGlobal(true);
    setStatus('Saving global prompt configuration...');
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
      setSavedConfig(data.config);
      setConfig(data.config);
      setDefaults(data.defaults);
      setStatus('Global prompt configuration saved.');
      await loadPreview(selectedTenant, runtimeEntryMode, previewQuery, data.config, tenantProfile);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save global prompt configuration.');
    } finally {
      setSavingGlobal(false);
    }
  };

  const resetAll = async () => {
    if (!window.confirm('Reset all global prompt layers back to defaults?')) return;
    setSavingGlobal(true);
    setStatus('Resetting global prompt configuration...');
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts', { method: 'DELETE' });
      setSavedConfig(data.config);
      setConfig(data.config);
      setDefaults(data.defaults);
      setStatus('Global prompt configuration reset to defaults.');
      await loadPreview(selectedTenant, runtimeEntryMode, previewQuery, data.config, tenantProfile);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to reset global prompt configuration.');
    } finally {
      setSavingGlobal(false);
    }
  };

  const saveTenantProfile = async () => {
    if (!selectedTenant || !tenantProfile) return;
    setSavingTenant(true);
    setStatus(`Saving tenant runtime profile for ${selectedTenant}...`);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/tenant-runtime-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey: selectedTenant,
          profile: toTenantProfileOverride(tenantProfile)
        })
      });
      setSavedTenantProfile(data.profile);
      setTenantProfile(data.profile);
      setTenantFieldSources(data.field_sources || {});
      setStatus('Tenant runtime profile saved.');
      await loadPreview(selectedTenant, runtimeEntryMode, previewQuery, config, data.profile);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save tenant runtime profile.');
    } finally {
      setSavingTenant(false);
    }
  };

  const resetTenantToSaved = async () => {
    if (!savedTenantProfile) return;
    const nextProfile = cloneValue(savedTenantProfile);
    setTenantProfile(nextProfile);
    setStatus('Tenant runtime profile draft reset to the last saved version.');
    await loadPreview(selectedTenant, runtimeEntryMode, previewQuery, config, nextProfile);
  };

  const resetTenantToDefaults = async () => {
    if (!selectedTenant) return;
    if (!window.confirm(`Clear tenant runtime-profile overrides for ${selectedTenant} and return to inherited defaults?`)) return;
    setSavingTenant(true);
    setStatus(`Resetting tenant runtime profile for ${selectedTenant}...`);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/tenant-runtime-profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantKey: selectedTenant })
      });
      setSavedTenantProfile(data.profile);
      setTenantProfile(data.profile);
      setTenantFieldSources(data.field_sources || {});
      setStatus('Tenant runtime profile reset to inherited defaults.');
      await loadPreview(selectedTenant, runtimeEntryMode, previewQuery, config, data.profile);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to reset tenant runtime profile.');
    } finally {
      setSavingTenant(false);
    }
  };

  const previewDraft = preview?.draft || null;
  const previewLive = preview?.live || null;

  if (loading || !config || !defaults || !savedConfig) {
    return (
      <section className="grid gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Prompt Config</h1>
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-slate-500 shadow-sm">
          {status || 'Loading...'}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Prompt Config</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure global runtime prompt layers, edit prompt-adjacent tenant runtime settings, and inspect the composed gateway prompt for the selected tenant.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            `Reset to Saved` restores only that draft layer to the last saved version. `Reset All` restores the full global prompt config to built-in defaults. `Reset Tenant To Defaults` clears tenant overrides in `knowledge_runtime_profiles`.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadPage} disabled={loading || savingGlobal || savingTenant}>Reload Page</Button>
          <Button variant="outline" onClick={resetAll} disabled={savingGlobal}>Reset All Global Layers</Button>
          <Button onClick={saveConfig} disabled={savingGlobal}>{savingGlobal ? 'Saving...' : 'Save Global Prompt Config'}</Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm lg:grid-cols-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">Global Prompt Layers</div>
          <p className="mt-1 text-sm text-slate-600">
            These edits affect every tenant because they change the shared prompt templates and wrappers used across the live runtime.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">Selected Tenant Runtime Profile</div>
          <p className="mt-1 text-sm text-slate-600">
            These edits affect only <span className="font-medium text-slate-900">{selectedTenantRecord?.name || 'the selected tenant'}</span> and write back to <code>knowledge_runtime_profiles</code>.
          </p>
          <div className="mt-2 text-xs text-slate-500">
            Tenant key: <code>{selectedTenant || 'none selected'}</code>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Tenant Preview" hint="Selects which tenant runtime profile is loaded into the tenant editor and merged into preview composition.">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={selectedTenant}
              onChange={(event) => setSelectedTenant(event.target.value)}
            >
              {tenants.map((tenant) => (
                <option key={tenant.tenant_key} value={tenant.tenant_key}>
                  {tenant.name} ({tenant.tenant_key})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Runtime Entry Mode" hint="Changes stage/context and post-tool rule activation the same way the live runtime does.">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={runtimeEntryMode}
              onChange={(event) => setRuntimeEntryMode(event.target.value)}
            >
              <option value="customer_call">customer_call</option>
              <option value="setup_interview">setup_interview</option>
            </select>
          </Field>
          <Field label="Preview View" hint="Draft uses unsaved edits. Live uses the last saved global config and tenant profile. Compare shows both.">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={previewMode}
              onChange={(event) => setPreviewMode(event.target.value)}
            >
              <option value="draft">draft effective</option>
              <option value="live">live effective</option>
              <option value="compare">compare draft vs live</option>
            </select>
          </Field>
          <Field
            label="Preview Query"
            hint="Optional. Used to resolve override/guardrail-driven conditional response rules."
          >
            <TextInput
              value={previewQuery}
              onChange={(event) => setPreviewQuery(event.target.value)}
              placeholder="Caller question for rule preview"
            />
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={() => loadPreview(selectedTenant, runtimeEntryMode, previewQuery, config, tenantProfile)}
              disabled={previewing || !selectedTenant}
            >
              {previewing ? 'Refreshing...' : 'Refresh Preview'}
            </Button>
          </div>
        </div>
        <div className="mt-3 text-sm text-slate-500">{status}</div>
      </div>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Selected Tenant Runtime Profile</h2>
            <p className="mt-1 text-sm text-slate-500">
              Edit only the prompt-adjacent tenant fields that already live in the current runtime-profile source of truth. This page intentionally excludes unrelated routing controls and non-prompt runtime settings.
            </p>
            <div className="mt-2 text-xs text-slate-500">
              Tenant: <span className="font-medium text-slate-700">{selectedTenantRecord?.name || 'Loading tenant...'}</span> <code>({selectedTenant || 'none'})</code>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => loadTenantProfile(selectedTenant)} disabled={!selectedTenant || loadingTenant || savingTenant}>
              {loadingTenant ? 'Loading...' : 'Reload Tenant'}
            </Button>
            <Button variant="outline" onClick={resetTenantToSaved} disabled={!savedTenantProfile || savingTenant}>Reset Tenant To Saved</Button>
            <Button variant="outline" onClick={resetTenantToDefaults} disabled={!selectedTenant || savingTenant}>Reset Tenant To Defaults</Button>
            <Button onClick={saveTenantProfile} disabled={!tenantProfile || savingTenant}>{savingTenant ? 'Saving...' : 'Save Tenant Runtime Profile'}</Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="grid gap-4">
            <LayerCard
              title="Tenant Prompt-Adjacent Fields"
              description="These fields come from the selected tenant's runtime profile. The input shows the current draft effective value, while the status block underneath shows saved inheritance vs override state."
            >
              <FormGroup
                title="Greeting And Wording Defaults"
                description="These tenant-scoped values feed the greeting turn, tenant persona wording, and fallback phrasing used throughout the live call."
              >
                <Field label="Greeting" hint="Used as the tenant greeting text and also rendered into the tenant persona and greeting instruction preview.">
                  <TextArea
                    value={tenantProfile?.greeting_text || ''}
                    onChange={(event) => updateTenantProfile(['greeting_text'], event.target.value)}
                    className="min-h-[96px]"
                  />
                  <TenantFieldState fieldState={tenantFieldSources?.greetingText} draftValue={tenantProfile?.greeting_text} />
                </Field>
                <Field label="AI Disclosure" hint="Tenant-scoped wording used when the assistant identifies itself as automated.">
                  <TextInput
                    value={tenantProfile?.wording_defaults?.ai_disclosure || ''}
                    onChange={(event) => updateTenantProfile(['wording_defaults', 'ai_disclosure'], event.target.value)}
                  />
                  <TenantFieldState fieldState={tenantFieldSources?.aiDisclosure} draftValue={tenantProfile?.wording_defaults?.ai_disclosure} />
                </Field>
                <Field label="Uncertainty Phrase" hint="Used when the assistant needs to soften or verify an answer.">
                  <TextInput
                    value={tenantProfile?.wording_defaults?.uncertainty_phrase || ''}
                    onChange={(event) => updateTenantProfile(['wording_defaults', 'uncertainty_phrase'], event.target.value)}
                  />
                  <TenantFieldState fieldState={tenantFieldSources?.uncertaintyPhrase} draftValue={tenantProfile?.wording_defaults?.uncertainty_phrase} />
                </Field>
                <Field label="Pricing Fallback" hint="Tenant-safe wording for pricing or quote questions when exact numbers should not be invented.">
                  <TextInput
                    value={tenantProfile?.wording_defaults?.pricing_fallback || ''}
                    onChange={(event) => updateTenantProfile(['wording_defaults', 'pricing_fallback'], event.target.value)}
                  />
                  <TenantFieldState fieldState={tenantFieldSources?.pricingFallback} draftValue={tenantProfile?.wording_defaults?.pricing_fallback} />
                </Field>
                <Field label="Closing Phrase" hint="Tenant-preferred close used near callback, handoff, or end-of-call moments.">
                  <TextInput
                    value={tenantProfile?.wording_defaults?.closing_phrase || ''}
                    onChange={(event) => updateTenantProfile(['wording_defaults', 'closing_phrase'], event.target.value)}
                  />
                  <TenantFieldState fieldState={tenantFieldSources?.closingPhrase} draftValue={tenantProfile?.wording_defaults?.closing_phrase} />
                </Field>
              </FormGroup>

              <FormGroup
                title="Knowledge Tool Policy Values"
                description="These tenant-scoped settings flow into the rendered knowledge-tool policy block and shape how aggressively the assistant clarifies before using the tool."
              >
                <Field label="Require Knowledge Lookup" hint="If enabled, tenant-specific facts should be grounded through `knowledge_lookup` rather than improvised.">
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={tenantProfile?.tool_policy?.require_knowledge_lookup_for_tenant_facts ? 'true' : 'false'}
                    onChange={(event) => updateTenantProfile(['tool_policy', 'require_knowledge_lookup_for_tenant_facts'], event.target.value === 'true')}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                  <TenantFieldState fieldState={tenantFieldSources?.requireKnowledgeLookup} draftValue={tenantProfile?.tool_policy?.require_knowledge_lookup_for_tenant_facts} />
                </Field>
                <Field label="Max Clarifying Questions" hint="The current live prompt uses this to describe how many clarifying questions are allowed before a tool call.">
                  <TextInput
                    type="number"
                    min="0"
                    value={tenantProfile?.tool_policy?.max_clarifying_questions ?? 0}
                    onChange={(event) => updateTenantProfile(['tool_policy', 'max_clarifying_questions'], Number(event.target.value || 0))}
                  />
                  <TenantFieldState fieldState={tenantFieldSources?.maxClarifyingQuestions} draftValue={tenantProfile?.tool_policy?.max_clarifying_questions} />
                </Field>
                <Field label="End Call Only After Spoken Close" hint="Prompt-level reminder that the assistant should only call `end_call` after it has already spoken the final closing sentence aloud.">
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={tenantProfile?.tool_policy?.allow_end_call_only_after_spoken_close ? 'true' : 'false'}
                    onChange={(event) => updateTenantProfile(['tool_policy', 'allow_end_call_only_after_spoken_close'], event.target.value === 'true')}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                  <TenantFieldState fieldState={tenantFieldSources?.allowEndCallOnlyAfterSpokenClose} draftValue={tenantProfile?.tool_policy?.allow_end_call_only_after_spoken_close} />
                </Field>
              </FormGroup>

              <FormGroup
                title="Response Defaults"
                description="These tenant-level defaults affect how the response-rule layer and tenant persona describe the runtime behavior."
              >
                <Field label="Concise Responses" hint="Feeds the response-style label in the tenant persona and activates the concise response rule after `knowledge_lookup`.">
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={tenantProfile?.runtime_defaults?.concise_responses ? 'true' : 'false'}
                    onChange={(event) => updateTenantProfile(['runtime_defaults', 'concise_responses'], event.target.value === 'true')}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                  <TenantFieldState fieldState={tenantFieldSources?.conciseResponses} draftValue={tenantProfile?.runtime_defaults?.concise_responses} />
                </Field>
              </FormGroup>
            </LayerCard>
          </div>

          <div className="grid gap-4">
            <PreviewBlock
              title="Tenant Effective Values"
              description="These are the tenant-scoped values after inheritance is resolved. Draft uses unsaved edits from the form; live uses the last saved tenant profile."
            >
              <PreviewModeContent
                mode={previewMode}
                draft={previewDraft?.tenantRuntimeProfileValues}
                live={previewLive?.tenantRuntimeProfileValues}
                render={(values) => renderTenantValueList(values)}
              />
            </PreviewBlock>

            <PreviewBlock
              title="Tenant Inheritance Summary"
              description="Saved inheritance state for each editable tenant field. This shows whether the selected tenant currently overrides the shared baseline or inherits it."
            >
              <div className="grid gap-2 text-sm text-slate-700">
                {[
                  ['Greeting', tenantFieldSources?.greetingText],
                  ['AI disclosure', tenantFieldSources?.aiDisclosure],
                  ['Uncertainty phrase', tenantFieldSources?.uncertaintyPhrase],
                  ['Pricing fallback', tenantFieldSources?.pricingFallback],
                  ['Closing phrase', tenantFieldSources?.closingPhrase],
                  ['Require knowledge lookup', tenantFieldSources?.requireKnowledgeLookup],
                  ['Max clarifying questions', tenantFieldSources?.maxClarifyingQuestions],
                  ['End call only after spoken close', tenantFieldSources?.allowEndCallOnlyAfterSpokenClose],
                  ['Concise responses', tenantFieldSources?.conciseResponses]
                ].map(([label, fieldState]) => (
                  <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-slate-900">{label}</div>
                      <SourceBadge source={fieldState?.source} />
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-xs text-slate-600">
                      Default: {formatDisplayValue(fieldState?.default_value)}
                    </div>
                    <div className="whitespace-pre-wrap text-xs text-slate-600">
                      Saved override: {formatDisplayValue(fieldState?.override_value)}
                    </div>
                    <div className="whitespace-pre-wrap text-xs text-slate-600">
                      Saved effective: {formatDisplayValue(fieldState?.effective_value)}
                    </div>
                  </div>
                ))}
              </div>
            </PreviewBlock>
          </div>
        </div>
      </section>

      <section className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Global Prompt Layers</div>
        <p className="text-sm text-slate-600">
          The sections below edit shared prompt templates and wrappers. They affect all tenants because the live runtime composes every session from these global layers plus the selected tenant runtime profile above.
        </p>
      </section>

      <PromptSection
        title="1. Base Session Prompt"
        description="This is the top-level persistent instruction block that stays active for the whole Realtime session."
        editor={(
          <LayerCard
            title="Base System Prompt Template"
            description="Global startup instructions before any tenant-specific or runtime-derived sections are appended."
            onReset={() => resetLayer(['baseSystemPrompt'])}
          >
            <Field label="Instruction Lines" hint="This is the main global startup instruction block. Each line becomes part of the live `system_prompt` before tenant persona text is appended.">
              <TextArea
                value={joinLines(config.baseSystemPrompt.instructionLines)}
                onChange={(event) => updateConfig(['baseSystemPrompt', 'instructionLines'], splitLines(event.target.value))}
                className="min-h-[220px]"
              />
            </Field>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Base System Prompt" description="Editable global base layer before the tenant persona block.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.baseSystemPrompt}
              live={previewLive?.rendered?.baseSystemPrompt}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="2. Tenant Persona"
        description="Global wrapper templates live on the left. The rendered persona block on the right uses the selected tenant runtime profile and the current prompt draft."
        editor={(
          <LayerCard
            title="Tenant Persona Layer"
            description="Editable wrapper + line templates. Tenant runtime-profile values stay tenant-scoped and render into preview."
            onReset={() => resetLayer(['tenantPersona'])}
          >
            <Field label="Header Label" hint="This label separates the base system prompt from the rendered tenant persona section in the final startup prompt.">
              <TextInput
                value={config.tenantPersona.headerLabel}
                onChange={(event) => updateConfig(['tenantPersona', 'headerLabel'], event.target.value)}
              />
            </Field>
            <FormGroup
              title="Persona Line Templates"
              description="These wrappers control how tenant runtime-profile values are phrased inside the persona block."
            >
              <Field label="Business Role Template" hint="Controls how the approved business-call-intent summary is phrased inside the tenant persona block. This is separate from the explicit business-context block below.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.businessRole}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'businessRole'], event.target.value)}
                />
              </Field>
              <Field label="Greeting Style Template" hint="Controls how the tenant’s runtime-profile greeting style is described to the runtime, not the spoken greeting itself.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.greetingStyle}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'greetingStyle'], event.target.value)}
                />
              </Field>
              <Field label="Tone Template" hint="Wraps the resolved tone or default tone rules inside the tenant persona block.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.tone}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'tone'], event.target.value)}
                />
              </Field>
              <Field label="AI Disclosure Template" hint="Wraps the tenant’s AI disclosure wording so the runtime knows how disclosure should be phrased.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.aiDisclosure}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'aiDisclosure'], event.target.value)}
                />
              </Field>
              <Field label="Uncertainty Template" hint="Wraps the tenant’s preferred uncertainty phrase used when the assistant needs to soften or verify an answer.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.uncertainty}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'uncertainty'], event.target.value)}
                />
              </Field>
              <Field label="Pricing Fallback Template" hint="Wraps the tenant’s fallback wording for pricing or quote questions when exact pricing should not be invented.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.pricingFallback}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'pricingFallback'], event.target.value)}
                />
              </Field>
              <Field label="Closing Template" hint="Wraps the tenant’s preferred closing wording for callback, handoff, or end-of-call moments.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.closing}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'closing'], event.target.value)}
                />
              </Field>
              <Field label="Response Style Template" hint="Controls how the resolved response-style label is stated inside the tenant persona block.">
                <TextInput
                  value={config.tenantPersona.lineTemplates.responseStyle}
                  onChange={(event) => updateConfig(['tenantPersona', 'lineTemplates', 'responseStyle'], event.target.value)}
                />
              </Field>
            </FormGroup>
            <FormGroup
              title="Fallback Defaults"
              description="These defaults are only used when the selected tenant runtime profile does not provide a value."
            >
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Default Greeting Style" hint="Used only if the tenant runtime profile does not define greeting style wording.">
                  <TextInput
                    value={config.tenantPersona.defaults.greetingStyle}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'greetingStyle'], event.target.value)}
                  />
                </Field>
                <Field label="Default Tone" hint="Fallback tone text when the selected tenant has no specific tone rules.">
                  <TextInput
                    value={config.tenantPersona.defaults.tone}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'tone'], event.target.value)}
                  />
                </Field>
                <Field label="Default AI Disclosure" hint="Fallback disclosure wording when the tenant runtime profile does not provide one.">
                  <TextInput
                    value={config.tenantPersona.defaults.aiDisclosure}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'aiDisclosure'], event.target.value)}
                  />
                </Field>
                <Field label="Default Uncertainty Phrase" hint="Fallback uncertainty wording when the tenant runtime profile does not provide one.">
                  <TextInput
                    value={config.tenantPersona.defaults.uncertainty}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'uncertainty'], event.target.value)}
                  />
                </Field>
                <Field label="Default Pricing Fallback" hint="Fallback pricing-safe wording when the tenant runtime profile does not provide one.">
                  <TextInput
                    value={config.tenantPersona.defaults.pricingFallback}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'pricingFallback'], event.target.value)}
                  />
                </Field>
                <Field label="Default Closing Phrase" hint="Fallback closing wording when the tenant runtime profile does not provide one.">
                  <TextInput
                    value={config.tenantPersona.defaults.closing}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'closing'], event.target.value)}
                  />
                </Field>
                <Field label="Concise Response Style Label" hint="Used when the tenant runtime profile prefers concise responses. This label is rendered into the tenant persona block.">
                  <TextInput
                    value={config.tenantPersona.defaults.conciseResponseStyle}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'conciseResponseStyle'], event.target.value)}
                  />
                </Field>
                <Field label="Complete Response Style Label" hint="Used when the tenant runtime profile explicitly disables concise responses.">
                  <TextInput
                    value={config.tenantPersona.defaults.completeResponseStyle}
                    onChange={(event) => updateConfig(['tenantPersona', 'defaults', 'completeResponseStyle'], event.target.value)}
                  />
                </Field>
              </div>
            </FormGroup>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Tenant Persona Block" description="Rendered from the selected tenant’s runtime profile values and the editable global wrapper/templates.">
            <PreviewModeContent
              mode={previewMode}
              draft={`${previewDraft?.rendered?.tenantPersonaHeader || ''}\n${previewDraft?.rendered?.tenantPersona || ''}`.trim()}
              live={`${previewLive?.rendered?.tenantPersonaHeader || ''}\n${previewLive?.rendered?.tenantPersona || ''}`.trim()}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="3. Company Context"
        description="This startup block gives Realtime true company-level context about what the tenant actually does before any tool call is needed."
        editor={(
          <LayerCard
            title="Company Context Layer"
            description="Rendered from tenant company context, currently sourced from onboarding intake services offered."
            onReset={() => resetLayer(['companyContext'])}
          >
            <Field label="Header Label" hint="This section header appears above the company-description block in the final gateway session instructions.">
              <TextInput
                value={config.companyContext.headerLabel}
                onChange={(event) => updateConfig(['companyContext', 'headerLabel'], event.target.value)}
              />
            </Field>
            <Field label="Summary Template" hint="This renders the tenant’s company-description summary into the startup session instructions. Use `{company_context_summary}`.">
              <TextInput
                value={config.companyContext.summaryTemplate}
                onChange={(event) => updateConfig(['companyContext', 'summaryTemplate'], event.target.value)}
              />
            </Field>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Company Context Block" description="Derived from tenant company information and included in the startup session instructions.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.companyContext}
              live={previewLive?.rendered?.companyContext}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="4. Call Mission"
        description="This startup block describes how the receptionist should handle calls for this tenant. It comes from the tenant’s Business Call Intent, not from company-description data."
        editor={(
          <LayerCard
            title="Call Mission Layer"
            description="Rendered from the approved Business Call Intent summary."
            onReset={() => resetLayer(['callMission'])}
          >
            <Field label="Header Label" hint="This section header appears above the call-handling mission block in the final gateway session instructions.">
              <TextInput
                value={config.callMission.headerLabel}
                onChange={(event) => updateConfig(['callMission', 'headerLabel'], event.target.value)}
              />
            </Field>
            <Field label="Summary Template" hint="This renders the tenant’s Business Call Intent summary into the startup session instructions. Use `{business_call_intent_summary}`.">
              <TextInput
                value={config.callMission.summaryTemplate}
                onChange={(event) => updateConfig(['callMission', 'summaryTemplate'], event.target.value)}
              />
            </Field>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Call Mission Block" description="Derived from the tenant’s approved Business Call Intent and included in the startup session instructions.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.callMission}
              live={previewLive?.rendered?.callMission}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="5. Knowledge Tool Policy"
        description="This structured policy block tells Realtime how to use `knowledge_lookup` and how much clarification is allowed before a tool call."
        editor={(
          <LayerCard
            title="Knowledge Tool Policy Layer"
            description="Structured prompt layer. Keep the templates focused on rendering the existing tool-policy fields."
            onReset={() => resetLayer(['knowledgeToolPolicy'])}
          >
            <Field label="Header Label" hint="This section header appears above the rendered tool-policy lines in the final gateway session instructions.">
              <TextInput
                value={config.knowledgeToolPolicy.headerLabel}
                onChange={(event) => updateConfig(['knowledgeToolPolicy', 'headerLabel'], event.target.value)}
              />
            </Field>
            <Field label="Require Knowledge Lookup Template" hint="Renders the tenant tool-policy flag that tells the runtime whether tenant facts must go through `knowledge_lookup`.">
              <TextInput
                value={config.knowledgeToolPolicy.requireKnowledgeLookupTemplate}
                onChange={(event) => updateConfig(['knowledgeToolPolicy', 'requireKnowledgeLookupTemplate'], event.target.value)}
              />
            </Field>
            <Field label="Max Clarifying Questions Template" hint="Renders the structured `max_clarifying_questions` value from the tenant runtime profile into prompt text.">
              <TextInput
                value={config.knowledgeToolPolicy.maxClarifyingQuestionsTemplate}
                onChange={(event) => updateConfig(['knowledgeToolPolicy', 'maxClarifyingQuestionsTemplate'], event.target.value)}
              />
            </Field>
            <Field label="End Call After Spoken Close Template" hint="Renders the policy that end-call can only happen after a spoken close.">
              <TextInput
                value={config.knowledgeToolPolicy.endCallAfterSpokenCloseTemplate}
                onChange={(event) => updateConfig(['knowledgeToolPolicy', 'endCallAfterSpokenCloseTemplate'], event.target.value)}
              />
            </Field>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Knowledge Tool Policy Block" description="Rendered from structured tool-policy config in the tenant runtime profile.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.knowledgeToolPolicy}
              live={previewLive?.rendered?.knowledgeToolPolicy}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="6. Greeting Turn"
        description="This wrapper is only used when the gateway explicitly asks Realtime to speak the first greeting right after session startup."
        editor={(
          <LayerCard
            title="Greeting Instruction Wrapper"
            description="Used by the gateway when it explicitly requests the greeting turn right after session startup."
            onReset={() => resetLayer(['greetingInstruction'])}
          >
            <Field label="Greeting Instruction Template" hint="This is not the tenant greeting itself. It is the wrapper instruction the gateway sends when it asks Realtime to speak the first greeting turn.">
              <TextInput
                value={config.greetingInstruction.template}
                onChange={(event) => updateConfig(['greetingInstruction', 'template'], event.target.value)}
              />
            </Field>
            <Field label="Fallback Greeting" hint="Used only when the selected tenant has no greeting text in its runtime profile.">
              <TextInput
                value={config.greetingInstruction.fallbackGreeting}
                onChange={(event) => updateConfig(['greetingInstruction', 'fallbackGreeting'], event.target.value)}
              />
            </Field>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Greeting Instruction" description="The explicit greeting-turn instruction sent after the Realtime session is updated.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.greetingInstruction}
              live={previewLive?.rendered?.greetingInstruction}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="7. Runtime Context"
        description="This runtime-derived block describes the current stage and assignment that the live gateway merges into the startup session instructions."
        editor={(
          <LayerCard
            title="Current Runtime Context Layer"
            description="Rendered into the final gateway session instructions from the current stage and active assignment."
            onReset={() => resetLayer(['runtimeContext'])}
          >
            <Field label="Header Label" hint="This section header appears above the live runtime context block in the final gateway session instructions.">
              <TextInput
                value={config.runtimeContext.headerLabel}
                onChange={(event) => updateConfig(['runtimeContext', 'headerLabel'], event.target.value)}
              />
            </Field>
            <Field label="Stage Template" hint="Renders the current runtime stage, such as `opening`, into the startup session instructions.">
              <TextInput
                value={config.runtimeContext.stageTemplate}
                onChange={(event) => updateConfig(['runtimeContext', 'stageTemplate'], event.target.value)}
              />
            </Field>
            <Field label="Assignment Template" hint="Renders the current active domain/subdomain assignment into the startup session instructions.">
              <TextInput
                value={config.runtimeContext.assignmentTemplate}
                onChange={(event) => updateConfig(['runtimeContext', 'assignmentTemplate'], event.target.value)}
              />
            </Field>
          </LayerCard>
        )}
        preview={(
          <PreviewBlock title="Current Runtime Context Block" description="Derived from runtime entry mode, stage, and active assignment.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.runtimeContext}
              live={previewLive?.rendered?.runtimeContext}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="8. Post-Tool Answer Rules"
        description="These rules are attached after `knowledge_lookup` and shape how Realtime speaks from the answer packet on that turn."
        editor={(
          <LayerCard
            title="Post-Tool Response Restriction Layer"
            description="Baseline rules plus the conditional additions the gateway appends based on runtime mode, concise setting, overrides, and guardrails."
            onReset={() => resetLayer(['responseRestrictions'])}
          >
            <Field label="Baseline Rules" hint="These are the baseline response rules sent back in `response_rules` after `knowledge_lookup`. They shape how Realtime speaks from the answer packet. One rule per line.">
              <TextArea
                value={joinLines(config.responseRestrictions.baselineRules)}
                onChange={(event) => updateConfig(['responseRestrictions', 'baselineRules'], splitLines(event.target.value))}
                className="min-h-[220px]"
              />
            </Field>
            <FormGroup
              title="Conditional Rule Templates"
              description="These only activate when the matching runtime condition is present."
            >
              <Field label="Setup Interview Rule" hint="Added only when runtime entry mode is `setup_interview`.">
                <TextInput
                  value={config.responseRestrictions.setupInterviewRule}
                  onChange={(event) => updateConfig(['responseRestrictions', 'setupInterviewRule'], event.target.value)}
                />
              </Field>
              <Field label="Concise Response Rule" hint="Added when the tenant runtime profile prefers concise responses.">
                <TextInput
                  value={config.responseRestrictions.conciseResponseRule}
                  onChange={(event) => updateConfig(['responseRestrictions', 'conciseResponseRule'], event.target.value)}
                />
              </Field>
              <Field label="Override Priority Rule" hint="Added when a matching hard-fact or temporary-notice override is active for the turn.">
                <TextInput
                  value={config.responseRestrictions.overridePriorityRule}
                  onChange={(event) => updateConfig(['responseRestrictions', 'overridePriorityRule'], event.target.value)}
                />
              </Field>
              <Field label="Dangerous Guardrail Rule" hint="Added when the current query matches a dangerous-question guardrail.">
                <TextInput
                  value={config.responseRestrictions.dangerousQuestionRule}
                  onChange={(event) => updateConfig(['responseRestrictions', 'dangerousQuestionRule'], event.target.value)}
                />
              </Field>
            </FormGroup>
          </LayerCard>
        )}
        preview={(
          <>
            <PreviewBlock title="Post-Tool Response Restrictions" description="Baseline template plus currently active conditional additions.">
              <PreviewModeContent
                mode={previewMode}
                draft={previewDraft?.rendered?.responseRestrictions}
                live={previewLive?.rendered?.responseRestrictions}
                render={(value) => (
                  <div className="grid gap-3">
                    <RulesList title="Baseline Rules" items={value?.baselineRules} />
                    <RulesList title="Active Conditional Rules" items={value?.activeConditionalRules} />
                    <RulesList title="Conditional Templates" items={Object.values(value?.conditionalTemplates || {})} />
                  </div>
                )}
              />
            </PreviewBlock>
            <PreviewBlock title="Matched Override / Guardrail Context" description="Only populated when a preview query is provided.">
              <PreviewModeContent
                mode={previewMode}
                draft={previewDraft?.matched}
                live={previewLive?.matched}
                render={(value) => (
                  <div className="grid gap-3">
                    <RulesList
                      title="Matched Overrides"
                      items={(value?.overrides || []).map((item) => item.title || item.override_type || 'override')}
                    />
                    <RulesList
                      title="Matched Guardrails"
                      items={(value?.guardrails || []).map((item) => item.title || item.guardrail_type || 'guardrail')}
                    />
                  </div>
                )}
              />
            </PreviewBlock>
          </>
        )}
      />

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">7. Final Composed Output</h2>
          <p className="mt-1 text-sm text-slate-500">
            These are the fully assembled runtime artifacts built from the current global and tenant layers. Use this section to compare the last saved live prompt against your unsaved draft before testing a call.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <PreviewBlock title="Final Gateway Session Instructions" description="Composed with the same shared builder the live gateway uses for `session.update`.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.rendered?.finalGatewaySessionInstructions}
              live={previewLive?.rendered?.finalGatewaySessionInstructions}
              render={(value) => <CodeBlock value={value} />}
            />
          </PreviewBlock>
          <PreviewBlock title="Gateway Prompt Output" description="Built from the same response builder used by `/api/v1/gateway/prompt`.">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.gatewayPromptOutput}
              live={previewLive?.gatewayPromptOutput}
              render={(value) => <CodeBlock value={JSON.stringify(value || {}, null, 2)} />}
            />
          </PreviewBlock>
        </div>
      </section>
    </section>
  );
}

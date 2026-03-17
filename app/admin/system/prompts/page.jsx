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

function LayerCard({ title, description, onReset, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {onReset ? (
          <Button variant="outline" size="sm" onClick={onReset}>Reset to Saved</Button>
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

export default function AdminPromptConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState('');
  const [defaults, setDefaults] = useState(null);
  const [savedConfig, setSavedConfig] = useState(null);
  const [config, setConfig] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [runtimeEntryMode, setRuntimeEntryMode] = useState('customer_call');
  const [previewQuery, setPreviewQuery] = useState('');
  const [preview, setPreview] = useState(null);

  const loadPage = async () => {
    setLoading(true);
    setStatus('Loading prompt configuration...');
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts');
      setDefaults(data.defaults);
      setSavedConfig(data.config);
      setConfig(data.config);
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
      setSelectedTenant((current) => current || data.tenants?.[0]?.tenant_key || '');
      setStatus('Prompt configuration loaded.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load prompt configuration.');
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (tenantKey = selectedTenant, entryMode = runtimeEntryMode, query = previewQuery) => {
    if (!tenantKey) return;
    setPreviewing(true);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          runtimeEntryMode: entryMode,
          previewQuery: query
        })
      });
      setPreview(data);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load preview.');
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    if (!loading && selectedTenant) {
      loadPreview(selectedTenant, runtimeEntryMode, previewQuery);
    }
  }, [loading, selectedTenant, runtimeEntryMode]);

  const updateConfig = (path, value) => {
    setConfig((current) => setByPath(current, path, value));
  };

  const resetLayer = (path) => {
    setConfig((current) => setByPath(current, path, cloneValue(path.reduce((cursor, key) => cursor?.[key], savedConfig))));
  };

  const saveConfig = async () => {
    setSaving(true);
    setStatus('Saving prompt configuration...');
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
      setSavedConfig(data.config);
      setConfig(data.config);
      setDefaults(data.defaults);
      setStatus('Prompt configuration saved.');
      await loadPreview();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save prompt configuration.');
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!window.confirm('Reset all global prompt layers back to defaults?')) return;
    setSaving(true);
    setStatus('Resetting prompt configuration...');
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts', { method: 'DELETE' });
      setSavedConfig(data.config);
      setConfig(data.config);
      setDefaults(data.defaults);
      setStatus('Prompt configuration reset to defaults.');
      await loadPreview();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to reset prompt configuration.');
    } finally {
      setSaving(false);
    }
  };

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
            Configure global runtime prompt layers and inspect the composed live gateway prompt for a selected tenant.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            `Reset to Saved` restores only that layer to the last version saved in the database. `Reset All` restores the full global prompt config to built-in defaults.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            The sections below now follow runtime order, so each editable layer sits beside the rendered output or runtime-derived block it affects.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadPage} disabled={loading || saving}>Reload</Button>
          <Button variant="outline" onClick={resetAll} disabled={saving}>Reset All</Button>
          <Button onClick={saveConfig} disabled={saving}>{saving ? 'Saving...' : 'Save Prompt Config'}</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Tenant Preview" hint="Chooses which tenant-specific runtime-profile values are merged into the rendered prompt preview on the right.">
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
          <Field label="Runtime Entry Mode" hint="Changes the runtime stage/context and conditional response-rule additions the same way the live runtime does.">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={runtimeEntryMode}
              onChange={(event) => setRuntimeEntryMode(event.target.value)}
            >
              <option value="customer_call">customer_call</option>
              <option value="setup_interview">setup_interview</option>
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
            <Button variant="outline" onClick={() => loadPreview()} disabled={previewing || !selectedTenant}>
              {previewing ? 'Refreshing...' : 'Refresh Preview'}
            </Button>
          </div>
        </div>
        <div className="mt-3 text-sm text-slate-500">{status}</div>
      </div>

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
            <CodeBlock value={preview?.rendered?.baseSystemPrompt} />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="2. Tenant Persona"
        description="Global wrapper templates live on the left; tenant-scoped runtime wording stays separate and is resolved into the rendered block on the right."
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
              <Field label="Business Role Template" hint="Controls how the approved business-call-intent summary is phrased inside the tenant persona block.">
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
          <>
            <PreviewBlock
              title="Tenant Runtime Profile Values"
              description="Tenant-scoped wording stays separate from the global prompt config and is resolved into the rendered persona block below."
            >
              <dl className="grid gap-2 text-sm text-slate-700">
                <div><dt className="font-semibold text-slate-900">Greeting</dt><dd>{preview?.tenantRuntimeProfileValues?.greetingText || 'None set.'}</dd></div>
                <div><dt className="font-semibold text-slate-900">AI disclosure</dt><dd>{preview?.tenantRuntimeProfileValues?.aiDisclosure || 'None set.'}</dd></div>
                <div><dt className="font-semibold text-slate-900">Uncertainty phrase</dt><dd>{preview?.tenantRuntimeProfileValues?.uncertaintyPhrase || 'None set.'}</dd></div>
                <div><dt className="font-semibold text-slate-900">Pricing fallback</dt><dd>{preview?.tenantRuntimeProfileValues?.pricingFallback || 'None set.'}</dd></div>
                <div><dt className="font-semibold text-slate-900">Closing phrase</dt><dd>{preview?.tenantRuntimeProfileValues?.closingPhrase || 'None set.'}</dd></div>
                <div><dt className="font-semibold text-slate-900">Concise responses</dt><dd>{preview?.tenantRuntimeProfileValues?.conciseResponses ? 'true' : 'false'}</dd></div>
              </dl>
            </PreviewBlock>
            <PreviewBlock title="Tenant Persona Block" description="Rendered from the selected tenant’s runtime profile values and the editable global wrapper/templates.">
              <CodeBlock value={`${preview?.rendered?.tenantPersonaHeader || ''}\n${preview?.rendered?.tenantPersona || ''}`.trim()} />
            </PreviewBlock>
          </>
        )}
      />

      <PromptSection
        title="3. Knowledge Tool Policy"
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
            <CodeBlock value={preview?.rendered?.knowledgeToolPolicy} />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="4. Greeting Turn"
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
            <CodeBlock value={preview?.rendered?.greetingInstruction} />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="5. Runtime Context"
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
            <CodeBlock value={preview?.rendered?.runtimeContext} />
          </PreviewBlock>
        )}
      />

      <PromptSection
        title="6. Post-Tool Answer Rules"
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
              <div className="grid gap-3">
                <RulesList title="Baseline Rules" items={preview?.rendered?.responseRestrictions?.baselineRules} />
                <RulesList title="Active Conditional Rules" items={preview?.rendered?.responseRestrictions?.activeConditionalRules} />
                <RulesList
                  title="Conditional Templates"
                  items={Object.values(preview?.rendered?.responseRestrictions?.conditionalTemplates || {})}
                />
              </div>
            </PreviewBlock>
            <PreviewBlock title="Matched Override / Guardrail Context" description="Only populated when a preview query is provided.">
              <div className="grid gap-3">
                <RulesList
                  title="Matched Overrides"
                  items={(preview?.matched?.overrides || []).map((item) => item.title || item.override_type || 'override')}
                />
                <RulesList
                  title="Matched Guardrails"
                  items={(preview?.matched?.guardrails || []).map((item) => item.title || item.guardrail_type || 'guardrail')}
                />
              </div>
            </PreviewBlock>
          </>
        )}
      />

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">7. Final Composed Output</h2>
          <p className="mt-1 text-sm text-slate-500">
            These are the fully assembled runtime artifacts built from the layers above. This is the best place to verify the overall prompt stack before testing a call.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <PreviewBlock title="Final Gateway Session Instructions" description="Composed with the same shared builder the live gateway uses for `session.update`.">
            <CodeBlock value={preview?.rendered?.finalGatewaySessionInstructions} />
          </PreviewBlock>
          <PreviewBlock title="Live Gateway Prompt Output" description="Built from the same response builder used by `/api/v1/gateway/prompt`.">
            <CodeBlock value={JSON.stringify(preview?.gatewayPromptOutput || {}, null, 2)} />
          </PreviewBlock>
        </div>
      </section>
    </section>
  );
}

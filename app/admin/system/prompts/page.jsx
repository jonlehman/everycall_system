'use client';

import { useEffect, useMemo, useState } from 'react';
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

function normalizeText(value) {
  return String(value || '').trim();
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

function formatCompactValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : 'none';
  }
  if (value === null || value === undefined || value === '') {
    return 'none';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function TextInput(props) {
  return <input {...props} className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()} />;
}

function TextArea(props) {
  return <textarea {...props} className={`min-h-[120px] rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()} />;
}

function CodeBlock({ value }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap">
      {String(value || '')}
    </pre>
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
        <PreviewVariantPanel label="Draft Effective">{render(draft)}</PreviewVariantPanel>
        <PreviewVariantPanel label="Live Effective">{render(live)}</PreviewVariantPanel>
      </div>
    );
  }
  return render(mode === 'live' ? live : draft);
}

function SectionCard({
  section,
  savedSection,
  tenantOverride,
  savedTenantOverride,
  onSectionChange,
  onTenantOverrideChange,
  effectiveDraft,
  effectiveLive,
  previewMode
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{section.admin_metadata?.title || section.section_id}</h2>
          <div className="mt-1 text-xs text-slate-500">
            Section ID: <code>{section.section_id}</code>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSectionChange(savedSection?.default_text || '')}
          >
            Reset Canonical
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onTenantOverrideChange(savedTenantOverride || '')}
          >
            Reset Override
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
        <Field
          label="Canonical Section Text"
          hint="Admin-editable global blueprint text. This is the default text for all tenants unless a tenant-specific override exists."
        >
          <TextArea value={section.default_text} onChange={(event) => onSectionChange(event.target.value)} className="min-h-[220px]" />
        </Field>

        <Field
          label="Selected Tenant Override"
          hint="Optional admin-only per-tenant override for this section. Leave blank to use the canonical section text."
        >
          <TextArea
            value={tenantOverride || ''}
            onChange={(event) => onTenantOverrideChange(event.target.value)}
            className="min-h-[220px]"
            placeholder="No tenant override"
          />
        </Field>

        <div className="grid gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-slate-900">Effective Preview</div>
            <div className="mt-2 text-xs text-slate-500">
              Canonical text is always editable globally. The selected tenant override only affects the chosen tenant.
            </div>
            <div className="mt-3">
              <PreviewModeContent
                mode={previewMode}
                draft={effectiveDraft}
                live={effectiveLive}
                render={(value) => <CodeBlock value={value || ''} />}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TenantFieldBlock({ label, hint, state, draftValue, children }) {
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">{label}</div>
          {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
        </div>
        <SourceBadge source={state?.source} />
      </div>
      {children}
      <div className="grid gap-2 text-[11px] text-slate-600 md:grid-cols-3">
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-medium text-slate-700">Default</div>
          <div className="mt-1 break-words">{formatCompactValue(state?.default_value)}</div>
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-medium text-slate-700">Saved Override</div>
          <div className="mt-1 break-words">{formatCompactValue(state?.override_value)}</div>
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-medium text-slate-700">Draft Effective</div>
          <div className="mt-1 break-words">{formatCompactValue(draftValue)}</div>
        </div>
      </div>
    </div>
  );
}

function ToolDefinitionCard({ title, toolKey, draftTool, savedTool, onChange }) {
  return (
    <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <div className="mt-1 text-xs text-slate-500">
            Tool name is code-driven: <code>{toolKey}</code>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => onChange(cloneValue(savedTool))}>Reset Tool Text</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tool Description" hint="Admin-editable descriptive text merged into the runtime-exposed tool definition.">
          <TextArea
            value={draftTool?.description || ''}
            onChange={(event) => onChange({ ...draftTool, description: event.target.value })}
          />
        </Field>
        <Field label="Behavior Mode Label" hint="This is admin-facing metadata that documents the intended usage mode for the tool.">
          <TextInput
            value={draftTool?.behavior_mode || ''}
            onChange={(event) => onChange({ ...draftTool, behavior_mode: event.target.value })}
          />
        </Field>
      </div>
      {toolKey === 'data_capture' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Outcome Type Description" hint="Used for the fixed `outcome_type` parameter in the structured tool schema.">
            <TextArea
              value={draftTool?.outcome_type_description || ''}
              onChange={(event) => onChange({ ...draftTool, outcome_type_description: event.target.value })}
            />
          </Field>
          <Field label="Generic Field Description Template" hint="Applied to dynamic capture fields using `{field_name}`.">
            <TextArea
              value={draftTool?.generic_field_description_template || ''}
              onChange={(event) => onChange({ ...draftTool, generic_field_description_template: event.target.value })}
            />
          </Field>
        </div>
      ) : (
        <Field label="Parameter Description" hint="Admin-editable text for the fixed parameter description in the runtime-exposed tool definition.">
          <TextArea
            value={toolKey === 'knowledge_lookup'
              ? draftTool?.parameter_descriptions?.query || ''
              : draftTool?.parameter_descriptions?.reason || ''}
            onChange={(event) => onChange({
              ...draftTool,
              parameter_descriptions: toolKey === 'knowledge_lookup'
                ? { ...(draftTool?.parameter_descriptions || {}), query: event.target.value }
                : { ...(draftTool?.parameter_descriptions || {}), reason: event.target.value }
            })}
          />
        </Field>
      )}
    </section>
  );
}

function PhraseGroupCard({ label, hint, values, savedValues, onChange }) {
  return (
    <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{label}</h2>
          <div className="mt-1 text-sm text-slate-500">{hint}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => onChange(savedValues || [])}>Reset Group</Button>
      </div>
      <TextArea
        value={joinLines(values)}
        onChange={(event) => onChange(splitLines(event.target.value))}
        className="min-h-[180px]"
      />
    </section>
  );
}

function buildSectionMap(sections) {
  return Object.fromEntries((sections || []).map((section) => [section.section_id, section]));
}

function buildRenderedSectionMap(renderedSections) {
  return Object.fromEntries((renderedSections || []).map((section) => [section.section_id, section]));
}

const SECTION_GROUPS = [
  {
    id: 'identity-context',
    title: 'Identity And Context',
    description: 'Who the assistant is, what the business does, and the fixed opening/wording context.',
    defaultOpen: true,
    sectionIds: ['role_objective', 'business_context', 'wording_preferences']
  },
  {
    id: 'conversation-behavior',
    title: 'Conversation Behavior',
    description: 'How the assistant should sound, discover context, and move through the conversation.',
    defaultOpen: false,
    sectionIds: [
      'priority_order',
      'personality_tone',
      'core_behavioral_rules',
      'conversational_attunement',
      'readiness_before_callback_capture'
    ]
  },
  {
    id: 'lead-capture-safety',
    title: 'Lead Capture And Safety',
    description: 'Callback capture, accuracy, audio safety, conversation staging, and closing behavior.',
    defaultOpen: false,
    sectionIds: [
      'lead_capture_rules',
      'name_and_phone_accuracy',
      'audio_conversation_safety',
      'conversation_flow',
      'closing'
    ]
  },
  {
    id: 'tools-boundaries',
    title: 'Tools And Boundaries',
    description: 'How the assistant should use tools, resume the call flow after lookups, and stay within factual boundaries.',
    defaultOpen: false,
    sectionIds: ['tools', 'knowledge_boundaries']
  }
];

function JumpLink({ href, label }) {
  return (
    <a
      href={href}
      className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {label}
    </a>
  );
}

function CollapsibleSectionGroup({ id, title, description, defaultOpen, children }) {
  return (
    <details id={id} open={defaultOpen} className="rounded-xl border border-border bg-card shadow-sm">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Open Group</span>
        </div>
      </summary>
      <div className="grid gap-4 border-t border-slate-200 p-4 pt-4">
        {children}
      </div>
    </details>
  );
}

export default function AdminPromptConfigPage() {
  const [loading, setLoading] = useState(true);
  const [loadingTenant, setLoadingTenant] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState('');

  const [blueprints, setBlueprints] = useState([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState('');
  const [savedBlueprint, setSavedBlueprint] = useState(null);
  const [draftBlueprint, setDraftBlueprint] = useState(null);

  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [savedTenantConfig, setSavedTenantConfig] = useState(null);
  const [draftTenantProfile, setDraftTenantProfile] = useState(null);
  const [draftSectionOverrides, setDraftSectionOverrides] = useState({});
  const [tenantFieldSources, setTenantFieldSources] = useState({});

  const [runtimeEntryMode, setRuntimeEntryMode] = useState('customer_call');
  const [previewMode, setPreviewMode] = useState('draft');
  const [preview, setPreview] = useState(null);

  const selectedTenantRecord = tenants.find((tenant) => tenant.tenant_key === selectedTenant) || null;

  const loadPreview = async (
    tenantKey = selectedTenant,
    blueprint = draftBlueprint,
    tenantProfile = draftTenantProfile,
    sectionOverrides = draftSectionOverrides
  ) => {
    if (!tenantKey || !blueprint || !tenantProfile) return;
    setPreviewing(true);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          runtimeEntryMode,
          blueprint,
          tenantProfile,
          sectionOverrides
        })
      });
      setPreview(data);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const loadTenantConfig = async (tenantKey = selectedTenant, blueprintId = selectedBlueprintId) => {
    if (!tenantKey) return;
    setLoadingTenant(true);
    try {
      const data = await fetchJson(`/api/v1/admin/system/prompts/tenant-config?tenantKey=${encodeURIComponent(tenantKey)}&promptBlueprintId=${encodeURIComponent(blueprintId || '')}`);
      const next = {
        profile: data.profile,
        section_overrides: data.section_overrides || {}
      };
      setSavedTenantConfig(next);
      setDraftTenantProfile(data.profile);
      setDraftSectionOverrides(
        Object.fromEntries(
          Object.entries(data.section_overrides || {}).map(([sectionId, value]) => [sectionId, value.override_text || ''])
        )
      );
      setTenantFieldSources(data.field_sources || {});
      await loadPreview(tenantKey, draftBlueprint, data.profile, Object.fromEntries(
        Object.entries(data.section_overrides || {}).map(([sectionId, value]) => [sectionId, value.override_text || ''])
      ));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load tenant prompt config.');
    } finally {
      setLoadingTenant(false);
    }
  };

  const loadPage = async (promptBlueprintId = '') => {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/v1/admin/system/prompts${promptBlueprintId ? `?promptBlueprintId=${encodeURIComponent(promptBlueprintId)}` : ''}`);
      const activeBlueprint = data.active_blueprint;
      const nextBlueprintId = activeBlueprint?.prompt_blueprint_id || data.blueprints?.[0]?.prompt_blueprint_id || '';
      const nextTenant = selectedTenant || data.tenants?.[0]?.tenant_key || '';
      setBlueprints(Array.isArray(data.blueprints) ? data.blueprints : []);
      setSavedBlueprint(activeBlueprint);
      setDraftBlueprint(activeBlueprint);
      setSelectedBlueprintId(nextBlueprintId);
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
      setSelectedTenant(nextTenant);
      setStatus('Prompt blueprint loaded.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load prompt blueprint.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    if (!loading && selectedTenant && selectedBlueprintId) {
      void loadTenantConfig(selectedTenant, selectedBlueprintId);
    }
  }, [loading, selectedTenant, selectedBlueprintId]);

  useEffect(() => {
    if (!loading && selectedTenant && draftBlueprint && draftTenantProfile) {
      void loadPreview();
    }
  }, [runtimeEntryMode]);

  const savedSectionMap = useMemo(() => buildSectionMap(savedBlueprint?.sections), [savedBlueprint]);
  const draftSectionMap = useMemo(() => buildSectionMap(draftBlueprint?.sections), [draftBlueprint]);
  const liveRenderedSectionMap = useMemo(() => buildRenderedSectionMap(preview?.live?.renderedSections), [preview]);
  const draftRenderedSectionMap = useMemo(() => buildRenderedSectionMap(preview?.draft?.renderedSections), [preview]);

  const updateDraftSection = (sectionId, value) => {
    setDraftBlueprint((current) => ({
      ...current,
      sections: (current.sections || []).map((section) => (
        section.section_id === sectionId
          ? { ...section, default_text: value }
          : section
      ))
    }));
  };

  const updatePhraseGroup = (groupId, value) => {
    setDraftBlueprint((current) => ({
      ...current,
      sample_phrase_groups: {
        ...(current.sample_phrase_groups || {}),
        [groupId]: value
      }
    }));
  };

  const updateToolDefinition = (toolKey, value) => {
    setDraftBlueprint((current) => ({
      ...current,
      tool_definitions: {
        ...(current.tool_definitions || {}),
        [toolKey]: value
      }
    }));
  };

  const updateTenantProfile = (key, value) => {
    setDraftTenantProfile((current) => ({ ...current, [key]: value }));
  };

  const updateTenantOverride = (sectionId, value) => {
    setDraftSectionOverrides((current) => ({ ...current, [sectionId]: value }));
  };

  const saveGlobalBlueprint = async () => {
    setSavingGlobal(true);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint: draftBlueprint })
      });
      setBlueprints(data.blueprints || []);
      setSavedBlueprint(data.active_blueprint);
      setDraftBlueprint(data.active_blueprint);
      setStatus('Global blueprint saved.');
      await loadPreview(selectedTenant, data.active_blueprint, draftTenantProfile, draftSectionOverrides);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save blueprint.');
    } finally {
      setSavingGlobal(false);
    }
  };

  const saveTenantConfig = async () => {
    if (!selectedTenant) return;
    setSavingTenant(true);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/tenant-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey: selectedTenant,
          promptBlueprintId: selectedBlueprintId,
          profile: draftTenantProfile,
          sectionOverrides: draftSectionOverrides
        })
      });
      const next = {
        profile: data.profile,
        section_overrides: data.section_overrides || {}
      };
      setSavedTenantConfig(next);
      setDraftTenantProfile(data.profile);
      setDraftSectionOverrides(
        Object.fromEntries(
          Object.entries(data.section_overrides || {}).map(([sectionId, value]) => [sectionId, value.override_text || ''])
        )
      );
      setTenantFieldSources(data.field_sources || {});
      setStatus('Selected tenant prompt config saved.');
      await loadPreview(selectedTenant, draftBlueprint, data.profile, Object.fromEntries(
        Object.entries(data.section_overrides || {}).map(([sectionId, value]) => [sectionId, value.override_text || ''])
      ));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save tenant prompt config.');
    } finally {
      setSavingTenant(false);
    }
  };

  const resetDraftBlueprintToSaved = () => {
    setDraftBlueprint(cloneValue(savedBlueprint));
    setStatus('Global blueprint draft reset to the last saved version.');
  };

  const resetTenantToSaved = () => {
    if (!savedTenantConfig) return;
    setDraftTenantProfile(cloneValue(savedTenantConfig.profile));
    setDraftSectionOverrides(
      Object.fromEntries(
        Object.entries(savedTenantConfig.section_overrides || {}).map(([sectionId, value]) => [sectionId, value.override_text || ''])
      )
    );
    setStatus('Tenant draft reset to the last saved version.');
  };

  const resetTenantToDefaults = async () => {
    if (!selectedTenant) return;
    setSavingTenant(true);
    try {
      const data = await fetchJson('/api/v1/admin/system/prompts/tenant-config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey: selectedTenant,
          promptBlueprintId: selectedBlueprintId,
          mode: 'all'
        })
      });
      const next = {
        profile: data.profile,
        section_overrides: data.section_overrides || {}
      };
      setSavedTenantConfig(next);
      setDraftTenantProfile(data.profile);
      setDraftSectionOverrides({});
      setTenantFieldSources(data.field_sources || {});
      setStatus('Tenant prompt config reset to inherited defaults.');
      await loadPreview(selectedTenant, draftBlueprint, data.profile, {});
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to reset tenant prompt config.');
    } finally {
      setSavingTenant(false);
    }
  };

  if (loading || !draftBlueprint || !savedBlueprint) {
    return (
      <section className="grid gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Prompt Blueprint</h1>
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-slate-500 shadow-sm">
          {status || 'Loading...'}
        </div>
      </section>
    );
  }

  const previewDraft = preview?.draft || null;
  const previewLive = preview?.live || null;
  const groupedSections = SECTION_GROUPS.map((group) => ({
    ...group,
    sections: group.sectionIds
      .map((sectionId) => draftSectionMap[sectionId])
      .filter(Boolean)
  })).filter((group) => group.sections.length);
  const previewActionLabel = previewMode === 'compare'
    ? 'Generate Compare Preview'
    : previewMode === 'live'
      ? 'Generate Live Preview'
      : 'Generate Draft Preview';

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Prompt Blueprint</h1>
          <p className="mt-1 text-sm text-slate-500">
            The startup prompt now comes from one canonical blueprint plus a narrow tenant prompt profile and optional admin-only per-tenant section overrides.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => loadPage(selectedBlueprintId)} disabled={loading || savingGlobal || savingTenant}>Reload</Button>
          <Button variant="outline" onClick={resetDraftBlueprintToSaved} disabled={savingGlobal}>Reset Global To Saved</Button>
          <Button onClick={saveGlobalBlueprint} disabled={savingGlobal}>{savingGlobal ? 'Saving...' : 'Save Global Blueprint'}</Button>
          <Button variant="outline" onClick={resetTenantToSaved} disabled={savingTenant || !savedTenantConfig}>Reset Tenant To Saved</Button>
          <Button variant="outline" onClick={resetTenantToDefaults} disabled={savingTenant || !selectedTenant}>Reset Tenant To Defaults</Button>
          <Button onClick={saveTenantConfig} disabled={savingTenant || !selectedTenant || !draftTenantProfile}>{savingTenant ? 'Saving...' : 'Save Tenant Prompt Config'}</Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm lg:grid-cols-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">Global Blueprint Scope</div>
          <p className="mt-1 text-sm text-slate-600">
            Global section text, sample phrase groups, and tool descriptions affect every tenant that uses this blueprint.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">Selected Tenant Scope</div>
          <p className="mt-1 text-sm text-slate-600">
            Tenant fields and section overrides affect only <span className="font-medium text-slate-900">{selectedTenantRecord?.name || 'the selected tenant'}</span>.
          </p>
          <div className="mt-2 text-xs text-slate-500">
            Tenant key: <code>{selectedTenant || 'none selected'}</code>
          </div>
        </div>
      </div>

      <section className="flex flex-wrap gap-2">
        <JumpLink href="#preview" label="1. Preview" />
        <JumpLink href="#tenant-context" label="2. Tenant Context" />
        <JumpLink href="#admin-assets" label="3. Phrase Groups And Tools" />
        <JumpLink href="#prompt-sections" label="4. Prompt Sections" />
        <JumpLink href="#runtime-debug" label="5. Runtime Debug" />
      </section>

      <section id="preview" className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Preview And Generate</h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose the blueprint, tenant, and entry mode here. Then generate a preview to see the exact full startup prompt that will be sent to Realtime.
            </p>
          </div>
          <Button variant="outline" onClick={() => loadPreview()} disabled={previewing || !selectedTenant || !draftTenantProfile}>
            {previewing ? 'Generating...' : previewActionLabel}
          </Button>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.22fr)]">
          <section className="grid self-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">Preview Controls</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <Field label="Blueprint Version" hint="The canonical prompt blueprint being edited. Global changes affect every tenant using this blueprint.">
                <select
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={selectedBlueprintId}
                  onChange={async (event) => {
                    const nextId = event.target.value;
                    setSelectedBlueprintId(nextId);
                    await loadPage(nextId);
                  }}
                >
                  {blueprints.map((blueprint) => (
                    <option key={blueprint.prompt_blueprint_id} value={blueprint.prompt_blueprint_id}>
                      {blueprint.name} (v{blueprint.version})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tenant" hint="Loads the selected tenant’s business-facing values plus any admin-only section overrides.">
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
              <Field label="Runtime Entry Mode" hint="Uses the same production composition path as the live gateway prompt for this entry mode.">
                <select
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={runtimeEntryMode}
                  onChange={(event) => setRuntimeEntryMode(event.target.value)}
                >
                  <option value="customer_call">customer_call</option>
                  <option value="setup_interview">setup_interview</option>
                </select>
              </Field>
              <Field label="Preview View" hint="Draft uses unsaved edits on this page. Live shows the last saved configuration. Compare shows both side by side.">
                <select
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={previewMode}
                  onChange={(event) => setPreviewMode(event.target.value)}
                >
                  <option value="draft">draft effective</option>
                  <option value="live">live effective</option>
                  <option value="compare">compare</option>
                </select>
              </Field>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
              <div className="font-medium text-slate-900">How to get the full prompt</div>
              <div className="mt-2">
                1. Pick the tenant and entry mode.
              </div>
              <div>2. Click <span className="font-medium text-slate-900">{previewActionLabel}</span>.</div>
              <div>3. Read the result in <span className="font-medium text-slate-900">Full Rendered Startup Prompt</span> on the right.</div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Full Rendered Startup Prompt</h3>
                <p className="mt-1 text-sm text-slate-500">
                  This is the complete prompt sent at session start. It is the main behavior source for the call.
                </p>
              </div>
              <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-700">
                {previewMode === 'compare' ? 'draft vs live' : previewMode}
              </span>
            </div>
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.renderedStartupPrompt}
              live={previewLive?.renderedStartupPrompt}
              render={(value) => <CodeBlock value={value || 'Generate a preview to see the full startup prompt.'} />}
            />
          </section>
        </div>
      </section>

      <section id="tenant-context" className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tenant Context</h2>
          <p className="mt-1 text-sm text-slate-500">
            These are the narrow business-facing values that shape the rendered prompt for the selected tenant. They should stay separate from the hidden behavior sections.
          </p>
        </div>
        {loadingTenant || !draftTenantProfile ? (
          <div className="text-sm text-slate-500">Loading tenant prompt config...</div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">Identity</div>
              <TenantFieldBlock label="Assistant Name" hint="Inserted into the startup prompt and opening line." state={tenantFieldSources.assistant_name} draftValue={draftTenantProfile.assistant_name}>
                <TextInput value={draftTenantProfile.assistant_name || ''} onChange={(event) => updateTenantProfile('assistant_name', event.target.value)} />
              </TenantFieldBlock>

              <TenantFieldBlock label="Business Name" hint="Inserted into the startup prompt and opening line." state={tenantFieldSources.business_name} draftValue={draftTenantProfile.business_name}>
                <TextInput value={draftTenantProfile.business_name || ''} onChange={(event) => updateTenantProfile('business_name', event.target.value)} />
              </TenantFieldBlock>

              <TenantFieldBlock label="Company Description" hint="Business narrative used in the business-context section." state={tenantFieldSources.company_description} draftValue={draftTenantProfile.company_description}>
                <TextArea value={draftTenantProfile.company_description || ''} onChange={(event) => updateTenantProfile('company_description', event.target.value)} />
              </TenantFieldBlock>
            </div>

            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">Opening And Closing</div>
              <TenantFieldBlock label="Opening Line" hint="Exact first-turn wording for this tenant." state={tenantFieldSources.opening_line} draftValue={draftTenantProfile.opening_line}>
                <TextArea value={draftTenantProfile.opening_line || ''} onChange={(event) => updateTenantProfile('opening_line', event.target.value)} />
              </TenantFieldBlock>

              <TenantFieldBlock label="AI Disclosure" hint="Used when the caller asks whether the assistant is a robot or AI." state={tenantFieldSources.ai_disclosure_line} draftValue={draftTenantProfile.ai_disclosure_line}>
                <TextArea value={draftTenantProfile.ai_disclosure_line || ''} onChange={(event) => updateTenantProfile('ai_disclosure_line', event.target.value)} />
              </TenantFieldBlock>

              <TenantFieldBlock label="Closing Phrase" hint="Preferred short closing used in the closing section." state={tenantFieldSources.closing_phrase} draftValue={draftTenantProfile.closing_phrase}>
                <TextArea value={draftTenantProfile.closing_phrase || ''} onChange={(event) => updateTenantProfile('closing_phrase', event.target.value)} />
              </TenantFieldBlock>
            </div>

            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">Lead Capture Context</div>
              <TenantFieldBlock label="Lead Goal" hint="Business-facing next-step type, such as callback information or consultation request." state={tenantFieldSources.lead_goal} draftValue={draftTenantProfile.lead_goal}>
                <TextInput value={draftTenantProfile.lead_goal || ''} onChange={(event) => updateTenantProfile('lead_goal', event.target.value)} />
              </TenantFieldBlock>

              <TenantFieldBlock label="Required Contact Fields" hint="One field per line. Drives the required callback-information list in the rendered prompt." state={tenantFieldSources.required_contact_fields} draftValue={draftTenantProfile.required_contact_fields}>
                <TextArea
                  value={joinLines(draftTenantProfile.required_contact_fields)}
                  onChange={(event) => updateTenantProfile('required_contact_fields', splitLines(event.target.value))}
                />
              </TenantFieldBlock>

              <TenantFieldBlock label="Basic No-Tool Allowed Statement" hint="Narrow business statement allowed without `knowledge_lookup`." state={tenantFieldSources.basic_no_tool_allowed_statement} draftValue={draftTenantProfile.basic_no_tool_allowed_statement}>
                <TextArea
                  value={draftTenantProfile.basic_no_tool_allowed_statement || ''}
                  onChange={(event) => updateTenantProfile('basic_no_tool_allowed_statement', event.target.value)}
                />
              </TenantFieldBlock>
            </div>
          </div>
        )}
      </section>

      <section id="admin-assets" className="grid gap-4 xl:grid-cols-2">
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sample Phrase Groups</h2>
            <p className="mt-1 text-sm text-slate-500">
              Admin-only phrase inspiration. These do not appear to tenants.
            </p>
          </div>
          <div className="grid gap-4">
            <PhraseGroupCard
              label="Greeting Samples"
              hint="Short opening alternatives the model can treat as inspiration without repeating verbatim."
              values={draftBlueprint.sample_phrase_groups?.greeting_samples || []}
              savedValues={savedBlueprint.sample_phrase_groups?.greeting_samples || []}
              onChange={(value) => updatePhraseGroup('greeting_samples', value)}
            />
            <PhraseGroupCard
              label="Acknowledgement Samples"
              hint="Examples of brief, natural acknowledgement turns."
              values={draftBlueprint.sample_phrase_groups?.acknowledgement_samples || []}
              savedValues={savedBlueprint.sample_phrase_groups?.acknowledgement_samples || []}
              onChange={(value) => updatePhraseGroup('acknowledgement_samples', value)}
            />
            <PhraseGroupCard
              label="Discovery-Question Samples"
              hint="Examples of one-at-a-time discovery questions."
              values={draftBlueprint.sample_phrase_groups?.discovery_question_samples || []}
              savedValues={savedBlueprint.sample_phrase_groups?.discovery_question_samples || []}
              onChange={(value) => updatePhraseGroup('discovery_question_samples', value)}
            />
            <PhraseGroupCard
              label="Fit-Bridge Samples"
              hint="Examples of gentle ‘this sounds like something we may be able to help with’ bridges."
              values={draftBlueprint.sample_phrase_groups?.fit_bridge_samples || []}
              savedValues={savedBlueprint.sample_phrase_groups?.fit_bridge_samples || []}
              onChange={(value) => updatePhraseGroup('fit_bridge_samples', value)}
            />
            <PhraseGroupCard
              label="Callback-Request Samples"
              hint="Examples of low-pressure callback capture phrasing."
              values={draftBlueprint.sample_phrase_groups?.callback_request_samples || []}
              savedValues={savedBlueprint.sample_phrase_groups?.callback_request_samples || []}
              onChange={(value) => updatePhraseGroup('callback_request_samples', value)}
            />
            <PhraseGroupCard
              label="Closing Samples"
              hint="Examples of short, warm closes."
              values={draftBlueprint.sample_phrase_groups?.closing_samples || []}
              savedValues={savedBlueprint.sample_phrase_groups?.closing_samples || []}
              onChange={(value) => updatePhraseGroup('closing_samples', value)}
            />
          </div>
        </section>

        <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Runtime Tool Text</h2>
            <p className="mt-1 text-sm text-slate-500">
              Actual tool names and schema stay code-driven. Only the descriptive text is editable here.
            </p>
          </div>
          <div className="grid gap-4">
            <ToolDefinitionCard
              title="knowledge_lookup"
              toolKey="knowledge_lookup"
              draftTool={draftBlueprint.tool_definitions?.knowledge_lookup || {}}
              savedTool={savedBlueprint.tool_definitions?.knowledge_lookup || {}}
              onChange={(value) => updateToolDefinition('knowledge_lookup', value)}
            />
            <ToolDefinitionCard
              title="data_capture"
              toolKey="data_capture"
              draftTool={draftBlueprint.tool_definitions?.data_capture || {}}
              savedTool={savedBlueprint.tool_definitions?.data_capture || {}}
              onChange={(value) => updateToolDefinition('data_capture', value)}
            />
            <ToolDefinitionCard
              title="finish_session"
              toolKey="finish_session"
              draftTool={draftBlueprint.tool_definitions?.finish_session || {}}
              savedTool={savedBlueprint.tool_definitions?.finish_session || {}}
              onChange={(value) => updateToolDefinition('finish_session', value)}
            />
          </div>
        </section>
      </section>

      <section id="prompt-sections" className="grid gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Prompt Sections</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sections are grouped by purpose so related instructions stay together. Canonical text is global; tenant override text affects only the selected tenant.
          </p>
        </div>
        {groupedSections.map((group) => (
          <CollapsibleSectionGroup
            key={group.id}
            id={group.id}
            title={group.title}
            description={group.description}
            defaultOpen={group.defaultOpen}
          >
            {group.sections.map((section) => (
              <SectionCard
                key={section.section_id}
                section={section}
                savedSection={savedSectionMap[section.section_id]}
                tenantOverride={draftSectionOverrides[section.section_id] || ''}
                savedTenantOverride={savedTenantConfig?.section_overrides?.[section.section_id]?.override_text || ''}
                onSectionChange={(value) => updateDraftSection(section.section_id, value)}
                onTenantOverrideChange={(value) => updateTenantOverride(section.section_id, value)}
                effectiveDraft={draftRenderedSectionMap[section.section_id]?.text || ''}
                effectiveLive={liveRenderedSectionMap[section.section_id]?.text || ''}
                previewMode={previewMode}
              />
            ))}
          </CollapsibleSectionGroup>
        ))}
      </section>

      <section id="runtime-debug" className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Runtime Debug</h2>
            <p className="mt-1 text-sm text-slate-500">
              Lower-level payloads from the same production composition path. Useful when the rendered full prompt alone is not enough.
            </p>
          </div>
          <Button variant="outline" onClick={() => loadPreview()} disabled={previewing || !selectedTenant}>
            {previewing ? 'Refreshing...' : 'Refresh Runtime Debug'}
          </Button>
        </div>

        <details className="rounded-xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none p-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Runtime Tool Config</h3>
              <p className="mt-1 text-sm text-slate-500">
                Runtime-exposed tool definitions after the code-driven registry is merged with admin text.
              </p>
            </div>
          </summary>
          <div className="border-t border-slate-200 p-4">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.runtimeToolDefinitions}
              live={previewLive?.runtimeToolDefinitions}
              render={(value) => <CodeBlock value={JSON.stringify(value || [], null, 2)} />}
            />
          </div>
        </details>

        <details className="rounded-xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none p-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Gateway Prompt Output</h3>
              <p className="mt-1 text-sm text-slate-500">
                Full output from the same builder used by <code>/api/v1/gateway/prompt</code>.
              </p>
            </div>
          </summary>
          <div className="border-t border-slate-200 p-4">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.gatewayPromptOutput}
              live={previewLive?.gatewayPromptOutput}
              render={(value) => <CodeBlock value={JSON.stringify(value || {}, null, 2)} />}
            />
          </div>
        </details>

        <details className="rounded-xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer list-none p-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Effective Sections</h3>
              <p className="mt-1 text-sm text-slate-500">
                The per-section rendered output after blueprint text, tenant values, and tenant overrides are applied.
              </p>
            </div>
          </summary>
          <div className="border-t border-slate-200 p-4">
            <PreviewModeContent
              mode={previewMode}
              draft={previewDraft?.renderedSections}
              live={previewLive?.renderedSections}
              render={(value) => <CodeBlock value={JSON.stringify(value || [], null, 2)} />}
            />
          </div>
        </details>
      </section>

      {status ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 shadow-sm">
          {status}
        </div>
      ) : null}
    </section>
  );
}

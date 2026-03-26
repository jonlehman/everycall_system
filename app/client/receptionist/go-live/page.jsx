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
    hint: 'Confirm the hours in Call Handling are current.'
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

const BLOCKER_METADATA = {
  domain_assignment_required: {
    title: 'Business assignment is still missing',
    description: 'The platform does not yet have the canonical business/domain assignment needed for runtime.',
    area: 'support'
  },
  business_call_intent_required: {
    title: 'Business setup is incomplete',
    description: 'Core business call intent settings still need to be configured.',
    area: 'support'
  },
  business_call_stage_playbook_required: {
    title: 'Call flow playbook is incomplete',
    description: 'The business conversation stages still need to be configured.',
    area: 'support'
  },
  disclosure_strategy_required: {
    title: 'Disclosure strategy is missing',
    description: 'The AI disclosure mode has not been configured for this tenant.',
    area: 'support'
  },
  preferred_outcomes_required: {
    title: 'Preferred outcomes are missing',
    description: 'The platform still needs the approved business outcomes for inbound calls.',
    area: 'support'
  },
  published_build_required: {
    title: 'No published knowledge build yet',
    description: 'Create and publish a build before the receptionist can be considered ready.',
    area: 'knowledge',
    href: '/client/receptionist/knowledge',
    cta: 'Open Knowledge'
  },
  latest_build_must_be_published: {
    title: 'Latest build is not published',
    description: 'The newest build exists, but it has not been published to the live runtime yet.',
    area: 'knowledge',
    href: '/client/receptionist/knowledge',
    cta: 'Open Knowledge'
  },
  active_build_pointer_required: {
    title: 'No active build is selected',
    description: 'A published build exists, but the live runtime is not pointing at an active build.',
    area: 'knowledge',
    href: '/client/receptionist/knowledge',
    cta: 'Open Knowledge'
  },
  active_build_must_match_latest_published_build: {
    title: 'Live runtime is not using the latest published build',
    description: 'The active build pointer must match the latest published build before launch.',
    area: 'knowledge',
    href: '/client/receptionist/knowledge',
    cta: 'Open Knowledge'
  },
  latest_build_has_validation_blockers: {
    title: 'Latest build still has validation blockers',
    description: 'The latest build contains validation blockers that need to be resolved before launch.',
    area: 'knowledge',
    href: '/client/receptionist/knowledge',
    cta: 'Open Knowledge'
  },
  call_outcome_schema_required: {
    title: 'Lead capture schema is missing',
    description: 'Outcome capture rules still need to be configured for this tenant.',
    area: 'support'
  },
  runtime_profile_required: {
    title: 'Greeting and runtime profile still need to be saved',
    description: 'The receptionist needs a saved greeting/runtime profile before launch.',
    area: 'call_handling',
    href: '/client/receptionist/call-handling',
    cta: 'Open Call Handling'
  },
  hours_confirmation_required: {
    title: 'Business hours have not been confirmed',
    description: 'Review and confirm business hours in the client checklist.',
    area: 'checklist'
  },
  address_confirmation_required: {
    title: 'Business address has not been confirmed',
    description: 'Confirm the business address in the client checklist.',
    area: 'checklist'
  },
  phone_confirmation_required: {
    title: 'Main business phone has not been confirmed',
    description: 'Confirm the main phone number in the client checklist.',
    area: 'checklist'
  },
  after_hours_configuration_required: {
    title: 'After-hours handling has not been confirmed',
    description: 'Review and confirm the after-hours behavior in the client checklist.',
    area: 'checklist'
  },
  service_area_confirmation_required: {
    title: 'Service area has not been confirmed',
    description: 'Confirm the locations this business actively serves.',
    area: 'checklist'
  },
  dangerous_question_review_required: {
    title: 'Safety and escalation rules are still missing',
    description: 'Platform-level guardrails still need to be configured before launch.',
    area: 'support'
  },
  hard_overrides_required: {
    title: 'Approved answers or notices are still missing',
    description: 'The platform still needs approved hard facts, notices, or answer overrides.',
    area: 'support'
  },
  sample_call_validation_required: {
    title: 'Sample calls still need to be validated',
    description: 'Run a few test calls and confirm the receptionist responds correctly.',
    area: 'checklist'
  },
  handoff_path_test_required: {
    title: 'Handoff path still needs testing',
    description: 'Confirm urgent or escalated calls are routed correctly.',
    area: 'checklist'
  },
  outcome_capture_test_required: {
    title: 'Lead capture still needs testing',
    description: 'Confirm caller details and follow-up fields are being captured correctly.',
    area: 'checklist'
  },
  setup_interview_completion_required: {
    title: 'Setup interview still needs completion',
    description: 'A required onboarding/setup interview session has not been completed yet.',
    area: 'support'
  }
};

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

function hasBlocker(blockers, code) {
  return Array.isArray(blockers) && blockers.includes(code);
}

function hasAnyBlocker(blockers, codes) {
  return Array.isArray(codes) && codes.some((code) => hasBlocker(blockers, code));
}

function buildSystemChecks(blockers, computedInputs) {
  const computed = computedInputs || {};
  return [
    {
      key: 'business_setup',
      label: 'Business setup configured',
      complete: !hasAnyBlocker(blockers, [
        'domain_assignment_required',
        'business_call_intent_required',
        'business_call_stage_playbook_required',
        'disclosure_strategy_required',
        'preferred_outcomes_required',
        'setup_interview_completion_required'
      ]),
      description: 'Configured during onboarding and admin setup.',
      area: 'support'
    },
    {
      key: 'runtime_profile',
      label: 'Greeting and voice saved',
      complete: Boolean(computed.runtime_profile_present),
      description: 'The live receptionist needs a greeting/runtime profile.',
      area: 'call_handling',
      href: '/client/receptionist/call-handling',
      cta: 'Open Call Handling'
    },
    {
      key: 'published_build',
      label: 'Latest build published',
      complete: computed.latest_build_status === 'published'
        && Boolean(computed.active_build_id)
        && computed.active_build_id === computed.latest_build_id,
      description: 'The latest published build must also be the active build.',
      area: 'knowledge',
      href: '/client/receptionist/knowledge',
      cta: 'Open Knowledge'
    },
    {
      key: 'guardrails',
      label: 'Safety rules configured',
      complete: Number(computed.guardrail_count || 0) > 0,
      description: 'Escalation and safety rules are managed with support/admin.',
      area: 'support'
    },
    {
      key: 'answers',
      label: 'Approved answers configured',
      complete: Number(computed.hard_override_count || 0) > 0,
      description: 'Approved answers, notices, or hard facts are managed with support/admin.',
      area: 'support'
    },
    {
      key: 'outcome_schema',
      label: 'Lead capture schema ready',
      complete: Boolean(computed.call_outcome_schema_id),
      description: 'Required so lead outcomes and follow-up data save correctly.',
      area: 'support'
    }
  ];
}

function buildBlockerDetails(blockers) {
  return (Array.isArray(blockers) ? blockers : []).map((code) => ({
    code,
    ...(BLOCKER_METADATA[code] || {
      title: code.replaceAll('_', ' '),
      description: 'This launch requirement is still incomplete.',
      area: 'support'
    })
  }));
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

  const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
  const computedInputs = readiness?.computed_inputs || {};
  const latestBuild = buildState.builds[0] || null;
  const blockerDetails = useMemo(() => buildBlockerDetails(blockers), [blockers]);
  const systemChecks = useMemo(() => buildSystemChecks(blockers, computedInputs), [blockers, computedInputs]);
  const clientCompletionCount = useMemo(
    () => CLIENT_CHECKLIST_FIELDS.filter(({ key }) => Boolean(checklist?.[key])).length,
    [checklist]
  );
  const systemCompletionCount = useMemo(
    () => systemChecks.filter((item) => item.complete).length,
    [systemChecks]
  );
  const nextBlocker = blockerDetails[0] || null;
  const launchFlagSet = Boolean(readiness?.requested_go_live);
  const canMarkReady = blockers.length === 0 && !launchFlagSet;
  const latestBuildPublished = computedInputs.latest_build_status === 'published';

  return (
    <SectionPage
      tabs={receptionistNavItems}
      title="Go Live Checklist"
      subtitle="See what is ready, what is still blocking launch, and where each missing item needs to be fixed."
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
          <div className="text-xs uppercase tracking-wide text-slate-500">System Checks</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{systemCompletionCount}/{systemChecks.length}</div>
          <div className="text-sm text-slate-600">Platform and runtime requirements currently passing.</div>
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
                    <div className="mt-1 text-sm leading-6 text-slate-600">{hint}</div>
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
              Resolve the remaining blockers before marking this tenant ready.
            </div>
          ) : null}
        </section>

        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Next Step</h2>
            {nextBlocker ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="font-semibold">{nextBlocker.title}</div>
                <div className="mt-1">{nextBlocker.description}</div>
                {nextBlocker.href ? (
                  <Link className={cn(buttonVariants({ variant: 'outline' }), 'mt-3')} href={nextBlocker.href}>
                    {nextBlocker.cta || 'Open'}
                  </Link>
                ) : (
                  <div className="mt-2 text-xs text-amber-800">This item is completed during onboarding or by support/admin.</div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                All current blockers are clear. The tenant can be marked ready.
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">System Checks</h2>
            <div className="grid gap-2">
              {systemChecks.map((item) => (
                <div key={item.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-900">{item.label}</div>
                    <span className={`badge ${item.complete ? 'ok' : 'warn'}`}>{item.complete ? 'ready' : 'pending'}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                  {item.href ? (
                    <Link className="mt-2 inline-block text-sm text-sky-700 underline" href={item.href}>
                      {item.cta || 'Open'}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Knowledge Runtime</h2>
            <div className="grid gap-2 text-sm text-slate-600">
              <div>Latest build status: <span className="font-medium text-slate-900">{latestBuild?.status || 'none'}</span></div>
              <div>Latest build published: <span className="font-medium text-slate-900">{latestBuildPublished ? 'Yes' : 'No'}</span></div>
              <div>Active build selected: <span className="font-medium text-slate-900">{computedInputs.active_build_id ? 'Yes' : 'No'}</span></div>
              <div>Latest build matches live runtime: <span className="font-medium text-slate-900">{computedInputs.active_build_id && computedInputs.active_build_id === computedInputs.latest_build_id ? 'Yes' : 'No'}</span></div>
            </div>
            <div className="mt-3">
              <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/client/receptionist/knowledge">
                Open Knowledge
              </Link>
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="mt-0 text-lg font-semibold">Current Blockers</h2>
        {blockerDetails.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {blockerDetails.map((item) => (
              <div key={item.code} className="rounded-lg border border-slate-200 p-3">
                <div className="font-medium text-slate-900">{item.title}</div>
                <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                  {item.area === 'checklist' ? 'Fix on this page' : item.area === 'knowledge' ? 'Fix in Knowledge' : item.area === 'call_handling' ? 'Fix in Call Handling' : 'Support / Admin'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-emerald-700">No blockers. This tenant is ready to launch.</div>
        )}
      </section>
    </SectionPage>
  );
}

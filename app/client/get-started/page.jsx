'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import ClientPage from '../_components/ClientPage';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function isWebsiteBuildKind(buildKind) {
  const normalized = String(buildKind || '').trim().toLowerCase();
  return normalized === 'website_base' || normalized === 'legacy_combined';
}

function resolveWebsiteAncestorBuildId(builds, activeBuild) {
  const rows = Array.isArray(builds) ? builds : [];
  const startBuildId = String(activeBuild?.build_id || '').trim();
  if (!startBuildId) return '';
  const byBuildId = new Map(
    rows
      .map((build) => [String(build?.build_id || '').trim(), build])
      .filter(([buildId]) => Boolean(buildId))
  );
  let currentBuildId = startBuildId;
  const visited = new Set();
  while (currentBuildId && !visited.has(currentBuildId)) {
    visited.add(currentBuildId);
    const build = byBuildId.get(currentBuildId);
    if (!build) break;
    if (isWebsiteBuildKind(build.build_kind)) {
      return currentBuildId;
    }
    const nextBuildId = String(build?.base_build_id || '').trim();
    if (!nextBuildId) break;
    currentBuildId = nextBuildId;
  }
  return '';
}

function toneClasses(tone) {
  if (tone === 'ok') {
    return {
      dot: 'bg-emerald-500',
      value: 'text-emerald-700',
      panel: 'border-emerald-100 bg-emerald-50/70'
    };
  }
  if (tone === 'bad') {
    return {
      dot: 'bg-amber-500',
      value: 'text-amber-700',
      panel: 'border-amber-100 bg-amber-50/70'
    };
  }
  return {
    dot: 'bg-[#2563eb]',
    value: 'text-[#2563eb]',
    panel: 'border-blue-100 bg-blue-50/70'
  };
}

function actionButtonClass(disabled = false) {
  if (disabled) {
    return 'inline-flex items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-100 px-8 py-3 text-xs font-bold tracking-[0.18em] text-slate-400 shadow-sm';
  }
  return 'inline-flex items-center justify-center rounded-lg border-2 border-slate-200 bg-white px-8 py-3 text-xs font-bold tracking-[0.18em] text-[#121c2a] shadow-sm transition-all hover:border-[#2563eb] hover:text-[#2563eb] active:scale-95';
}

function SetupStepCard({
  step,
  title,
  headerAside = null,
  description = '',
  descriptionContent = null,
  subdescription = '',
  statusBox = null,
  progress = null,
  action = null,
  className = '',
  actionFullWidth = false
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-8 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.05)] transition-all ${className}`.trim()}>
      <div className="flex h-full flex-col">
        <div className="flex-1">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#121c2a] text-xs font-bold text-white">
                {step}
              </span>
              <h2 className="font-['Space_Grotesk'] text-xl font-bold text-[#121c2a]">{title}</h2>
            </div>
            {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
          </div>

          {statusBox ? (
            <div className={`mb-6 rounded-lg border p-4 ${toneClasses(statusBox.tone).panel}`}>
              {statusBox.heading ? (
                <div className="mb-3 flex items-center gap-2">
                  <span className={`flex h-2 w-2 rounded-full ${toneClasses(statusBox.tone).dot}`} />
                  <span className="block text-[10px] font-bold tracking-[0.15em] text-[#121c2a]">
                    {statusBox.heading}
                  </span>
                </div>
              ) : null}
              {statusBox.label ? (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`flex h-2 w-2 rounded-full ${toneClasses(statusBox.tone).dot}`} />
                  <span className="text-[10px] font-bold tracking-[0.15em] text-[#121c2a]">
                    {statusBox.label}
                    {statusBox.value ? ':' : ''}
                  </span>
                  {statusBox.value ? (
                    <span className={`text-[10px] font-bold tracking-[0.15em] ${toneClasses(statusBox.tone).value}`}>
                      {statusBox.value}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {statusBox.message ? (
                <p className="text-sm leading-relaxed text-slate-600">
                  {statusBox.message}
                </p>
              ) : null}
              {statusBox.lines?.length ? (
                <div className="space-y-1">
                  {statusBox.lines.map((line) => (
                    <p className="flex flex-wrap items-center gap-2 text-sm leading-relaxed text-slate-600" key={`${line.label}-${line.value}`}>
                      <span className="font-medium">{line.blank ? line.label : `${line.label}:`}</span>
                      {!line.blank ? (
                        <span>{line.value}</span>
                      ) : null}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {progress ? (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-500">Setup progress</span>
                <span className="text-sm font-semibold text-slate-700">{progress.percent}% done</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-[#2563eb] transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : null}

          {description ? (
            <p className="text-sm leading-relaxed text-slate-600">{description}</p>
          ) : null}
          {descriptionContent ? (
            <div className={`${description ? 'mt-3' : ''} text-sm leading-relaxed text-slate-600`}>
              {descriptionContent}
            </div>
          ) : null}
          {subdescription ? (
            <p className="mt-4 text-sm leading-relaxed text-slate-600">{subdescription}</p>
          ) : null}
        </div>

        {action ? (
          <div className={actionFullWidth ? 'mt-auto pt-6' : 'mt-10'}>
            <div className={actionFullWidth ? 'w-full' : ''}>
              {action}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProgressPanel({ items }) {
  const totalCount = items.length || 1;
  const completedCount = items.filter((item) => item.done).length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);
  const nextMilestone = items.find((item) => !item.done)?.label || 'Core setup complete';
  const phaseLabel = progressPercent >= 100
    ? 'Ready for live calls'
    : progressPercent > 0
      ? 'Setup in progress'
      : 'Setup not started';

  return (
    <section className="relative overflow-hidden rounded-xl bg-[linear-gradient(135deg,#121c2a_0%,#1e293b_100%)] p-8 text-white shadow-lg">
      <div className="relative z-10">
        <h4 className="mb-2 text-[10px] font-bold tracking-[0.2em] text-blue-300">Onboarding Progress</h4>
        <div className="flex items-baseline gap-3">
          <span className="font-['Space_Grotesk'] text-5xl font-bold tracking-[-0.05em]">{progressPercent}%</span>
          <span className="text-xs font-medium italic text-blue-200/60">{phaseLabel}</span>
        </div>
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-[#2563eb] shadow-[0_0_12px_rgba(37,99,235,0.8)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-8 border-t border-white/10 pt-6">
          <p className="mb-1 text-[10px] font-bold tracking-[0.2em] text-blue-300/80">Next Milestone</p>
          <p className="font-['Space_Grotesk'] text-lg font-semibold text-white">{nextMilestone}</p>
        </div>
      </div>
      <div className="absolute right-[-10px] top-[-10px] opacity-10">
        <span className="material-symbols-outlined text-[140px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          architecture
        </span>
      </div>
    </section>
  );
}

export default function ClientGetStartedPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [packet, setPacket] = useState({
    buildState: { builds: [], activeBuild: null },
    users: [],
    settings: null,
    billing: null,
    connections: [],
    documents: []
  });
  const [savingForwardingStatus, setSavingForwardingStatus] = useState(false);
  const [showSupportSetupModal, setShowSupportSetupModal] = useState(false);

  const dismissSupportSetupModal = () => {
    const nextParams = new URLSearchParams(searchParams?.toString() || '');
    nextParams.delete('support_setup');
    const nextQuery = nextParams.toString();
    setShowSupportSetupModal(false);
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson('/api/v1/knowledge/builds').catch(() => null),
      fetchJson('/api/v1/tenant/users').catch(() => null),
      fetchJson('/api/v1/settings').catch(() => null),
      fetchJson('/api/v1/billing').catch(() => null),
      fetchJson('/api/v1/integrations/connectors').catch(() => null),
      fetchJson('/api/v1/knowledge/uploaded-documents').catch(() => null)
    ]).then(([buildsData, usersData, settingsData, billingData, integrationsData, documentsData]) => {
      if (cancelled) return;
      setPacket({
        buildState: {
          builds: Array.isArray(buildsData?.builds) ? buildsData.builds : [],
          activeBuild: buildsData?.activeBuild || null
        },
        users: Array.isArray(usersData?.users) ? usersData.users : [],
        settings: settingsData || null,
        billing: billingData?.billing || null,
        connections: Array.isArray(integrationsData?.connections) ? integrationsData.connections : [],
        documents: Array.isArray(documentsData?.documents) ? documentsData.documents : []
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchParams?.get('support_setup') === '1') {
      setShowSupportSetupModal(true);
    }
  }, [searchParams]);

  const websiteTraining = useMemo(() => {
    const builds = Array.isArray(packet.buildState.builds) ? packet.buildState.builds : [];
    const activeBuildId = String(packet.buildState.activeBuild?.active_build_id || '').trim();
    const latestLiveBuild = builds.find((build) => String(build?.build_id || '').trim() === activeBuildId) || null;
    const latestWebsiteBuild = builds.find((build) => isWebsiteBuildKind(build?.build_kind)) || null;
    const activeBuildStatus = String(latestLiveBuild?.status || '').trim().toLowerCase();
    const latestWebsiteBuildId = String(latestWebsiteBuild?.build_id || '').trim();
    const liveWebsiteBuildId = resolveWebsiteAncestorBuildId(builds, latestLiveBuild);
    const websiteTrainingDone = Boolean(activeBuildId)
      && activeBuildStatus === 'published'
      && Boolean(latestWebsiteBuildId)
      && latestWebsiteBuildId === liveWebsiteBuildId;
    const latestWebsiteStatus = String(latestWebsiteBuild?.status || '').trim().toLowerCase();

    if (websiteTrainingDone) {
      return {
        done: true,
        tone: 'ok',
        statusValue: 'Complete',
        description: 'Your receptionist can now answer any questions about your business covered on your website.',
        subdescription: ''
      };
    }
    if (latestWebsiteStatus === 'failed') {
      return {
        done: false,
        tone: 'bad',
        statusValue: 'Needs attention',
        description: 'Website training needs attention. Open Knowledge to review the issue with your website crawl.',
        subdescription: ''
      };
    }
    return {
      done: false,
      tone: 'processing',
      statusValue: 'Processing',
      description: 'Training your receptionist using your website.',
      subdescription: ''
    };
  }, [packet.buildState]);

  const leadDestinations = useMemo(() => {
    const configuredUsers = Array.isArray(packet.users)
      ? packet.users.filter((user) => String(user?.status || '').trim().toLowerCase() !== 'disabled')
      : [];
    const emailDestinations = configuredUsers
      .filter((user) => Boolean(user?.lead_alert_email_enabled) && String(user?.email || '').trim())
      .map((user) => String(user.email || '').trim());
    const smsConfiguredDestinations = configuredUsers
      .filter((user) => (
        Boolean(user?.lead_alert_sms_enabled)
        && String(user?.phone_number || '').trim()
      ))
      .map((user) => {
        const phone = formatPhoneDisplay(user.phone_number) || String(user.phone_number || '').trim();
        const smsStatus = String(user?.sms_opt_in_status || '').trim().toLowerCase();
        return {
          display: smsStatus === 'opted_in' ? phone : `${phone} (unconfirmed)`,
          isConfirmed: smsStatus === 'opted_in',
          rawPhone: phone
        };
      });
    const pendingSmsDestinations = smsConfiguredDestinations
      .filter((entry) => !entry.isConfirmed)
      .map((entry) => entry.rawPhone);
    const confirmedSmsDestinations = smsConfiguredDestinations
      .filter((entry) => entry.isConfirmed)
      .map((entry) => entry.rawPhone);

    const configuredDestinations = [...emailDestinations, ...smsConfiguredDestinations.map((entry) => entry.display)];
    const workingDestinations = [...emailDestinations, ...confirmedSmsDestinations];
    const lines = [
      emailDestinations.length
        ? {
            label: 'Email',
            value: new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(emailDestinations)
          }
        : {
            label: 'Email',
            value: '',
            blank: true
          },
      smsConfiguredDestinations.length
        ? {
            label: 'Phone',
            value: new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(
              smsConfiguredDestinations.map((entry) => entry.display)
            )
          }
        : {
            label: 'Phone',
            value: '',
            blank: true
          }
    ];

    return {
      activeUsers: configuredUsers.filter((user) => String(user?.status || '').trim().toLowerCase() === 'active'),
      activeDestinations: workingDestinations,
      configuredDestinations,
      pendingSmsDestinations,
      description: configuredDestinations.length
        ? 'Lead alerts are configured for the destinations shown here.'
        : 'Open Send Leads To and choose which people should receive new lead alerts by email or text.',
      subdescription: '',
      lines
    };
  }, [packet.users]);

  const forwarding = useMemo(() => {
    const tenant = packet.settings?.tenant || {};
    const readiness = packet.settings?.salesReceptionistReadiness || {};
    const formattedNumber = formatPhoneDisplay(tenant.telnyx_voice_number)
      || formatPhoneDisplay(readiness.phoneNumber)
      || String(tenant.telnyx_voice_number || readiness.phoneNumber || '').trim()
      || '';
    const forwardingStatus = String(tenant.forwarding_setup_status || '').trim().toLowerCase();
    const numberReady = Boolean(formattedNumber);

    return {
      number: formattedNumber,
      numberReady,
      forwardingConfigured: forwardingStatus === 'configured',
      statusValue: formattedNumber || 'Setting up',
      tone: formattedNumber ? 'processing' : 'bad',
      description: formattedNumber
        ? 'You have two options:'
        : 'Your receptionist number is still being assigned. It will appear here as soon as it is ready.'
    };
  }, [packet.settings]);

  const approvedDocumentCount = useMemo(() => {
    return Array.isArray(packet.documents)
      ? packet.documents.filter((document) => String(document?.status || '').trim().toLowerCase() === 'approved').length
      : 0;
  }, [packet.documents]);

  const enabledConnectionCount = useMemo(() => {
    return Array.isArray(packet.connections)
      ? packet.connections.filter((connection) => String(connection?.status || '').trim().toLowerCase() === 'enabled').length
      : 0;
  }, [packet.connections]);

  const updateForwardingStatus = async (checked) => {
    if (savingForwardingStatus) return;
    const nextStatus = checked ? 'configured' : 'not_started';
    setSavingForwardingStatus(true);
    try {
      const response = await fetch('/api/v1/tenants/forwarding-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || 'forwarding_status_update_failed');
      }
      setPacket((current) => ({
        ...current,
        settings: {
          ...(current.settings || {}),
          tenant: {
            ...((current.settings && current.settings.tenant) || {}),
            forwarding_setup_status: body?.forwarding?.status || nextStatus,
            forwarding_configured_at: body?.forwarding?.configuredAt || null,
            forwarding_acknowledged_at: body?.forwarding?.acknowledgedAt || null
          }
        }
      }));
    } catch (error) {
      window.alert('Could not update forwarding completion right now.');
    } finally {
      setSavingForwardingStatus(false);
    }
  };

  const progressItems = useMemo(() => [
    { label: 'Teach EveryCall about your business', done: websiteTraining.done },
    { label: 'Choose where leads go', done: leadDestinations.activeDestinations.length > 0 },
    { label: 'Forward your calls', done: forwarding.forwardingConfigured },
    { label: 'Activate billing', done: Boolean(packet.billing?.hasStripeSubscription) },
    { label: 'Add supporting document', done: approvedDocumentCount > 0 },
    { label: 'Connect another tool', done: enabledConnectionCount > 0 },
    { label: 'Invite another user', done: leadDestinations.activeUsers.length > 1 }
  ], [
    approvedDocumentCount,
    enabledConnectionCount,
    forwarding.forwardingConfigured,
    leadDestinations.activeUsers.length,
    leadDestinations.activeDestinations.length,
    packet.billing?.hasStripeSubscription,
    websiteTraining.done
  ]);
  const progressPercent = useMemo(() => {
    const totalCount = progressItems.length || 1;
    const completedCount = progressItems.filter((item) => item.done).length;
    return Math.round((completedCount / totalCount) * 100);
  }, [progressItems]);

  return (
    <>
      <ClientPage className="gap-4 pt-2 md:pt-3">
        <div className="mx-auto w-full max-w-5xl">
        <header className="mt-12 mb-7 flex flex-col gap-3 md:mb-8 md:flex-row md:items-start md:justify-between">
          <h1 className="mb-2 font-['Space_Grotesk'] text-4xl font-bold tracking-[-0.05em] text-[#121c2a] md:text-5xl">
            Get Started.
            <br />
            <span className="font-medium text-[#2563eb]">Prepare EveryCall for live calls.</span>
          </h1>
          <a
            href="https://calendly.com/jonlehman/everycall-setup"
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-col items-start self-start rounded-3xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-left text-sm font-semibold leading-tight text-[#2563eb] shadow-sm transition-colors hover:bg-[#dbeafe] hover:text-[#1d4ed8]"
          >
            <span>Get Help</span>
            <span className="mt-1 text-xs font-medium text-[#1d4ed8]">Schedule Onboarding Session</span>
          </a>
        </header>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <SetupStepCard
            step="1"
            title="Teach EveryCall About Your Business"
            description=""
            subdescription={websiteTraining.subdescription}
            statusBox={{
              label: 'Website Crawl Status',
              value: websiteTraining.statusValue,
              tone: websiteTraining.tone,
              message: websiteTraining.description
            }}
            progress={{ percent: progressPercent }}
            className="md:col-span-12 lg:col-span-7"
            action={(
              websiteTraining.done ? (
                <Link
                  href="/client/receptionist/knowledge"
                  className={actionButtonClass(false)}
                >
                  Edit
                </Link>
              ) : (
                <button type="button" disabled className={actionButtonClass(true)}>
                  Edit
                </button>
              )
            )}
          />

          <SetupStepCard
            step="2"
            title="Choose Where Leads Go"
            description=""
            subdescription={leadDestinations.subdescription}
            statusBox={{
              heading: 'Leads currently go to',
              tone: leadDestinations.activeDestinations.length
                ? 'ok'
                : leadDestinations.configuredDestinations.length
                  ? 'processing'
                  : 'bad',
              lines: leadDestinations.lines.length ? leadDestinations.lines : [
                { label: 'Status', value: 'No lead destinations configured yet' }
              ]
            }}
            className="md:col-span-6 lg:col-span-5"
            action={(
              <div className="flex items-center gap-3">
                <Link
                  href="/client/team"
                  className={actionButtonClass(false)}
                >
                  Edit
                </Link>
                <span className="text-sm font-medium text-slate-500">(add more people)</span>
              </div>
            )}
          />

          <SetupStepCard
            step="3"
            title="How to Use This Number"
            headerAside={(
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <span>Calls Forwarded</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-[#2563eb] focus:ring-[#2563eb]"
                  checked={forwarding.forwardingConfigured}
                  disabled={savingForwardingStatus}
                  onChange={(event) => updateForwardingStatus(event.target.checked)}
                />
              </label>
            )}
            description={forwarding.description}
            descriptionContent={forwarding.numberReady ? (
              <ul className="list-disc space-y-2 pl-5">
                <li>Set your business phone system or cell phone so that it forwards desired calls to the Receptionist Number.</li>
                <li>Use this number as your primary business number and have it answer all incoming calls. (Note that EveryCall cannot forward calls currently. It only texts and emails call summaries.)</li>
              </ul>
            ) : null}
            statusBox={{
              label: 'Receptionist Number',
              value: forwarding.statusValue,
              tone: forwarding.forwardingConfigured ? 'ok' : forwarding.numberReady ? 'processing' : 'bad'
            }}
            className="md:col-span-6 lg:col-span-7"
            action={forwarding.numberReady ? (
              <button
                type="button"
                className={actionButtonClass(false)}
                onClick={() => navigator.clipboard?.writeText(forwarding.number).catch(() => {})}
              >
                Copy Number
              </button>
            ) : null}
          />

          <div className="md:col-span-12 lg:col-span-5">
            <ProgressPanel items={progressItems} />
          </div>
          </div>
        </div>
      </ClientPage>

      {showSupportSetupModal ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 px-5 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-7 shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
            <div className="grid gap-3">
              <h2 className="font-['Space_Grotesk'] text-3xl font-bold tracking-[-0.04em] text-[#121c2a]">
                No website? We&apos;ll help you get set up.
              </h2>
              <p className="text-sm leading-7 text-slate-600">
                Since you do not have a website yet, the fastest path is a short setup call with support. Pick a time that works for you and we&apos;ll help configure your sales receptionist correctly.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={dismissSupportSetupModal}
              >
                I&apos;ll do this later
              </button>
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#004ac6] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(0,74,198,0.18)] transition-opacity hover:opacity-95"
                href="https://calendly.com/jonlehman/everycall-setup"
                target="_blank"
                rel="noreferrer"
                onClick={dismissSupportSetupModal}
              >
                Schedule Setup Call
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

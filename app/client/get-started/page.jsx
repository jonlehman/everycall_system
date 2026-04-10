'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
    return 'inline-flex items-center rounded-xl border-2 border-slate-200 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-400';
  }
  return 'inline-flex items-center rounded-xl border-2 border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-[#121c2a] shadow-sm transition-all hover:border-[#2563eb] hover:text-[#2563eb]';
}

function SetupStepCard({ step, title, description = '', subdescription = '', statusBox = null, action = null, className = '' }) {
  return (
    <section className={`overflow-hidden rounded-[24px] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)] md:p-8 ${className}`.trim()}>
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#121c2a] text-sm font-bold text-white">
            {step}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-['Space_Grotesk'] text-xl font-bold tracking-[-0.03em] text-[#121c2a]">{title}</div>
          </div>
        </div>

        {statusBox ? (
          <div className={`mt-6 rounded-[18px] border p-4 ${toneClasses(statusBox.tone).panel}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${toneClasses(statusBox.tone).dot}`} />
              <span className="text-xs font-semibold text-slate-700">{statusBox.label}:</span>
              <span className={`text-xs font-semibold ${toneClasses(statusBox.tone).value}`}>{statusBox.value}</span>
            </div>
            {statusBox.lines?.length ? (
              <div className="mt-3 space-y-1.5">
                {statusBox.lines.map((line) => (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600" key={`${line.label}-${line.value}`}>
                    <span className="font-semibold text-slate-900">{line.label}:</span>
                    <span>{line.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 min-w-0">
          {description ? (
            <div className="text-sm leading-7 text-slate-600">{description}</div>
          ) : null}
          {subdescription ? (
            <div className="mt-3 text-sm leading-7 text-slate-600">{subdescription}</div>
          ) : null}
        </div>

        {action ? (
          <div className="mt-8 flex flex-wrap gap-3">
            {action}
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

  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#121c2a_0%,#1e293b_100%)] p-8 text-white shadow-[0_22px_55px_-28px_rgba(15,23,42,0.8)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.2),transparent_45%)]" />
      <div className="relative">
        <div className="flex items-baseline gap-3">
          <span className="font-['Space_Grotesk'] text-5xl font-bold tracking-[-0.05em] text-white">{progressPercent}%</span>
          <span className="text-sm font-medium text-slate-300">{completedCount} of {totalCount} complete</span>
        </div>
        <div className="mt-6 h-2 rounded-full bg-white/10">
          <div
            className="h-2 rounded-full bg-[#2563eb] shadow-[0_0_12px_rgba(37,99,235,0.8)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <div className="flex items-center gap-3" key={item.label}>
              <span className={`material-symbols-outlined text-lg ${item.done ? 'text-emerald-400' : 'text-slate-500'}`}>
                {item.done ? 'check_circle' : 'radio_button_unchecked'}
              </span>
              <span className={`text-sm font-medium ${item.done ? 'text-white' : 'text-slate-300'}`}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ClientGetStartedPage() {
  const [packet, setPacket] = useState({
    buildState: { builds: [], activeBuild: null },
    users: [],
    settings: null,
    billing: null,
    connections: [],
    documents: []
  });

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
        subdescription: 'To add or revise website training, upload documents.'
      };
    }
    if (latestWebsiteStatus === 'failed') {
      return {
        done: false,
        tone: 'bad',
        statusValue: 'Needs attention',
        description: 'Website training needs attention. Open Knowledge to review the issue with your website crawl.',
        subdescription: 'To add or revise website training, upload documents.'
      };
    }
    return {
      done: false,
      tone: 'processing',
      statusValue: 'Processing',
      description: 'Training your receptionist using your website.',
      subdescription: 'To add or revise website training, upload documents.'
    };
  }, [packet.buildState]);

  const leadDestinations = useMemo(() => {
    const activeUsers = Array.isArray(packet.users)
      ? packet.users.filter((user) => String(user?.status || '').trim().toLowerCase() === 'active')
      : [];
    const emailDestinations = activeUsers
      .filter((user) => Boolean(user?.lead_alert_email_enabled) && String(user?.email || '').trim())
      .map((user) => String(user.email || '').trim());
    const smsDestinations = activeUsers
      .filter((user) => (
        Boolean(user?.lead_alert_sms_enabled)
        && String(user?.phone_number || '').trim()
        && String(user?.sms_opt_in_status || '').trim().toLowerCase() === 'opted_in'
      ))
      .map((user) => formatPhoneDisplay(user.phone_number) || String(user.phone_number || '').trim());
    const pendingSmsDestinations = activeUsers
      .filter((user) => (
        Boolean(user?.lead_alert_sms_enabled)
        && String(user?.phone_number || '').trim()
        && String(user?.sms_opt_in_status || '').trim().toLowerCase() !== 'opted_in'
      ))
      .map((user) => formatPhoneDisplay(user.phone_number) || String(user.phone_number || '').trim());

    const activeDestinations = [...emailDestinations, ...smsDestinations];
    const lines = [];
    if (emailDestinations.length) {
      lines.push({
        label: 'Email',
        value: new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(emailDestinations)
      });
    }
    if (smsDestinations.length) {
      lines.push({
        label: 'Phone',
        value: new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(smsDestinations)
      });
    }

    return {
      activeUsers,
      activeDestinations,
      pendingSmsDestinations,
      description: activeDestinations.length
        ? 'Leads are already being sent to the destinations shown here.'
        : 'Open Send Leads To and choose which people should receive new lead alerts by email or text.',
      subdescription: pendingSmsDestinations.length
        ? `Text alerts to ${new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(pendingSmsDestinations)} will start after SMS confirmation.`
        : '',
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
        ? 'Set your business phone system so that it forwards desired calls to the receptionist number.'
        : 'Your receptionist number is still being assigned. It will appear here as soon as it is ready.'
    };
  }, [packet.settings]);

  const approvedDocumentCount = useMemo(
    () => packet.documents.filter((document) => String(document?.status || '').trim().toLowerCase() === 'approved').length,
    [packet.documents]
  );
  const enabledConnectionCount = useMemo(
    () => packet.connections.filter((connection) => String(connection?.status || '').trim().toLowerCase() === 'enabled').length,
    [packet.connections]
  );

  const progressItems = useMemo(() => [
    { label: 'Crawl website', done: websiteTraining.done },
    { label: 'Upload document', done: approvedDocumentCount > 0 },
    { label: 'Add send-to user', done: leadDestinations.activeDestinations.length > 1 },
    { label: 'Forward calls', done: forwarding.forwardingConfigured },
    { label: 'Set up integration', done: enabledConnectionCount > 0 },
    { label: 'Add additional user', done: leadDestinations.activeUsers.length > 1 },
    { label: 'Activate billing', done: Boolean(packet.billing?.hasStripeSubscription) }
  ], [
    approvedDocumentCount,
    enabledConnectionCount,
    forwarding.forwardingConfigured,
    leadDestinations.activeDestinations.length,
    leadDestinations.activeUsers.length,
    packet.billing?.hasStripeSubscription,
    websiteTraining.done
  ]);

  return (
    <ClientPage title="Get Started">
      <div className="mx-auto w-full max-w-5xl">
        <section className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.45)] md:p-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_55%)]" />
          <div className="relative">
            <div className="mb-10 flex items-center gap-3">
              <div className="h-1.5 w-10 rounded-full bg-[#2563eb]" />
              <h2 className="font-['Space_Grotesk'] text-lg font-bold tracking-[-0.03em] text-[#121c2a]">What To Do</h2>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
              <SetupStepCard
                step="1"
                title="Teach EveryCall About Your Business"
                description={websiteTraining.description}
                subdescription={websiteTraining.subdescription}
                statusBox={{
                  label: 'Website crawl status',
                  value: websiteTraining.statusValue,
                  tone: websiteTraining.tone
                }}
                className="md:col-span-12 lg:col-span-7"
                action={(
                  websiteTraining.done ? (
                    <Link
                      href="/client/receptionist/knowledge"
                      className={actionButtonClass(false)}
                    >
                      Upload Documents
                    </Link>
                  ) : (
                    <button type="button" disabled className={actionButtonClass(true)}>
                      Upload Documents
                    </button>
                  )
                )}
              />

              <SetupStepCard
                step="2"
                title="Choose Where Leads Go"
                description={leadDestinations.description}
                subdescription={leadDestinations.subdescription}
                statusBox={{
                  label: 'Leads currently go to',
                  value: leadDestinations.lines.length ? 'Configured' : 'Not configured',
                  tone: leadDestinations.lines.length ? 'processing' : 'bad',
                  lines: leadDestinations.lines
                }}
                className="md:col-span-6 lg:col-span-5"
                action={(
                  <Link
                    href="/client/team"
                    className={actionButtonClass(false)}
                  >
                    Add Additional Send-To Users
                  </Link>
                )}
              />

              <SetupStepCard
                step="3"
                title="Forward Your Calls"
                description={forwarding.description}
                statusBox={{
                  label: 'Receptionist number',
                  value: forwarding.statusValue,
                  tone: forwarding.numberReady ? 'processing' : 'bad'
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
        </section>
      </div>
    </ClientPage>
  );
}

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

function panelClassName(extra = '') {
  return `rounded-xl border border-slate-200/70 bg-white shadow-sm ${extra}`.trim();
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

function SetupStepCard({ title, description, subdescription = '', action = null }) {
  return (
    <section className={panelClassName('p-5')}>
      <div className="min-w-0">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
        {subdescription ? (
          <div className="mt-2 text-sm leading-6 text-slate-500">{subdescription}</div>
        ) : null}
      </div>
      {action ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {action}
        </div>
      ) : null}
    </section>
  );
}

export default function ClientGetStartedPage() {
  const [buildState, setBuildState] = useState({ builds: [], activeBuild: null });
  const [users, setUsers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson('/api/v1/knowledge/builds').catch(() => null),
      fetchJson('/api/v1/tenant/users').catch(() => null)
    ]).then(([buildsData, usersData]) => {
      if (cancelled) return;
      setBuildState({
        builds: Array.isArray(buildsData?.builds) ? buildsData.builds : [],
        activeBuild: buildsData?.activeBuild || null
      });
      setUsers(Array.isArray(usersData?.users) ? usersData.users : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const websiteTraining = useMemo(() => {
    const builds = Array.isArray(buildState.builds) ? buildState.builds : [];
    const activeBuildId = String(buildState.activeBuild?.active_build_id || '').trim();
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
        description: 'Your receptionist can now answer any questions about your business covered on your website.',
        subdescription: 'To add or revise website training, upload documents.'
      };
    }
    if (latestWebsiteStatus === 'failed') {
      return {
        done: false,
        description: 'Website training needs attention. Open Knowledge to review the issue with your website crawl.',
        subdescription: 'To add or revise website training, upload documents.'
      };
    }
    return {
      done: false,
      description: 'Training your receptionist using your website.',
      subdescription: 'To add or revise website training, upload documents.'
    };
  }, [buildState]);

  const leadDestinations = useMemo(() => {
    const activeUsers = Array.isArray(users)
      ? users.filter((user) => String(user?.status || '').trim().toLowerCase() === 'active')
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
    const description = activeDestinations.length
      ? `Leads are already being sent to ${new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(activeDestinations)}.`
      : 'Open Send Leads To and choose which people should receive new lead alerts by email or text.';
    const subdescription = pendingSmsDestinations.length
      ? `Text alerts to ${new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(pendingSmsDestinations)} will start after SMS confirmation.`
      : '';

    return {
      description,
      subdescription
    };
  }, [users]);

  return (
    <ClientPage
      title="Get Started"
    >
      <div className="grid min-w-0 gap-3">
        <section className={panelClassName('p-5')}>
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-900">What To Do</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <SetupStepCard
              title="1. Teach EveryCall About Your Business"
              description={websiteTraining.description}
              subdescription={websiteTraining.subdescription}
              action={(
                websiteTraining.done ? (
                  <Link
                    href="/client/receptionist/knowledge"
                    className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                  >
                    Upload Documents
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-400"
                  >
                    Upload Documents
                  </button>
                )
              )}
            />
            <SetupStepCard
              title="2. Choose Where Leads Go"
              description={leadDestinations.description}
              subdescription={leadDestinations.subdescription}
              action={(
                <Link
                  href="/client/team"
                  className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                >
                  Add Additional Send-To Users
                </Link>
              )}
            />
            <SetupStepCard
              title="3. Forward Your Calls"
              description="When your EveryCall number is ready, it will appear in the header. Forward desired calls from your business phone system to that number."
            />
          </div>
        </section>
      </div>
    </ClientPage>
  );
}

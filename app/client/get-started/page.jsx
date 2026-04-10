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

function StatusBadge({ tone, children }) {
  const className = tone === 'ok'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function ActionLink({ href, icon, title, body }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-slate-200/70 p-4 transition-all hover:bg-[#f7f9ff]"
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-[#205cb5]">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-sm leading-6 text-slate-500">{body}</div>
        </div>
      </div>
    </Link>
  );
}

function SetupStepCard({ title, badge, description, action = null, secondaryAction = null }) {
  return (
    <section className={panelClassName('p-5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
        </div>
        {badge}
      </div>
      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  );
}

function normalizeBuildStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function describeKnowledgeState(setup) {
  if (setup.runtimeReady) {
    return {
      tone: 'ok',
      label: 'Live',
      description: 'EveryCall has a live knowledge base and can answer business-specific questions.'
    };
  }

  const latestStatus = normalizeBuildStatus(setup.latestBuildStatus || setup.activeBuildStatus);
  if (latestStatus === 'running' || latestStatus === 'queued') {
    return {
      tone: 'warn',
      label: latestStatus === 'running' ? 'Building' : 'Queued',
      description: 'Your knowledge build is in progress. Keep this page or the Knowledge page open to monitor it.'
    };
  }

  if (latestStatus === 'failed') {
    return {
      tone: 'neutral',
      label: 'Needs attention',
      description: 'The latest knowledge build failed. Open Knowledge to review the reason and run it again.'
    };
  }

  if (setup.publishedBuildCount > 0 && !setup.runtimeReady) {
    return {
      tone: 'warn',
      label: 'Almost ready',
      description: 'There is a published knowledge build, but it is not the live build yet.'
    };
  }

  return {
    tone: 'neutral',
    label: 'Needs attention',
    description: 'EveryCall needs a published knowledge build before it is ready for live calls.'
  };
}

function describeForwardingState(status, phoneNumber) {
  if (status === 'configured') {
    return {
      tone: 'ok',
      label: 'Configured',
      description: phoneNumber
        ? `Calls should now be forwarding to ${phoneNumber}.`
        : 'Forwarding has been marked as configured.'
    };
  }
  if (status === 'acknowledged') {
    return {
      tone: 'warn',
      label: 'In progress',
      description: phoneNumber
        ? `Forward calls from your phone system to ${phoneNumber}, then mark this step complete.`
        : 'You have acknowledged forwarding, but the final setup step is still waiting.'
    };
  }
  return {
    tone: 'neutral',
    label: 'Needs action',
    description: phoneNumber
      ? `Forward desired calls from your business phone system to ${phoneNumber}.`
      : 'Your EveryCall number is still being assigned before forwarding can be completed.'
  };
}

export default function ClientGetStartedPage() {
  const [packet, setPacket] = useState(null);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading setup...' });
  const [savingForwarding, setSavingForwarding] = useState(false);

  const loadPage = async (withLoadingState = false) => {
    if (withLoadingState) {
      setStatus({ tone: 'warn', message: 'Refreshing setup...' });
    }
    try {
      const [dashboard, settings, team] = await Promise.all([
        fetchJson('/api/v1/client/dashboard'),
        fetchJson('/api/v1/settings'),
        fetchJson('/api/v1/tenant/users')
      ]);
      setPacket({
        dashboard,
        settings,
        users: Array.isArray(team?.users) ? team.users : []
      });
      setStatus(null);
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not load setup.' });
    }
  };

  useEffect(() => {
    void loadPage(true);
  }, []);

  const dashboard = packet?.dashboard || {};
  const settings = packet?.settings || {};
  const users = Array.isArray(packet?.users) ? packet.users : [];
  const setup = dashboard?.setup || {};
  const tenant = settings?.tenant || {};
  const readiness = settings?.salesReceptionistReadiness || {};
  const forwardingStatus = String(tenant.forwarding_setup_status || 'not_started').trim().toLowerCase();
  const assignedPhoneNumber = formatPhoneDisplay(tenant.telnyx_voice_number)
    || formatPhoneDisplay(readiness.phoneNumber)
    || String(tenant.telnyx_voice_number || readiness.phoneNumber || '').trim()
    || '';
  const carrierNumberReady = Boolean(tenant.telnyx_voice_number) && Boolean(readiness.carrierActivationReady);

  const emailRecipients = users.filter((user) => (
    user?.status === 'active'
    && Boolean(user?.lead_alert_email_enabled)
    && String(user?.email || '').trim()
  ));
  const smsRecipients = users.filter((user) => (
    user?.status === 'active'
    && Boolean(user?.lead_alert_sms_enabled)
    && String(user?.phone_number || '').trim()
  ));
  const optedInSmsRecipients = smsRecipients.filter((user) => String(user?.sms_opt_in_status || '').trim() === 'opted_in');
  const pendingSmsRecipients = smsRecipients.filter((user) => String(user?.sms_opt_in_status || '').trim() !== 'opted_in');
  const leadDestinationReady = emailRecipients.length > 0 || optedInSmsRecipients.length > 0;

  const knowledgeState = useMemo(() => describeKnowledgeState(setup), [setup]);
  const forwardingState = useMemo(() => describeForwardingState(forwardingStatus, assignedPhoneNumber), [forwardingStatus, assignedPhoneNumber]);
  const numberState = carrierNumberReady
    ? {
        tone: 'ok',
        label: 'Ready',
        description: assignedPhoneNumber
          ? `Your EveryCall number is ${assignedPhoneNumber}.`
          : 'Your EveryCall number is ready.'
      }
    : tenant.telnyx_voice_number
      ? {
          tone: 'warn',
          label: 'Assigned',
          description: `${assignedPhoneNumber} is assigned, but setup is still finishing before the line is fully live.`
        }
      : {
          tone: 'warn',
          label: 'Setting up',
          description: 'EveryCall is still assigning your phone number.'
        };
  const leadState = leadDestinationReady
    ? {
        tone: pendingSmsRecipients.length ? 'warn' : 'ok',
        label: pendingSmsRecipients.length ? 'Almost ready' : 'Ready',
        description: pendingSmsRecipients.length
          ? `Lead alerts are set up. Email is live, and ${pendingSmsRecipients.length} SMS destination${pendingSmsRecipients.length === 1 ? '' : 's'} still need confirmation.`
          : 'Lead destinations are configured for new calls.'
      }
    : {
        tone: 'neutral',
        label: 'Needs action',
        description: 'Choose at least one email or SMS destination for new lead alerts.'
      };

  const setupCompleteCount = [
    carrierNumberReady,
    setup.runtimeReady,
    leadDestinationReady,
    forwardingStatus === 'configured'
  ].filter(Boolean).length;

  async function updateForwardingStatus(nextStatus) {
    setSavingForwarding(true);
    setStatus({ tone: 'warn', message: 'Saving forwarding status...' });
    try {
      await fetchJson('/api/v1/tenants/forwarding-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      await loadPage(false);
      setStatus({
        tone: 'ok',
        message: nextStatus === 'configured'
          ? 'Forwarding marked complete.'
          : 'Forwarding step updated.'
      });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not update forwarding status.' });
    } finally {
      setSavingForwarding(false);
    }
  }

  return (
    <ClientPage
      title="Get Started"
      subtitle="This is the shortest path to getting EveryCall ready for live calls."
      status={status}
      primaryAction={{ label: 'Refresh', onClick: () => loadPage(true), disabled: savingForwarding }}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 gap-3">
          <section className={panelClassName('p-5')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold text-slate-900">Setup Progress</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Get these four things in place and EveryCall is ready for real calls.</p>
              </div>
              <StatusBadge tone={setupCompleteCount === 4 ? 'ok' : 'warn'}>
                {setupCompleteCount} of 4 complete
              </StatusBadge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SetupStepCard
                title="EveryCall number"
                badge={<StatusBadge tone={numberState.tone}>{numberState.label}</StatusBadge>}
                description={numberState.description}
                action={assignedPhoneNumber ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                    onClick={() => navigator.clipboard?.writeText(String(tenant.telnyx_voice_number || readiness.phoneNumber || '').trim()).catch(() => {})}
                  >
                    Copy Number
                  </button>
                ) : null}
              />
              <SetupStepCard
                title="Knowledge base"
                badge={<StatusBadge tone={knowledgeState.tone}>{knowledgeState.label}</StatusBadge>}
                description={knowledgeState.description}
                action={(
                  <Link
                    href="/client/receptionist/knowledge"
                    className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                  >
                    Open Knowledge
                  </Link>
                )}
              />
              <SetupStepCard
                title="Lead destinations"
                badge={<StatusBadge tone={leadState.tone}>{leadState.label}</StatusBadge>}
                description={leadState.description}
                action={(
                  <Link
                    href="/client/team"
                    className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                  >
                    Open Send Leads To
                  </Link>
                )}
              />
              <SetupStepCard
                title="Call forwarding"
                badge={<StatusBadge tone={forwardingState.tone}>{forwardingState.label}</StatusBadge>}
                description={forwardingState.description}
                action={forwardingStatus === 'not_started' && assignedPhoneNumber ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                    onClick={() => updateForwardingStatus('acknowledged')}
                    disabled={savingForwarding}
                  >
                    I Have The Number
                  </button>
                ) : null}
                secondaryAction={assignedPhoneNumber && forwardingStatus !== 'configured' ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md bg-[#004ac6] px-3 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
                    onClick={() => updateForwardingStatus('configured')}
                    disabled={savingForwarding}
                  >
                    I Forwarded Calls Here
                  </button>
                ) : null}
              />
            </div>
          </section>

          <section className={panelClassName('p-5')}>
            <h2 className="m-0 text-lg font-semibold text-slate-900">What To Do Next</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ActionLink
                href="/client/receptionist/basics"
                icon="person_4"
                title="Review receptionist basics"
                body="Confirm the business name, greeting, and voice EveryCall will use on calls."
              />
              <ActionLink
                href="/client/receptionist/knowledge"
                icon="menu_book"
                title="Check your knowledge build"
                body="Make sure EveryCall has enough approved business information to answer basic questions."
              />
              <ActionLink
                href="/client/team"
                icon="alternate_email"
                title="Confirm where leads go"
                body="Choose which email addresses and mobile numbers should receive new lead alerts."
              />
              <ActionLink
                href="/client/calls"
                icon="phone_in_talk"
                title="Review calls"
                body="Once calls start forwarding, this is where you will review summaries and follow-up details."
              />
            </div>
          </section>
        </div>

        <div className="grid gap-3">
          <section className={panelClassName('p-5')}>
            <h2 className="m-0 text-lg font-semibold text-slate-900">Current Setup</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <div>
                <div className="font-semibold text-slate-900">Lead email</div>
                <div className="mt-1 text-slate-500">
                  {emailRecipients.length
                    ? emailRecipients.map((user) => user.email).join(', ')
                    : 'No email lead destination yet'}
                </div>
              </div>
              <div>
                <div className="font-semibold text-slate-900">SMS alerts</div>
                <div className="mt-1 text-slate-500">
                  {smsRecipients.length
                    ? smsRecipients.map((user) => `${formatPhoneDisplay(user.phone_number) || user.phone_number} (${String(user.sms_opt_in_status || 'not_requested').replaceAll('_', ' ')})`).join(', ')
                    : 'No SMS destination yet'}
                </div>
              </div>
              <div>
                <div className="font-semibold text-slate-900">EveryCall number</div>
                <div className="mt-1 text-slate-500">{assignedPhoneNumber || 'Still being assigned'}</div>
              </div>
            </div>
          </section>

          <section className={panelClassName('p-5')}>
            <h2 className="m-0 text-lg font-semibold text-slate-900">Forwarding Reminder</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              When you are ready for EveryCall to answer, forward desired calls from your business phone system to your EveryCall number.
            </p>
            {assignedPhoneNumber ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-[#eff4ff] p-4">
                <div className="text-sm font-semibold text-slate-900">{assignedPhoneNumber}</div>
                <div className="mt-1 text-sm text-slate-600">This is the number your phone system should forward calls to.</div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">
                The EveryCall number is still being assigned. Refresh this page if it has been a few minutes.
              </div>
            )}
          </section>
        </div>
      </div>
    </ClientPage>
  );
}

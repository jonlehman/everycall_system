'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function Header() {
  const [tenantName, setTenantName] = useState('Tenant');
  const [billing, setBilling] = useState({
    loading: true,
    status: null,
    trialDaysRemaining: null,
    appAccessStatus: null,
    stripeSubscriptionId: null,
    canManage: false
  });
  const [assistant, setAssistant] = useState({
    loading: true,
    busy: false,
    ready: false,
    enabled: false,
    reasons: []
  });
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const openMenu = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, 500);
  };

  useEffect(() => {
    const handleClick = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch('/api/v1/settings').then((resp) => resp.ok ? resp.json() : null).catch(() => null),
      fetch('/api/v1/assistant/status').then((resp) => resp.ok ? resp.json() : null).catch(() => null),
      fetch('/api/v1/billing').then((resp) => resp.ok ? resp.json() : null).catch(() => null)
    ])
      .then(([settingsData, assistantData, billingData]) => {
        if (!mounted) return;
        if (settingsData?.tenant?.name) setTenantName(settingsData.tenant.name);
        setAssistant({
          loading: false,
          busy: false,
          ready: Boolean(assistantData?.assistant?.ready),
          enabled: Boolean(assistantData?.assistant?.enabled),
          reasons: Array.isArray(assistantData?.assistant?.reasons) ? assistantData.assistant.reasons : []
        });
        setBilling({
          loading: false,
          status: billingData?.billing?.status || null,
          trialDaysRemaining: typeof billingData?.billing?.trialDaysRemaining === 'number' ? billingData.billing.trialDaysRemaining : null,
          appAccessStatus: billingData?.billing?.appAccessStatus || null,
          stripeSubscriptionId: billingData?.billing?.stripeSubscriptionId || null,
          canManage: Boolean(billingData?.viewer?.canManage)
        });
      })
      .catch(() => {
        if (!mounted) return;
        setAssistant((prev) => ({ ...prev, loading: false }));
        setBilling((prev) => ({ ...prev, loading: false }));
      });
    return () => { mounted = false; };
  }, []);

  const toggleAssistant = async () => {
    if (assistant.busy || !assistant.ready) return;
    const nextEnabled = !assistant.enabled;
    setAssistant((prev) => ({ ...prev, busy: true }));
    try {
      const resp = await fetch('/api/v1/assistant/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setAssistant((prev) => ({
          ...prev,
          busy: false,
          ready: Boolean(data?.assistant?.ready),
          enabled: Boolean(data?.assistant?.enabled),
          reasons: Array.isArray(data?.assistant?.reasons) ? data.assistant.reasons : prev.reasons
        }));
        return;
      }
      setAssistant({
        loading: false,
        busy: false,
        ready: Boolean(data?.assistant?.ready),
        enabled: Boolean(data?.assistant?.enabled),
        reasons: Array.isArray(data?.assistant?.reasons) ? data.assistant.reasons : []
      });
    } catch {
      setAssistant((prev) => ({ ...prev, busy: false }));
    }
  };

  const showTrialBadge = !billing.loading && billing.status === 'trialing' && !billing.stripeSubscriptionId;
  const showBillingBadge = !billing.loading && !showTrialBadge && (billing.appAccessStatus === 'billing_locked' || billing.status === 'deactivated');

  return (
    <div className="mb-4 flex items-start justify-end gap-3">
      {showTrialBadge ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900 shadow-sm">
          <div className="mb-1 text-xs uppercase tracking-wide">Trial mode</div>
          <div className="text-sm font-semibold">
            {billing.trialDaysRemaining === 1 ? '1 day left' : `${billing.trialDaysRemaining ?? 0} days left`}
          </div>
          {billing.canManage ? (
            <Link className="mt-1 inline-block text-xs underline" href="/client/billing">
              Add billing
            </Link>
          ) : null}
        </div>
      ) : null}
      {showBillingBadge ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 shadow-sm">
          <div className="mb-1 text-xs uppercase tracking-wide">
            {billing.status === 'deactivated' ? 'Account deactivated' : 'Billing required'}
          </div>
          <div className="text-sm font-semibold">
            {billing.status === 'deactivated' ? 'Contact support to reactivate' : 'Activate billing to unlock'}
          </div>
          <Link className="mt-1 inline-block text-xs underline" href="/client/billing">
            Open billing
          </Link>
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Assistant</div>
        <button
          type="button"
          disabled={assistant.loading || assistant.busy || !assistant.ready}
          onClick={toggleAssistant}
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            assistant.enabled
              ? 'bg-emerald-600 text-white'
              : assistant.ready
                ? 'bg-slate-200 text-slate-700'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
          }`}
        >
          {assistant.enabled ? 'Enabled' : 'Disabled'}
        </button>
        {!assistant.ready ? (
          <div className="mt-1 text-xs text-slate-500">
            Setup incomplete. <Link className="underline" href="/client/setup">Finish setup</Link>.
          </div>
        ) : null}
      </div>
      <div
        className="relative flex cursor-pointer items-center gap-2"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onMouseEnter={openMenu}
        onMouseLeave={(e) => {
          if (!(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) {
            scheduleClose();
          }
        }}
      >
        <div className="flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-100 p-1.5 text-emerald-700">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="block">
            <circle cx="12" cy="8" r="4" fill="currentColor"></circle>
            <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
          </svg>
        </div>
        <div className="text-right">
          <div className="font-semibold">{tenantName || 'Tenant'}</div>
          <div className="text-xs text-slate-500">Account</div>
        </div>

        {open ? (
          <div
            className="absolute right-0 top-12 z-20 min-w-[220px] rounded-lg border border-border bg-card p-2 shadow-md"
            onMouseEnter={openMenu}
            onMouseLeave={(e) => {
              if (!(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) {
                scheduleClose();
              }
            }}
          >
            <div className="px-2 py-1 text-xs uppercase tracking-wide text-slate-500">Setup</div>
            {!assistant.ready && assistant.reasons.length ? (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                {assistant.reasons[0]}
              </div>
            ) : null}
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/knowledge">Knowledge</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/setup">Setup Checklist</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/team">Team Users</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/routing">Call Routing</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/settings">Account Settings</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/billing">Billing</Link>
            <div className="my-2 h-px bg-slate-200"></div>
            <button
              className="block w-full rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              type="button"
              onClick={async () => {
                await fetch('/api/v1/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

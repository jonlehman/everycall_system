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
  const [readiness, setReadiness] = useState({
    loading: true,
    status: 'not_started',
    blockers: []
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
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, 500);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  useEffect(() => {
    const handleClick = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch('/api/v1/settings').then((resp) => (resp.ok ? resp.json() : null)).catch(() => null),
      fetch('/api/v1/knowledge/readiness').then((resp) => (resp.ok ? resp.json() : null)).catch(() => null),
      fetch('/api/v1/billing').then((resp) => (resp.ok ? resp.json() : null)).catch(() => null)
    ]).then(([settingsData, readinessData, billingData]) => {
      if (!mounted) return;
      if (settingsData?.tenant?.name) setTenantName(settingsData.tenant.name);
      setReadiness({
        loading: false,
        status: readinessData?.readiness?.status || 'not_started',
        blockers: Array.isArray(readinessData?.readiness?.blockers) ? readinessData.readiness.blockers : []
      });
      setBilling({
        loading: false,
        status: billingData?.billing?.status || null,
        trialDaysRemaining: typeof billingData?.billing?.trialDaysRemaining === 'number' ? billingData.billing.trialDaysRemaining : null,
        appAccessStatus: billingData?.billing?.appAccessStatus || null,
        stripeSubscriptionId: billingData?.billing?.stripeSubscriptionId || null,
        canManage: Boolean(billingData?.viewer?.canManage)
      });
    }).catch(() => {
      if (!mounted) return;
      setReadiness((current) => ({ ...current, loading: false }));
      setBilling((current) => ({ ...current, loading: false }));
    });
    return () => { mounted = false; };
  }, []);

  const showTrialBadge = !billing.loading && billing.status === 'trialing' && !billing.stripeSubscriptionId;
  const showBillingBadge = !billing.loading && !showTrialBadge && (billing.appAccessStatus === 'billing_locked' || billing.status === 'deactivated');
  const ready = readiness.status === 'ready_for_go_live' || readiness.status === 'live';

  return (
    <div className="mb-6 flex flex-wrap items-start justify-end gap-3">
      {showTrialBadge ? (
        <div className="rounded-[20px] border border-sky-200 bg-sky-50/95 px-4 py-3 text-sky-900 shadow-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em]">Trial</div>
          <div className="text-sm font-semibold tracking-tight">
            {billing.trialDaysRemaining === 1 ? '1 day left' : `${billing.trialDaysRemaining ?? 0} days left`}
          </div>
          {billing.canManage ? (
            <Link className="mt-1 inline-block text-xs underline" href="/client/account/billing">
              Add billing
            </Link>
          ) : null}
        </div>
      ) : null}

      {showBillingBadge ? (
        <div className="rounded-[20px] border border-amber-300 bg-amber-50/95 px-4 py-3 text-amber-900 shadow-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
            {billing.status === 'deactivated' ? 'Account deactivated' : 'Billing required'}
          </div>
          <div className="text-sm font-semibold tracking-tight">
            {billing.status === 'deactivated' ? 'Contact support to reactivate' : 'Activate billing to unlock'}
          </div>
          <Link className="mt-1 inline-block text-xs underline" href="/client/account/billing">
            Open billing
          </Link>
        </div>
      ) : null}

      <div className="rounded-[20px] border border-border bg-card/95 px-4 py-3 shadow-sm">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Launch Readiness</div>
        <div className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${ready ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
          {ready ? 'Ready' : 'Needs Setup'}
        </div>
        {!ready && readiness.blockers.length ? (
          <div className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
            {readiness.blockers[0]}. <Link className="underline" href="/client/receptionist/go-live">Review launch readiness</Link>.
          </div>
        ) : null}
      </div>

      <div
        className="relative flex cursor-pointer items-center gap-2"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onMouseEnter={openMenu}
        onMouseLeave={(event) => {
          if (!(event.relatedTarget && event.currentTarget.contains(event.relatedTarget))) {
            scheduleClose();
          }
        }}
      >
        <div className="flex items-center justify-center rounded-full border border-slate-200 bg-white p-1.5 text-slate-700 shadow-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="block">
            <circle cx="12" cy="8" r="4" fill="currentColor"></circle>
            <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
          </svg>
        </div>
        <div className="text-right">
          <div className="font-semibold tracking-tight text-slate-900">{tenantName || 'Tenant'}</div>
          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Account</div>
        </div>

        {open ? (
          <div
            className="absolute right-0 top-12 z-20 min-w-[240px] rounded-[18px] border border-border bg-white/95 p-2 shadow-lg"
            onMouseEnter={openMenu}
            onMouseLeave={(event) => {
              if (!(event.relatedTarget && event.currentTarget.contains(event.relatedTarget))) {
                scheduleClose();
              }
            }}
          >
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Session</div>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/account/general">Open account</Link>
            <div className="my-1 border-t border-slate-200" />
            <button
              className="block w-full rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              type="button"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

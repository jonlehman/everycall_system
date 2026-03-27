'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function Header() {
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
    }, 350);
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
    const applyReadiness = (payload) => {
      setReadiness({
        loading: false,
        status: payload?.status || 'not_started',
        blockers: Array.isArray(payload?.blockers) ? payload.blockers : []
      });
    };
    const loadHeaderState = () => {
      Promise.all([
        fetch('/api/v1/knowledge/readiness', { cache: 'no-store' }).then((resp) => (resp.ok ? resp.json() : null)).catch(() => null),
        fetch('/api/v1/billing').then((resp) => (resp.ok ? resp.json() : null)).catch(() => null)
      ]).then(([readinessData, billingData]) => {
        if (!mounted) return;
        applyReadiness(readinessData?.readiness);
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
    };
    const handleReadinessUpdated = (event) => {
      if (!mounted) return;
      applyReadiness(event?.detail || null);
    };
    loadHeaderState();
    window.addEventListener('everycall:readiness-updated', handleReadinessUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('everycall:readiness-updated', handleReadinessUpdated);
    };
  }, []);

  const showTrialBadge = !billing.loading && billing.status === 'trialing' && !billing.stripeSubscriptionId;
  const showBillingBadge = !billing.loading && !showTrialBadge && (billing.appAccessStatus === 'billing_locked' || billing.status === 'deactivated');
  const ready = readiness.status === 'ready_for_go_live' || readiness.status === 'live';
  const trialLabel = billing.trialDaysRemaining === 1 ? 'Trial: 1 Day Left' : `Trial: ${billing.trialDaysRemaining ?? 0} Days Left`;
  const accountActionLabel = showTrialBadge || showBillingBadge ? 'Upgrade Plan' : (billing.canManage ? 'Billing' : 'Account');

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-8">
          <Link href="/client/calls" className="text-xl font-bold tracking-[-0.02em] text-slate-900">
            EveryCall
          </Link>
          {showTrialBadge ? (
            <div className="hidden md:flex items-center">
              <Link href="/client/account/billing" className="border-b-2 border-[#004ac6] py-5 text-sm font-semibold text-[#004ac6]">
                {trialLabel}
              </Link>
            </div>
          ) : null}
          {showBillingBadge ? (
            <div className="hidden md:flex items-center">
              <Link href="/client/account/billing" className="border-b-2 border-amber-500 py-5 text-sm font-semibold text-amber-700">
                Billing Required
              </Link>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <Link
            href="/client/receptionist/go-live"
            className={`hidden items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] md:flex ${ready ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {ready ? 'Active' : 'Needs Setup'}
          </Link>

          <a
            href="mailto:support@everycall.io"
            className="flex h-9 w-9 items-center justify-center rounded text-slate-700 transition-colors hover:bg-[#eff4ff]"
            aria-label="Contact support"
          >
            <span className="material-symbols-outlined text-[20px]">help_outline</span>
          </a>

          <Link
            href="/client/account/billing"
            className="hidden rounded-md bg-[#004ac6] px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 md:inline-flex"
          >
            {accountActionLabel}
          </Link>

          <div
            className="relative"
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
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-[#d9e3f6] text-[#434655]"
              aria-label="Open account menu"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </button>

            {open ? (
              <div
                className="absolute right-0 top-11 z-20 min-w-[220px] rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                onMouseEnter={openMenu}
                onMouseLeave={(event) => {
                  if (!(event.relatedTarget && event.currentTarget.contains(event.relatedTarget))) {
                    scheduleClose();
                  }
                }}
              >
                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Account</div>
                <Link className="mb-1 block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-[#eff4ff]" href="/client/account/general">
                  Open account
                </Link>
                <Link className="mb-1 block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-[#eff4ff]" href="/client/account/billing">
                  Open billing
                </Link>
                {!ready && readiness.blockers.length ? (
                  <Link className="mb-1 block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-[#eff4ff]" href="/client/receptionist/go-live">
                    Launch readiness
                  </Link>
                ) : null}
                <div className="my-1 border-t border-slate-200" />
                <button
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-[#eff4ff]"
                  type="button"
                  onClick={handleLogout}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

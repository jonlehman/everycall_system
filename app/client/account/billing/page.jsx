'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

function formatMoney(amountCents) {
  const value = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

export default function AccountBillingPage() {
  const [billing, setBilling] = useState(null);
  const [viewer, setViewer] = useState({ canManage: false, userRole: null });
  const [loadState, setLoadState] = useState('loading');
  const [actionState, setActionState] = useState({ checkout: false, portal: false });
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading billing status...' });

  const loadBilling = () => {
    setLoadState('loading');
    setStatus({ tone: 'warn', message: 'Loading billing status...' });
    fetch('/api/v1/billing')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data?.billing) {
          setLoadState('error');
          setStatus({ tone: 'bad', message: 'Could not load billing details.' });
          return;
        }
        setBilling(data.billing);
        setViewer(data.viewer || { canManage: false, userRole: null });
        setLoadState('ready');
        if (data.billing.status === 'deactivated') {
          setStatus({ tone: 'bad', message: 'Please email support@everycall.io to reactivate your account.' });
          return;
        }
        if (data.billing.appAccessStatus === 'billing_locked') {
          setStatus({ tone: 'warn', message: 'Billing is required to unlock the rest of the application.' });
          return;
        }
        if (data.billing.status === 'trialing' && !data.billing.stripeSubscriptionId) {
          const days = typeof data.billing.trialDaysRemaining === 'number' ? data.billing.trialDaysRemaining : 0;
          setStatus({ tone: 'warn', message: `Trial mode is active. ${days === 1 ? '1 day remains' : `${days} days remain`} before billing is required.` });
          return;
        }
        setStatus({ tone: 'ok', message: 'Billing is active.' });
      })
      .catch(() => {
        setLoadState('error');
        setStatus({ tone: 'bad', message: 'Could not load billing details.' });
      });
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const startCheckout = async () => {
    setActionState((prev) => ({ ...prev, checkout: true }));
    try {
      const resp = await fetch('/api/v1/billing/checkout', { method: 'POST' });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.checkoutUrl) {
        setStatus({ tone: 'bad', message: data?.message || 'Could not start checkout.' });
        setActionState((prev) => ({ ...prev, checkout: false }));
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setStatus({ tone: 'bad', message: 'Could not start checkout.' });
      setActionState((prev) => ({ ...prev, checkout: false }));
    }
  };

  const openPortal = async () => {
    setActionState((prev) => ({ ...prev, portal: true }));
    try {
      const resp = await fetch('/api/v1/billing/portal', { method: 'POST' });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.portalUrl) {
        setStatus({ tone: 'bad', message: data?.message || 'Could not open billing portal.' });
        setActionState((prev) => ({ ...prev, portal: false }));
        return;
      }
      window.location.href = data.portalUrl;
    } catch {
      setStatus({ tone: 'bad', message: 'Could not open billing portal.' });
      setActionState((prev) => ({ ...prev, portal: false }));
    }
  };

  const locked = billing?.appAccessStatus === 'billing_locked' || billing?.status === 'deactivated';
  const needsActivation = !billing?.stripeSubscriptionId;

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Billing"
      subtitle="Review subscription state, app access, and billing actions."
      status={status}
      primaryAction={viewer.canManage && billing?.status !== 'deactivated'
        ? {
            label: billing?.stripeSubscriptionId ? 'Open Billing Portal' : 'Activate Billing',
            brand: true,
            onClick: billing?.stripeSubscriptionId ? openPortal : startCheckout,
            disabled: actionState.checkout || actionState.portal || loadState === 'loading'
          }
        : null}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Status</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Billing status</div>
                <div className="mt-1 text-xl font-semibold">{billing?.status || '-'}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Monthly amount</div>
                <div className="mt-1 text-xl font-semibold">{formatMoney(billing?.plan?.monthlyAmountCents)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Trial days left</div>
                <div className="mt-1 text-xl font-semibold">{typeof billing?.trialDaysRemaining === 'number' ? billing.trialDaysRemaining : '-'}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-sm md:grid-cols-[220px_1fr]">
              <div>Trial ends</div><div>{formatDate(billing?.trialEnd)}</div>
              <div>Current period end</div><div>{formatDate(billing?.currentPeriodEnd)}</div>
              <div>Application access</div><div>{billing?.appAccessStatus || '-'}</div>
              <div>Service access</div><div>{billing?.serviceAccessStatus || '-'}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Actions</h2>
            {!viewer.canManage ? (
              <p className="text-sm text-slate-500">
                Only the account owner can update payment details or activate billing.
              </p>
            ) : billing?.status === 'deactivated' ? (
              <p className="text-sm text-slate-500">
                Please email support@everycall.io to reactivate your account.
              </p>
            ) : billing?.stripeSubscriptionId ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={openPortal}
                  disabled={actionState.checkout || actionState.portal || !billing?.stripeCustomerId}
                >
                  {actionState.portal ? 'Opening portal...' : 'Open Billing Portal'}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={loadBilling}
                  disabled={actionState.checkout || actionState.portal}
                >
                  Refresh
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={startCheckout}
                  disabled={actionState.checkout || actionState.portal || !needsActivation}
                >
                  {actionState.checkout ? 'Opening checkout...' : 'Activate Billing'}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={openPortal}
                  disabled={actionState.checkout || actionState.portal || !billing?.stripeCustomerId}
                >
                  {actionState.portal ? 'Opening portal...' : 'Open Billing Portal'}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={loadBilling}
                  disabled={actionState.checkout || actionState.portal}
                >
                  Refresh
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">What happens next</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
            <li>Trial runs for 30 days with no card required.</li>
            <li>We send reminders 5 days, 2 days, and the day trial ends.</li>
            <li>After trial ends, calls and lead capture continue for 30 days but app access is billing-locked.</li>
            <li>At the end of that extra 30-day window, the number is released and the account is deactivated.</li>
          </ul>
          {locked ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              New leads will continue to be captured, but full app access remains locked until billing is active.
            </div>
          ) : null}
        </div>
      </div>
    </SectionPage>
  );
}

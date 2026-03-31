'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';
import { formatLeadDecisionReason, getLeadStatusMeta } from '../../../../lib/leadBilling';

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

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
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

function LeadStatusBadge({ call }) {
  const meta = getLeadStatusMeta(call || {});
  const toneClass = meta.tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : meta.tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <div className="space-y-1">
      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass}`}>
        {meta.label}
      </span>
      <div className="text-xs text-slate-500">{meta.detail}</div>
    </div>
  );
}

export default function AccountBillingPage() {
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState(null);
  const [viewer, setViewer] = useState({ canManage: false, userRole: null });
  const [loadState, setLoadState] = useState('loading');
  const [actionState, setActionState] = useState({ checkout: false, portal: false, reactivating: false });
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading billing status...' });

  const loadBilling = async ({ keepStatus = false } = {}) => {
    setLoadState('loading');
    if (!keepStatus) {
      setStatus({ tone: 'warn', message: 'Loading billing status...' });
    }
    try {
      const data = await fetchJson('/api/v1/billing');
      if (!data?.billing) {
        setLoadState('error');
        setStatus({ tone: 'bad', message: 'Could not load billing details.' });
        return;
      }
      setBilling(data.billing);
      setViewer(data.viewer || { canManage: false, userRole: null });
      setLoadState('ready');

      if (data.billing.status === 'deactivated') {
        setStatus({
          tone: 'warn',
          message: 'Service is deactivated. Restart service from this page to provision a new Sales Receptionist Number and reopen the account.'
        });
        return;
      }
      if (data.billing.appAccessStatus === 'billing_locked') {
        setStatus({ tone: 'warn', message: 'Billing is required to unlock the rest of the workspace.' });
        return;
      }
      if (data.billing.status === 'trialing' && !data.billing.stripeSubscriptionId) {
        const days = typeof data.billing.trialDaysRemaining === 'number' ? data.billing.trialDaysRemaining : 0;
        setStatus({ tone: 'warn', message: `Trial mode is active. ${days === 1 ? '1 day remains' : `${days} days remain`} before billing is required.` });
        return;
      }
      setStatus({ tone: 'ok', message: 'Billing is active.' });
    } catch (error) {
      setLoadState('error');
      setStatus({ tone: 'bad', message: error?.message || 'Could not load billing details.' });
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  useEffect(() => {
    const checkoutState = String(searchParams?.get('checkout') || '').trim().toLowerCase();
    if (checkoutState === 'success') {
      setStatus({ tone: 'ok', message: 'Billing checkout completed. Refreshing your billing state...' });
    } else if (checkoutState === 'cancel') {
      setStatus({ tone: 'warn', message: 'Billing checkout was canceled. You can restart it any time from this page.' });
    }
  }, [searchParams]);

  const startCheckout = async () => {
    setActionState((prev) => ({ ...prev, checkout: true }));
    try {
      const data = await fetchJson('/api/v1/billing/checkout', { method: 'POST' });
      if (!data?.checkoutUrl) {
        setStatus({ tone: 'bad', message: 'Could not start checkout.' });
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not start checkout.' });
    } finally {
      setActionState((prev) => ({ ...prev, checkout: false }));
    }
  };

  const openPortal = async () => {
    setActionState((prev) => ({ ...prev, portal: true }));
    try {
      const data = await fetchJson('/api/v1/billing/portal', { method: 'POST' });
      if (!data?.portalUrl) {
        setStatus({ tone: 'bad', message: 'Could not open billing portal.' });
        return;
      }
      window.location.href = data.portalUrl;
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not open billing portal.' });
    } finally {
      setActionState((prev) => ({ ...prev, portal: false }));
    }
  };

  const reactivateAccount = async () => {
    const confirmed = window.confirm('Restart this account and provision a new Sales Receptionist Number? A short recovery trial will be opened automatically.');
    if (!confirmed) return;
    setActionState((prev) => ({ ...prev, reactivating: true }));
    setStatus({ tone: 'warn', message: 'Restarting service...' });
    try {
      const data = await fetchJson('/api/v1/billing/reactivate', { method: 'POST' });
      await loadBilling({ keepStatus: true });
      setStatus({ tone: 'ok', message: data?.message || 'Service restarted.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not restart service.' });
    } finally {
      setActionState((prev) => ({ ...prev, reactivating: false }));
    }
  };

  const leadUsage = billing?.leadUsage || {};
  const invoiceEstimate = billing?.invoiceEstimate || {};
  const leadPricing = billing?.leadPricing || {};
  const recentCalls = Array.isArray(leadUsage.recentCalls) ? leadUsage.recentCalls : [];
  const canReactivate = viewer.canManage && billing?.status === 'deactivated';
  const primaryAction = canReactivate
    ? {
        label: actionState.reactivating ? 'Restarting...' : 'Restart Account',
        brand: true,
        onClick: reactivateAccount,
        disabled: actionState.checkout || actionState.portal || actionState.reactivating || loadState === 'loading'
      }
    : viewer.canManage && billing?.status !== 'deactivated'
      ? {
          label: billing?.stripeSubscriptionId ? 'Open Billing Portal' : 'Activate Billing',
          brand: true,
          onClick: billing?.stripeSubscriptionId ? openPortal : startCheckout,
          disabled: actionState.checkout || actionState.portal || actionState.reactivating || loadState === 'loading'
        }
      : null;

  const invoiceCards = useMemo(() => ([
    { label: 'Base Subscription', value: formatMoney(invoiceEstimate.baseAmountCents) },
    { label: 'Billable Leads', value: `${Number(invoiceEstimate.billableLeadCount || 0)}` },
    { label: 'Lead Rate', value: `${formatMoney(leadPricing.rateCents)} / lead` },
    { label: 'Lead Charges', value: formatMoney(invoiceEstimate.leadChargesCents) },
    { label: 'Current Estimate', value: formatMoney(invoiceEstimate.totalEstimatedInvoiceCents) }
  ]), [invoiceEstimate, leadPricing.rateCents]);

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Billing"
      subtitle="Review subscription state, valid lead charges, and the current invoice estimate."
      status={status}
      primaryAction={primaryAction}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
        <div className="grid min-w-0 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Status</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Billing Status</div>
                <div className="mt-1 text-xl font-semibold">{billing?.status || '-'}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Monthly Base</div>
                <div className="mt-1 text-xl font-semibold">{formatMoney(billing?.plan?.monthlyAmountCents)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Trial Days Left</div>
                <div className="mt-1 text-xl font-semibold">{typeof billing?.trialDaysRemaining === 'number' ? billing.trialDaysRemaining : '-'}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-sm md:grid-cols-[220px_1fr]">
              <div>Current billing window</div><div>{billing?.currentPeriod?.label || '-'} · {formatDate(billing?.currentPeriod?.start)} to {formatDate(billing?.currentPeriod?.end)}</div>
              <div>Current period end</div><div>{formatDate(billing?.currentPeriodEnd)}</div>
              <div>Application access</div><div>{billing?.appAccessStatus || '-'}</div>
              <div>Service access</div><div>{billing?.serviceAccessStatus || '-'}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="mt-0 text-lg font-semibold">Lead Billing</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">Only valid billable leads count toward usage. General questions, duplicates, spam, and non-project calls do not.</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {Number(leadUsage.validLeadCount || 0)} valid · {Number(leadUsage.billableLeadCount || 0)} billable
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              {invoiceCards.map((card) => (
                <div key={card.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-500">{card.label}</div>
                  <div className="mt-1 text-xl font-semibold">{card.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-sm md:grid-cols-[220px_1fr]">
              <div>Included leads</div><div>{Number(leadPricing.includedCount || 0)}</div>
              <div>Open follow-up calls</div><div>{Number(leadUsage.openFollowUpCount || 0)}</div>
              <div>Non-lead calls in window</div><div>{Number(leadUsage.nonLeadCount || 0)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="mt-0 text-lg font-semibold">Recent Calls In This Billing Window</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">This is the ledger customers need to trust: what counted, what did not, and why.</p>
              </div>
              <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={loadState === 'loading'}>
                Refresh
              </Button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Time</th>
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Caller</th>
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Summary</th>
                    <th className="px-2 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Lead Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.length ? recentCalls.map((call) => (
                    <tr key={call.call_sid} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-3 text-sm text-slate-600">{formatDateTime(call.created_at)}</td>
                      <td className="px-2 py-3 text-sm text-slate-900">
                        <div>{[call.caller_first_name, call.caller_last_name].filter(Boolean).join(' ') || 'Unknown caller'}</div>
                        <div className="text-xs text-slate-500">{call.callback_number || '-'}</div>
                      </td>
                      <td className="px-2 py-3 text-sm text-slate-700">
                        <div>{call.summary || 'No summary available yet.'}</div>
                        <div className="mt-1 text-xs text-slate-500">{call.service_required || formatLeadDecisionReason(call.lead_decision_reason)}</div>
                      </td>
                      <td className="px-2 py-3 text-sm text-slate-700">
                        <LeadStatusBadge call={call} />
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-sm text-slate-500">No calls have landed in this billing window yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Actions</h2>
            {!viewer.canManage ? (
              <p className="text-sm text-slate-500">Only the account owner can change billing or restart service.</p>
            ) : billing?.status === 'deactivated' ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={reactivateAccount} disabled={actionState.reactivating}>
                  {actionState.reactivating ? 'Restarting...' : 'Restart Account'}
                </Button>
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={actionState.reactivating}>
                  Refresh
                </Button>
              </div>
            ) : billing?.stripeSubscriptionId ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={openPortal} disabled={actionState.checkout || actionState.portal || !billing?.stripeCustomerId}>
                  {actionState.portal ? 'Opening portal...' : 'Open Billing Portal'}
                </Button>
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={actionState.checkout || actionState.portal}>
                  Refresh
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={startCheckout} disabled={actionState.checkout || actionState.portal}>
                  {actionState.checkout ? 'Opening checkout...' : 'Activate Billing'}
                </Button>
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={actionState.checkout || actionState.portal}>
                  Refresh
                </Button>
              </div>
            )}
          </div>
        </div>

        <GuidePanel title="Billing Guide" eyebrow="How pricing works" icon="payments">
          <div>Your monthly bill has two parts: the base subscription and the valid billable leads captured during the current billing window.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">What counts as billable</div>
            <ul className="mb-0 mt-2 list-disc pl-5 text-sm text-slate-600">
              <li>Real project or service interest.</li>
              <li>Usable callback information.</li>
              <li>Not spam, not wrong number, not duplicate, and not a general question only.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            If service is ever deactivated after the trial window, the owner can restart it here without waiting on support.
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

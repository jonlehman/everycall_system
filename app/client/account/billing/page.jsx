'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';
import { formatBillingCallTypeLabel, getChargeBucketMeta } from '../../../../lib/callBilling';

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

function formatPeriodRange(start, end) {
  return `${formatDate(start)} to ${formatDate(end)}`;
}

function formatBillingPeriodStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getStatusTone(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['active', 'paid', 'trialing'].includes(normalized)) return 'ok';
  if (['deactivated', 'trial_expired', 'unpaid'].includes(normalized)) return 'bad';
  return 'warn';
}

function BillingPeriodStatusBadge({ status }) {
  const tone = getStatusTone(status);
  const toneClass = tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'bad'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass}`}>
      {formatBillingPeriodStatus(status)}
    </span>
  );
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

function CallChargeBadge({ call }) {
  const bucket = getChargeBucketMeta(call?.charge_bucket);
  const toneClass = bucket.tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : bucket.tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <div className="space-y-1">
      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${toneClass}`}>
        {bucket.label}
      </span>
      <div className="text-xs text-slate-500">{call?.billing_call_type_label || formatBillingCallTypeLabel(call?.billing_call_type_code)}</div>
    </div>
  );
}

function MetricCard({ label, value, detail = '', tone = 'default' }) {
  const toneClass = tone === 'brand'
    ? 'border-blue-200 bg-blue-50'
    : tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-slate-50';
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-xs normal-case tracking-normal text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

function KeyValueGrid({ items, className = 'md:grid-cols-[200px_1fr]' }) {
  return (
    <div className={`grid gap-2 text-sm ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <div className="text-slate-500">{item.label}</div>
          <div className="text-slate-900">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function SectionCard({ title, description = '', action = null, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 shadow-sm ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mt-0 text-lg font-semibold">{title}</h2>
          {description ? <p className="m-0 mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CallsLedgerTable({ calls, emptyMessage }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Time</th>
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Caller</th>
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Summary</th>
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Billing Status</th>
          </tr>
        </thead>
        <tbody>
          {calls.length ? calls.map((call) => (
            <tr key={call.call_sid} className="border-b border-slate-100 align-top">
              <td className="px-2 py-3 text-sm text-slate-600">{formatDateTime(call.created_at)}</td>
              <td className="px-2 py-3 text-sm text-slate-900">
                <div>{[call.caller_first_name, call.caller_last_name].filter(Boolean).join(' ') || 'Unknown caller'}</div>
                <div className="text-xs text-slate-500">{call.callback_number || '-'}</div>
              </td>
              <td className="px-2 py-3 text-sm text-slate-700">
                <div>{call.summary || 'No summary available yet.'}</div>
                <div className="mt-1 text-xs text-slate-500">{call.service_required || 'No service summary available.'}</div>
              </td>
              <td className="px-2 py-3 text-sm text-slate-700">
                <CallChargeBadge call={call} />
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={4} className="px-2 py-6 text-sm text-slate-500">{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdjustmentsTable({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Created</th>
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Type</th>
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Description</th>
            <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.billing_period_adjustment_id} className="border-b border-slate-100 align-top">
              <td className="px-2 py-3 text-sm text-slate-600">{formatDateTime(item.created_at)}</td>
              <td className="px-2 py-3 text-sm text-slate-700">{formatBillingPeriodStatus(item.adjustment_type)}</td>
              <td className="px-2 py-3 text-sm text-slate-700">{item.description || '-'}</td>
              <td className="px-2 py-3 text-sm font-medium text-slate-900">
                {String(item.adjustment_type || '').toLowerCase() === 'credit' ? '-' : ''}
                {formatMoney(item.amount_cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AccountBillingPage() {
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState(null);
  const [viewer, setViewer] = useState({ canManage: false, userRole: null });
  const [loadState, setLoadState] = useState('loading');
  const [actionState, setActionState] = useState({ checkout: false, portal: false, reactivating: false });
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState(null);
  const [selectedBillingPeriodId, setSelectedBillingPeriodId] = useState(null);
  const [selectedBillingPeriodLoading, setSelectedBillingPeriodLoading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
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
      if (data.billing.status === 'trialing' && !data.billing.hasStripeSubscription) {
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
    void loadBilling();
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

  const loadBillingPeriodDetail = async (billingPeriodId) => {
    if (!billingPeriodId) return;
    setSelectedBillingPeriodId(billingPeriodId);
    setSelectedBillingPeriodLoading(true);
    try {
      const data = await fetchJson(`/api/v1/billing/periods/${encodeURIComponent(billingPeriodId)}`);
      setSelectedBillingPeriod(data?.billingPeriod || null);
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not load billing period details.' });
      setSelectedBillingPeriod(null);
    } finally {
      setSelectedBillingPeriodLoading(false);
    }
  };

  const applyCoupon = async () => {
    const normalizedCode = String(couponCode || '').trim().toUpperCase();
    if (!normalizedCode) {
      setStatus({ tone: 'bad', message: 'Enter a coupon code first.' });
      return;
    }
    setCouponBusy(true);
    setStatus({ tone: 'warn', message: 'Applying coupon...' });
    try {
      const data = await fetchJson('/api/v1/billing/coupons/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode })
      });
      setCouponCode('');
      await loadBilling({ keepStatus: true });
      setStatus({ tone: 'ok', message: data?.message || 'Coupon applied.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not apply coupon.' });
    } finally {
      setCouponBusy(false);
    }
  };

  const callUsage = billing?.callUsage || {};
  const callInvoiceEstimate = billing?.callInvoiceEstimate || {};
  const callPricing = billing?.callPricing || {};
  const callAdjustments = billing?.callAdjustments || {};
  const activeCoupon = billing?.activeCoupon || null;
  const recentCalls = Array.isArray(callUsage.recentCalls) ? callUsage.recentCalls : [];
  const billingPeriodHistory = Array.isArray(billing?.billingPeriodHistory) ? billing.billingPeriodHistory : [];
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
          label: billing?.hasStripeSubscription ? 'Open Billing Portal' : 'Activate Billing',
          brand: true,
          onClick: billing?.hasStripeSubscription ? openPortal : startCheckout,
          disabled: actionState.checkout || actionState.portal || actionState.reactivating || loadState === 'loading'
        }
      : null;

  const selectedPeriodCallUsage = selectedBillingPeriod?.callUsage || {};
  const selectedPeriodInvoiceEstimate = selectedBillingPeriod?.invoiceEstimate || {};
  const selectedPeriodAdjustments = selectedBillingPeriod?.adjustments || {};
  const selectedPeriodRecentCalls = Array.isArray(selectedPeriodCallUsage.recentCalls) ? selectedPeriodCallUsage.recentCalls : [];

  const overviewMetrics = useMemo(() => ([
    {
      label: 'Plan',
      value: billing?.plan?.label || '-',
      detail: billing?.plan?.isCustom ? 'Custom pricing is active.' : `${formatMoney(billing?.plan?.monthlyAmountCents)} base subscription`
    },
    {
      label: 'Current Estimate',
      value: formatMoney(callInvoiceEstimate.totalEstimatedInvoiceCents),
      detail: `${formatMoney(callInvoiceEstimate.overageAmountCents)} in overages this window`,
      tone: 'brand'
    },
    {
      label: 'Included Usage',
      value: `${Number(callUsage.includedCallCountUsed || 0)} / ${Number(callPricing.includedCallCount || 0)}`,
      detail: `${Number(callUsage.overageCallCount || 0)} overage calls so far`
    },
    {
      label: billing?.status === 'trialing' && !billing?.hasStripeSubscription ? 'Trial Remaining' : 'Period Ends',
      value: billing?.status === 'trialing' && !billing?.hasStripeSubscription
        ? `${typeof billing?.trialDaysRemaining === 'number' ? billing.trialDaysRemaining : 0} day(s)`
        : formatDate(billing?.currentPeriodEnd),
      detail: billing?.currentPeriod?.label || 'Current billing window'
    }
  ]), [
    billing?.currentPeriod?.label,
    billing?.currentPeriodEnd,
    billing?.hasStripeSubscription,
    billing?.plan?.isCustom,
    billing?.plan?.label,
    billing?.plan?.monthlyAmountCents,
    billing?.status,
    billing?.trialDaysRemaining,
    callInvoiceEstimate.overageAmountCents,
    callInvoiceEstimate.totalEstimatedInvoiceCents,
    callPricing.includedCallCount,
    callUsage.includedCallCountUsed,
    callUsage.overageCallCount
  ]);

  const usageMetrics = useMemo(() => ([
    {
      label: 'Eligible Calls',
      value: `${Number(callUsage.eligibleCallCount || 0)}`,
      detail: 'Calls that count toward included usage or overages'
    },
    {
      label: 'Included Used',
      value: `${Number(callUsage.includedCallCountUsed || 0)}`,
      detail: `of ${Number(callPricing.includedCallCount || 0)} included calls`
    },
    {
      label: 'Overage Calls',
      value: `${Number(callUsage.overageCallCount || 0)}`,
      detail: `${formatMoney(callPricing.callOverageRateCents)} per call`,
      tone: Number(callUsage.overageCallCount || 0) > 0 ? 'warn' : 'default'
    },
    {
      label: 'Excluded Calls',
      value: `${Number(callUsage.excludedCallCount || 0)}`,
      detail: 'Under one minute, unanswered, failed, test, or excluded'
    }
  ]), [
    callPricing.callOverageRateCents,
    callPricing.includedCallCount,
    callUsage.eligibleCallCount,
    callUsage.excludedCallCount,
    callUsage.includedCallCountUsed,
    callUsage.overageCallCount
  ]);

  const currentWindowValue = [
    billing?.currentPeriod?.label || '',
    billing?.currentPeriod?.start || billing?.currentPeriod?.end
      ? formatPeriodRange(billing?.currentPeriod?.start, billing?.currentPeriod?.end)
      : ''
  ].filter(Boolean).join(' · ') || '-';

  const overviewDetails = [
    {
      label: 'Current billing window',
      value: currentWindowValue
    },
    { label: 'Billing status', value: formatBillingPeriodStatus(billing?.status) },
    { label: 'Application access', value: formatBillingPeriodStatus(billing?.appAccessStatus) },
    { label: 'Service access', value: formatBillingPeriodStatus(billing?.serviceAccessStatus) },
    { label: 'Included calls', value: `${Number(callPricing.includedCallCount || 0)}` },
    { label: 'Overage rate', value: `${formatMoney(callPricing.callOverageRateCents)} / call` }
  ];

  const currentNetAdjustmentAmountCents = Number(callAdjustments.netAdjustmentAmountCents || 0);
  const currentMonthlyDiscountPercent = Number(callInvoiceEstimate.monthlyDiscountPercent || 0);
  const currentOverageDiscountPercent = Number(callInvoiceEstimate.overageDiscountPercent || 0);

  const usageDetails = [
    { label: 'Base subscription', value: formatMoney(callInvoiceEstimate.discountedBaseAmountCents ?? callInvoiceEstimate.baseAmountCents) },
    { label: 'Overage charges', value: formatMoney(callInvoiceEstimate.overageAmountCents) },
    ...(currentNetAdjustmentAmountCents !== 0
      ? [{ label: 'Manual adjustments', value: formatMoney(currentNetAdjustmentAmountCents) }]
      : []),
    ...(currentMonthlyDiscountPercent !== 0
      ? [{ label: 'Monthly discount', value: `${currentMonthlyDiscountPercent}%` }]
      : []),
    ...(currentOverageDiscountPercent !== 0
      ? [{ label: 'Overage discount', value: `${currentOverageDiscountPercent}%` }]
      : []),
    { label: 'Estimated total', value: formatMoney(callInvoiceEstimate.totalEstimatedInvoiceCents) }
  ];

  const managementDetails = [
    { label: 'Workspace access', value: formatBillingPeriodStatus(billing?.appAccessStatus) },
    { label: 'Receptionist service', value: formatBillingPeriodStatus(billing?.serviceAccessStatus) },
    { label: 'Stripe subscription', value: billing?.hasStripeSubscription ? 'Connected' : 'Not active yet' },
    { label: 'Cancel at period end', value: billing?.cancelAtPeriodEnd ? 'Yes' : 'No' }
  ];

  const selectedPeriodSummaryMetrics = selectedBillingPeriod ? [
    {
      label: 'Base Subscription',
      value: formatMoney(selectedPeriodInvoiceEstimate.discountedBaseAmountCents ?? selectedPeriodInvoiceEstimate.baseAmountCents)
    },
    {
      label: 'Estimated Total',
      value: formatMoney(selectedPeriodInvoiceEstimate.totalEstimatedInvoiceCents),
      tone: 'brand'
    },
    {
      label: 'Overage Charges',
      value: formatMoney(selectedPeriodInvoiceEstimate.overageAmountCents)
    },
    {
      label: 'Adjustments',
      value: formatMoney(selectedPeriodAdjustments.netAdjustmentAmountCents || 0)
    }
  ] : [];

  const selectedPeriodMonthlyDiscountPercent = Number(selectedPeriodInvoiceEstimate.monthlyDiscountPercent || 0);
  const selectedPeriodOverageDiscountPercent = Number(selectedPeriodInvoiceEstimate.overageDiscountPercent || 0);

  const selectedPeriodDetails = [
    { label: 'Included calls', value: `${Number(selectedBillingPeriod?.callPricing?.includedCallCount || 0)}` },
    { label: 'Included used', value: `${Number(selectedPeriodCallUsage.includedCallCountUsed || 0)}` },
    { label: 'Eligible calls', value: `${Number(selectedPeriodCallUsage.eligibleCallCount || 0)}` },
    { label: 'Excluded calls', value: `${Number(selectedPeriodCallUsage.excludedCallCount || 0)}` },
    { label: 'Overage rate', value: `${formatMoney(selectedBillingPeriod?.callPricing?.callOverageRateCents || 0)} / call` },
    ...(selectedPeriodMonthlyDiscountPercent !== 0
      ? [{ label: 'Monthly discount', value: `${selectedPeriodMonthlyDiscountPercent}%` }]
      : []),
    ...(selectedPeriodOverageDiscountPercent !== 0
      ? [{ label: 'Overage discount', value: `${selectedPeriodOverageDiscountPercent}%` }]
      : [])
  ];

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Billing"
      subtitle="Track your current bill, see how call usage is being counted, and manage the account’s billing state."
      status={status}
      primaryAction={primaryAction}
      statusChip={{
        tone: loadState === 'ready' && getStatusTone(billing?.status) === 'ok' ? 'ok' : 'warn',
        label: loadState === 'ready' ? formatBillingPeriodStatus(billing?.status) : 'Loading billing'
      }}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <div className="grid min-w-0 gap-3">
          <SectionCard
            title="Current Billing Snapshot"
            description="This is the fastest read on what the account is costing right now and where the current billing window stands."
            action={(
              <div className="flex flex-wrap items-center gap-2">
                <BillingPeriodStatusBadge status={billing?.status} />
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={loadState === 'loading'}>
                  Refresh
                </Button>
              </div>
            )}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {overviewMetrics.map((metric) => (
                <MetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  detail={metric.detail}
                  tone={metric.tone}
                />
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <KeyValueGrid items={overviewDetails} />
            </div>
          </SectionCard>

          <SectionCard
            title="Current Usage And Charges"
            description="Included calls are consumed in chronological order. Calls above the included allowance become overages in the current billing period."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {usageMetrics.map((metric) => (
                <MetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  detail={metric.detail}
                  tone={metric.tone}
                />
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <KeyValueGrid items={usageDetails} />
            </div>
          </SectionCard>

          <SectionCard
            title="Calls In The Current Billing Window"
            description="This is the live call ledger for the current billing period."
          >
            <CallsLedgerTable
              calls={recentCalls}
              emptyMessage="No calls have landed in this billing window yet."
            />
          </SectionCard>

          <SectionCard
            title="Billing History"
            description="Open a prior billing period to review its calls, overages, and adjustments."
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Period</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Status</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Calls</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Overage</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Est. Total</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500"></th>
                  </tr>
                </thead>
                <tbody>
                  {billingPeriodHistory.length ? billingPeriodHistory.map((period) => {
                    const isSelected = Number(selectedBillingPeriodId || 0) === Number(period.billingPeriodId || 0);
                    const isCurrent = Number(period.billingPeriodId || 0) === Number(billing?.currentBillingPeriodId || 0);
                    return (
                      <tr key={period.billingPeriodId} className="border-b border-slate-100 align-top">
                        <td className="px-2 py-3 text-sm text-slate-700">
                          <div className="font-medium text-slate-900">{formatPeriodRange(period.periodStart, period.periodEnd)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {isCurrent ? 'Current billing window' : (period.planCode || 'Plan')}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-sm text-slate-700">
                          <BillingPeriodStatusBadge status={period.status} />
                        </td>
                        <td className="px-2 py-3 text-sm text-slate-700">
                          <div>{Number(period.eligibleCallCount || 0)} eligible</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {Number(period.includedCallCountUsed || 0)} included · {Number(period.overageCallCount || 0)} overage
                          </div>
                        </td>
                        <td className="px-2 py-3 text-sm text-slate-700">{formatMoney(period.overageAmountCents || 0)}</td>
                        <td className="px-2 py-3 text-sm font-medium text-slate-900">{formatMoney(period.totalEstimatedInvoiceCents || 0)}</td>
                        <td className="px-2 py-3 text-right">
                          <Button
                            variant={isSelected ? 'default' : 'outline'}
                            type="button"
                            onClick={() => loadBillingPeriodDetail(period.billingPeriodId)}
                            disabled={selectedBillingPeriodLoading && isSelected}
                          >
                            {selectedBillingPeriodLoading && isSelected ? 'Loading...' : 'Open'}
                          </Button>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-sm text-slate-500">No billing periods have been recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {selectedBillingPeriodLoading && !selectedBillingPeriod ? (
            <SectionCard
              title="Billing Period Detail"
              description="Loading the selected billing period."
            >
              <div className="text-sm text-slate-500">Loading period details...</div>
            </SectionCard>
          ) : null}

          {selectedBillingPeriod ? (
            <SectionCard
              title="Billing Period Detail"
              description={formatPeriodRange(selectedBillingPeriod.periodStart, selectedBillingPeriod.periodEnd)}
              action={<BillingPeriodStatusBadge status={selectedBillingPeriod.status} />}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {selectedPeriodSummaryMetrics.map((metric) => (
                  <MetricCard
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    tone={metric.tone}
                  />
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <KeyValueGrid items={selectedPeriodDetails} />
              </div>

              <div className="mt-6">
                <h3 className="m-0 text-base font-semibold text-slate-900">Calls In This Period</h3>
                <div className="mt-3">
                  <CallsLedgerTable
                    calls={selectedPeriodRecentCalls.map((call) => ({
                      ...call,
                      call_sid: `${selectedBillingPeriod.billingPeriodId}-${call.call_sid}`
                    }))}
                    emptyMessage="No calls are recorded for this billing period."
                  />
                </div>
              </div>

              {Array.isArray(selectedPeriodAdjustments.items) && selectedPeriodAdjustments.items.length ? (
                <div className="mt-6">
                  <h3 className="m-0 text-base font-semibold text-slate-900">Adjustments</h3>
                  <div className="mt-3">
                    <AdjustmentsTable items={selectedPeriodAdjustments.items} />
                  </div>
                </div>
              ) : null}
            </SectionCard>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-3 xl:sticky xl:top-24">
          <SectionCard
            title="Manage Billing"
            description="Use this area for owner actions, account access state, and service recovery."
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <KeyValueGrid items={managementDetails} className="md:grid-cols-[150px_1fr]" />
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <h3 className="m-0 text-base font-semibold text-slate-900">Coupon</h3>

              {activeCoupon ? (
                <>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MetricCard label="Active Code" value={activeCoupon.code} detail="Currently applied to this account" />
                    <MetricCard
                      label="Monthly Discount"
                      value={`${Number(activeCoupon.monthlyDiscountPercent || 0)}%`}
                      detail={`${Number(activeCoupon.overageDiscountPercent || 0)}% overage discount`}
                      tone="brand"
                    />
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <KeyValueGrid
                      items={[
                        { label: 'Free trial', value: `${Number(activeCoupon.freeTrialDays || 0)} day(s)` },
                        { label: 'Discount duration', value: Number(activeCoupon.discountDurationDays || 0) === 0 ? 'Unlimited' : `${activeCoupon.discountDurationDays} day(s)` },
                        { label: 'Trial ends', value: activeCoupon.trialEndsAt ? formatDateTime(activeCoupon.trialEndsAt) : '—' },
                        { label: 'Discount starts', value: activeCoupon.discountStartsAt ? formatDateTime(activeCoupon.discountStartsAt) : (activeCoupon.pendingPaidDiscountStart ? 'When paid billing begins' : '—') },
                        { label: 'Discount ends', value: activeCoupon.discountEndsAt ? formatDateTime(activeCoupon.discountEndsAt) : 'Unlimited / pending' }
                      ]}
                      className="md:grid-cols-[150px_1fr]"
                    />
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No coupon is active for this account.</p>
              )}

              {!viewer.canManage ? (
                <p className="mt-4 text-sm text-slate-500">Only the account owner can apply or replace a coupon.</p>
              ) : billing?.plan?.isCustom ? (
                <p className="mt-4 text-sm text-slate-500">Coupons are not available for custom-priced accounts.</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <input
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-xs"
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                    placeholder="Coupon code"
                  />
                  <Button
                    variant="outline"
                    className="border-[#004ac6] bg-white text-[#004ac6] hover:bg-[#eff4ff] hover:text-[#004ac6]"
                    type="button"
                    onClick={applyCoupon}
                    disabled={couponBusy}
                  >
                    {couponBusy ? 'Applying...' : (activeCoupon ? 'Replace Code' : 'Apply Code')}
                  </Button>
                </div>
              )}
            </div>

            {!viewer.canManage ? (
              <p className="mt-4 text-sm text-slate-500">Only the account owner can change billing or restart service.</p>
            ) : billing?.status === 'deactivated' ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={reactivateAccount} disabled={actionState.reactivating}>
                  {actionState.reactivating ? 'Restarting...' : 'Restart Account'}
                </Button>
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={actionState.reactivating}>
                  Refresh
                </Button>
              </div>
            ) : billing?.hasStripeSubscription ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={openPortal} disabled={actionState.checkout || actionState.portal || !billing?.hasStripeCustomer}>
                  {actionState.portal ? 'Opening portal...' : 'Open Billing Portal'}
                </Button>
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={actionState.checkout || actionState.portal}>
                  Refresh
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={startCheckout} disabled={actionState.checkout || actionState.portal}>
                  {actionState.checkout ? 'Opening checkout...' : 'Activate Billing'}
                </Button>
                <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={actionState.checkout || actionState.portal}>
                  Refresh
                </Button>
              </div>
            )}

            {billing?.cancelAtPeriodEnd ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This subscription is set to cancel at the end of the current period.
              </div>
            ) : null}
          </SectionCard>

          <GuidePanel title="Billing Guide" eyebrow="How pricing works" icon="payments">
            <div>Your monthly bill has two parts: the base subscription and any call overages above the included allowance in the current billing period.</div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">What counts toward usage</div>
              <ul className="mb-0 mt-2 list-disc pl-5 text-sm text-slate-600">
                <li>Calls the receptionist answers and handles for one minute or longer count toward usage.</li>
                <li>Answered calls that end in under one minute stay off the invoice.</li>
                <li>Unanswered calls, technical failures, test calls, and manual exclusions do not count toward usage.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              If service is ever deactivated after the trial window, the owner can restart it here without waiting on support.
            </div>
          </GuidePanel>
        </div>
      </div>
    </SectionPage>
  );
}

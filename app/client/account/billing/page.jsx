'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../../../../components/ui/button';
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

function DetailDisclosure({ label = 'Details', open = false, onToggle, children }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        <span className="material-symbols-outlined text-[20px] text-slate-500">
          {open ? 'expand_more' : 'chevron_right'}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-200 px-4 py-4">
          {children}
        </div>
      ) : null}
    </div>
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
  const [showCurrentBillDetails, setShowCurrentBillDetails] = useState(false);
  const [showCouponDetails, setShowCouponDetails] = useState(false);
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

  const currentWindowRange = billing?.currentPeriod?.start || billing?.currentPeriod?.end
    ? formatPeriodRange(billing?.currentPeriod?.start, billing?.currentPeriod?.end)
    : '-';

  const currentNetAdjustmentAmountCents = Number(callAdjustments.netAdjustmentAmountCents || 0);
  const currentDisplayedBaseAmountCents = billing?.plan?.baseAmountCents
    ? (Number(callInvoiceEstimate.monthlyDiscountPercent || 0) > 0
        ? Math.round(Number(billing.plan.baseAmountCents || 0) * ((100 - Number(callInvoiceEstimate.monthlyDiscountPercent || 0)) / 100))
        : Number(billing.plan.baseAmountCents || 0))
    : Number(callInvoiceEstimate.discountedBaseAmountCents ?? callInvoiceEstimate.baseAmountCents ?? 0);
  const currentDisplayedTotalEstimateCents = currentDisplayedBaseAmountCents
    + Number(callInvoiceEstimate.overageAmountCents || 0)
    + currentNetAdjustmentAmountCents;

  const currentBillMetrics = useMemo(() => ([
    {
      label: 'Plan',
      value: billing?.plan?.label || '-',
      detail: billing?.plan?.isCustom
        ? 'Custom pricing is active.'
        : `${formatMoney(billing?.plan?.baseAmountCents)} billed ${String(billing?.plan?.billingIntervalLabel || 'Monthly').toLowerCase()}`
    },
    {
      label: 'Current Estimate',
      value: formatMoney(currentDisplayedTotalEstimateCents),
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
      detail: currentWindowRange
    }
  ]), [
    billing?.currentPeriodEnd,
    billing?.hasStripeSubscription,
    billing?.plan?.baseAmountCents,
    billing?.plan?.billingIntervalLabel,
    billing?.plan?.isCustom,
    billing?.plan?.label,
    billing?.status,
    billing?.trialDaysRemaining,
    callInvoiceEstimate.overageAmountCents,
    callPricing.includedCallCount,
    callUsage.includedCallCountUsed,
    callUsage.overageCallCount,
    currentDisplayedTotalEstimateCents,
    currentWindowRange
  ]);

  const currentBillDetails = [
    {
      label: 'Current period',
      value: [
        billing?.currentPeriod?.label || '',
        currentWindowRange !== '-' ? currentWindowRange : ''
      ].filter(Boolean).join(' · ') || '-'
    },
    { label: 'Status', value: formatBillingPeriodStatus(billing?.status) },
    { label: 'Billing cadence', value: billing?.plan?.billingIntervalLabel || 'Monthly' },
    { label: 'Included calls', value: `${Number(callPricing.includedCallCount || 0)}` },
    { label: 'Calls used', value: `${Number(callUsage.includedCallCountUsed || 0)}` },
    ...(Number(callUsage.overageCallCount || 0) > 0
      ? [{ label: 'Overage calls', value: `${Number(callUsage.overageCallCount || 0)}` }]
      : []),
    { label: 'Overage rate', value: `${formatMoney(callPricing.callOverageRateCents)} / call` },
    ...(currentNetAdjustmentAmountCents !== 0
      ? [{ label: 'Manual adjustments', value: formatMoney(currentNetAdjustmentAmountCents) }]
      : []),
    { label: 'Estimated total', value: formatMoney(currentDisplayedTotalEstimateCents) }
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
    { label: 'Calls used', value: `${Number(selectedPeriodCallUsage.includedCallCountUsed || 0)}` },
    ...(Number(selectedPeriodCallUsage.overageCallCount || 0) > 0
      ? [{ label: 'Overage calls', value: `${Number(selectedPeriodCallUsage.overageCallCount || 0)}` }]
      : []),
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
      subtitle="Review your current bill and manage billing."
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
            title="Current Period"
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
              {currentBillMetrics.map((metric) => (
                <MetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  detail={metric.detail}
                  tone={metric.tone}
                />
              ))}
            </div>
            <DetailDisclosure
              label="Billing Details"
              open={showCurrentBillDetails}
              onToggle={() => setShowCurrentBillDetails((current) => !current)}
            >
              <KeyValueGrid items={currentBillDetails} />
            </DetailDisclosure>
          </SectionCard>

          <SectionCard
            title="Calls This Period"
          >
            <CallsLedgerTable
              calls={recentCalls}
              emptyMessage="No calls have landed in this billing window yet."
            />
          </SectionCard>

          <SectionCard
            title="Billing History"
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Period</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Calls</th>
                    <th className="px-2 py-3 text-xs font-semibold normal-case tracking-normal text-slate-500">Total</th>
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
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span>{isCurrent ? 'Current period' : (period.planCode || 'Plan')}</span>
                            <BillingPeriodStatusBadge status={period.status} />
                          </div>
                        </td>
                        <td className="px-2 py-3 text-sm text-slate-700">
                          <div>{Number(period.includedCallCountUsed || 0)} / {Number(period.includedCallCount || 0)} used</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {Number(period.overageCallCount || 0)} overage
                          </div>
                        </td>
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
                      <td colSpan={4} className="px-2 py-6 text-sm text-slate-500">No billing periods have been recorded yet.</td>
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
              title="Selected Period"
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
            title="Billing Actions"
          >
            <div className="space-y-2 text-sm text-slate-600">
              <div>Status: <span className="font-medium text-slate-900">{formatBillingPeriodStatus(billing?.status)}</span></div>
              <div>Stripe: <span className="font-medium text-slate-900">{billing?.hasStripeSubscription ? 'Connected' : 'Not active yet'}</span></div>
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

            {!billing?.plan?.isCustom || activeCoupon ? (
              <DetailDisclosure
                label="Coupon"
                open={showCouponDetails}
                onToggle={() => setShowCouponDetails((current) => !current)}
              >
                <div className="space-y-4">
                  {activeCoupon ? (
                    <KeyValueGrid
                      items={[
                        { label: 'Active code', value: activeCoupon.code },
                        { label: 'Monthly discount', value: `${Number(activeCoupon.monthlyDiscountPercent || 0)}%` },
                        { label: 'Overage discount', value: `${Number(activeCoupon.overageDiscountPercent || 0)}%` },
                        { label: 'Free trial', value: `${Number(activeCoupon.freeTrialDays || 0)} day(s)` }
                      ]}
                      className="md:grid-cols-[150px_1fr]"
                    />
                  ) : (
                    <p className="m-0 text-sm text-slate-500">No coupon is active for this account.</p>
                  )}

                  {!viewer.canManage ? (
                    <p className="m-0 text-sm text-slate-500">Only the account owner can apply or replace a coupon.</p>
                  ) : billing?.plan?.isCustom ? (
                    <p className="m-0 text-sm text-slate-500">Coupons are not available for custom-priced accounts.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
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
              </DetailDisclosure>
            ) : null}

            {billing?.cancelAtPeriodEnd ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This subscription is set to cancel at the end of the current period.
              </div>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </SectionPage>
  );
}

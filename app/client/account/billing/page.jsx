'use client';

import { useEffect, useState } from 'react';
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

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatShortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0%';
  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function normalizeRatio(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!bottom || bottom < 0) return 0;
  return (top / bottom) * 100;
}

function buildPlanSubtitle(billing) {
  if (!billing) return '';
  const cadence = String(billing?.plan?.billingIntervalLabel || 'Monthly').toLowerCase();
  if (billing.status === 'trialing' && !billing.hasStripeSubscription) {
    return `Trial active • Ends ${formatDate(billing.trialEnd)}`;
  }
  if (billing.status === 'deactivated') {
    return 'Service is inactive';
  }
  if (billing.cancelAtPeriodEnd) {
    return `Active through ${formatDate(billing.currentPeriodEnd)}`;
  }
  return `Billed ${cadence} • Renews ${formatDate(billing.currentPeriodEnd)}`;
}

function formatBillingIntervalUnit(label) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'monthly') return 'month';
  if (normalized === 'annual' || normalized === 'yearly') return 'year';
  return normalized || 'period';
}

function buildUsageInsight({ billing, callUsage, callPricing, billingPeriodHistory }) {
  if (billing?.status === 'trialing' && !billing?.hasStripeSubscription) {
    return 'Trial usage is tracked now. Charges start only after billing is activated and the trial ends.';
  }
  const includedLimit = Number(callPricing?.includedCallCount || 0);
  const overageCalls = Number(callUsage?.overageCallCount || 0);
  if (overageCalls > 0) {
    return `You are ${formatCompactNumber(overageCalls)} calls over plan in the current billing period.`;
  }
  const usagePercent = normalizeRatio(callUsage?.includedCallCountUsed, includedLimit);
  if (usagePercent >= 90) {
    return 'You are close to your included call limit for this billing period.';
  }
  const comparableHistory = (Array.isArray(billingPeriodHistory) ? billingPeriodHistory : [])
    .filter((period) => Number(period?.billingPeriodId || 0) !== Number(billing?.currentBillingPeriodId || 0))
    .slice(0, 3);
  if (!comparableHistory.length) {
    return 'Usage is within your included call volume right now.';
  }
  const averageRecentCalls = comparableHistory.reduce((sum, period) => (
    sum + Number(period?.includedCallCountUsed || 0) + Number(period?.overageCallCount || 0)
  ), 0) / comparableHistory.length;
  const currentTotalCalls = Number(callUsage?.includedCallCountUsed || 0) + Number(callUsage?.overageCallCount || 0);
  if (averageRecentCalls > 0 && currentTotalCalls > averageRecentCalls) {
    const deltaPercent = ((currentTotalCalls - averageRecentCalls) / averageRecentCalls) * 100;
    return `This period is tracking ${formatPercent(deltaPercent)} above your recent average usage.`;
  }
  return 'Usage is tracking in line with your recent billing periods.';
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
        : 'border-slate-200 bg-[#f8f9ff]';
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
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
    <section className={`rounded-[1.35rem] border border-[#c3c6d7]/20 bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,74,198,0.05)] ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mt-0 text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
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
    <div className="mt-4 rounded-xl border border-slate-200 bg-[#f8f9ff]">
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
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Time</th>
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Caller</th>
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Summary</th>
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Billing status</th>
          </tr>
        </thead>
        <tbody>
          {calls.length ? calls.map((call) => (
            <tr key={call.call_sid} className="border-b border-slate-100 align-top">
              <td className="px-3 py-3 text-sm text-slate-600">{formatDateTime(call.created_at)}</td>
              <td className="px-3 py-3 text-sm text-slate-900">
                <div>{[call.caller_first_name, call.caller_last_name].filter(Boolean).join(' ') || 'Unknown caller'}</div>
                <div className="text-xs text-slate-500">{call.callback_number || '-'}</div>
              </td>
              <td className="px-3 py-3 text-sm text-slate-700">
                <div>{call.summary || 'No summary available yet.'}</div>
                <div className="mt-1 text-xs text-slate-500">{call.service_required || 'No service summary available.'}</div>
              </td>
              <td className="px-3 py-3 text-sm text-slate-700">
                <CallChargeBadge call={call} />
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-sm text-slate-500">{emptyMessage}</td>
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
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Created</th>
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Type</th>
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Description</th>
            <th className="px-3 py-3 text-xs font-semibold text-slate-500">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.billing_period_adjustment_id} className="border-b border-slate-100 align-top">
              <td className="px-3 py-3 text-sm text-slate-600">{formatDateTime(item.created_at)}</td>
              <td className="px-3 py-3 text-sm text-slate-700">{formatBillingPeriodStatus(item.adjustment_type)}</td>
              <td className="px-3 py-3 text-sm text-slate-700">{item.description || '-'}</td>
              <td className="px-3 py-3 text-sm font-medium text-slate-900">
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
  const currentIncludedCalls = Number(callUsage.includedCallCountUsed || 0);
  const currentOverageCalls = Number(callUsage.overageCallCount || 0);
  const currentTotalCalls = currentIncludedCalls + currentOverageCalls;
  const includedCallLimit = Number(callPricing.includedCallCount || 0);
  const currentUsagePercent = normalizeRatio(currentTotalCalls, includedCallLimit);
  const currentUsageProgressPercent = Math.min(Math.max(currentUsagePercent, 0), 100);
  const planSubtitle = buildPlanSubtitle(billing);
  const usageInsight = buildUsageInsight({ billing, callUsage, callPricing, billingPeriodHistory });
  const billingHistoryRows = billingPeriodHistory.map((period) => ({
    ...period,
    totalCalls: Number(period?.includedCallCountUsed || 0) + Number(period?.overageCallCount || 0)
  }));
  const usageTimelinePeriods = [...billingHistoryRows]
    .slice(0, 6)
    .sort((left, right) => new Date(left.periodStart || 0).getTime() - new Date(right.periodStart || 0).getTime());
  const maxTimelineCalls = Math.max(...usageTimelinePeriods.map((period) => period.totalCalls), 1);
  const highestUsagePeriods = [...billingHistoryRows]
    .sort((left, right) => right.totalCalls - left.totalCalls)
    .slice(0, 3);

  const selectedPeriodSummaryMetrics = selectedBillingPeriod ? [
    {
      label: 'Base plan',
      value: formatMoney(selectedPeriodInvoiceEstimate.discountedBaseAmountCents ?? selectedPeriodInvoiceEstimate.baseAmountCents)
    },
    {
      label: 'Estimated total',
      value: formatMoney(selectedPeriodInvoiceEstimate.totalEstimatedInvoiceCents),
      tone: 'brand'
    },
    {
      label: 'Overage charges',
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
    { label: 'Included calls', value: formatCompactNumber(selectedBillingPeriod?.callPricing?.includedCallCount || 0) },
    { label: 'Calls used', value: formatCompactNumber(selectedPeriodCallUsage.includedCallCountUsed || 0) },
    ...(Number(selectedPeriodCallUsage.overageCallCount || 0) > 0
      ? [{ label: 'Overage calls', value: formatCompactNumber(selectedPeriodCallUsage.overageCallCount || 0) }]
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
      title="Billing & Usage"
      subtitle="Manage your EveryCall subscription and monitor call volume."
      status={status}
      headerAside={(
        <Button variant="outline" type="button" onClick={() => loadBilling()} disabled={loadState === 'loading'}>
          Refresh
        </Button>
      )}
      primaryAction={primaryAction}
      statusChip={{
        tone: loadState === 'ready' && getStatusTone(billing?.status) === 'ok' ? 'ok' : 'warn',
        label: loadState === 'ready' ? formatBillingPeriodStatus(billing?.status) : 'Loading billing'
      }}
    >
      <div className="grid gap-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.92fr)]">
          <section className="rounded-[1.5rem] border border-[#c3c6d7]/20 bg-white p-8 shadow-[0_4px_20px_-4px_rgba(0,74,198,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 text-2xl font-semibold tracking-tight text-slate-950">{billing?.plan?.label || 'Plan'}</h2>
                  <BillingPeriodStatusBadge status={billing?.status} />
                </div>
                <p className="m-0 mt-2 text-sm text-slate-500">{planSubtitle}</p>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-4xl font-semibold tracking-tight text-[#004ac6]">
                  {formatMoney(currentDisplayedBaseAmountCents)}
                </div>
                <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                  per {formatBillingIntervalUnit(billing?.plan?.billingIntervalLabel)}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-6">
              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Current call usage</div>
                    <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                      {formatCompactNumber(currentTotalCalls)} <span className="text-base font-medium text-slate-500">/ {formatCompactNumber(includedCallLimit)}</span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-sm font-medium text-slate-700">{formatPercent(currentUsagePercent)} used</div>
                    <div className="mt-1 text-xs text-slate-500">{currentWindowRange}</div>
                  </div>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-[#e6eeff]">
                  <div
                    className="h-full rounded-full bg-[#004ac6]"
                    style={{ width: `${currentUsageProgressPercent}%` }}
                  />
                </div>
                <div className="mt-3 text-sm text-slate-600">{usageInsight}</div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-slate-200/80 pt-5 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500">Included calls</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                    {formatCompactNumber(includedCallLimit)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Overage calls</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                    {formatCompactNumber(currentOverageCalls)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Current estimate</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                    {formatMoney(currentDisplayedTotalEstimateCents)}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col justify-between rounded-[1.5rem] border border-[#c3c6d7]/15 bg-[#eff4ff] p-8">
            <div>
              <div className="mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#004ac6]">pending_actions</span>
                <h3 className="m-0 text-xl font-semibold tracking-tight text-slate-950">
                  {billing?.status === 'trialing' && !billing?.hasStripeSubscription ? 'Estimate After Trial' : 'Upcoming Bill'}
                </h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-600">{billing?.plan?.label || 'Plan'} base</span>
                  <span className="font-medium text-slate-950">{formatMoney(currentDisplayedBaseAmountCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-600">Overage ({formatCompactNumber(currentOverageCalls)} calls)</span>
                  <span className="font-medium text-slate-950">{formatMoney(callInvoiceEstimate.overageAmountCents || 0)}</span>
                </div>
                {currentNetAdjustmentAmountCents !== 0 ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-600">Adjustments</span>
                    <span className="font-medium text-slate-950">{formatMoney(currentNetAdjustmentAmountCents)}</span>
                  </div>
                ) : null}
                {activeCoupon ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-600">Coupon</span>
                    <span className="font-medium text-emerald-700">{activeCoupon.code}</span>
                  </div>
                ) : null}
                <div className="flex items-end justify-between gap-3 border-t border-slate-200/70 pt-4">
                  <span className="font-semibold text-slate-950">Total estimate</span>
                  <span className="text-3xl font-semibold tracking-tight text-slate-950">{formatMoney(currentDisplayedTotalEstimateCents)}</span>
                </div>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <div className="rounded-xl border border-white/80 bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-slate-500">credit_card</span>
                  <div>
                    <div className="text-sm font-semibold text-slate-950">
                      {billing?.hasStripeSubscription ? 'Billing is active in Stripe' : 'No payment method is active yet'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {billing?.hasStripeSubscription ? 'Open the billing portal to update payment details and invoices.' : 'Activate billing to add a payment method and continue after trial.'}
                    </div>
                  </div>
                </div>
              </div>

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
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  This subscription is set to cancel at the end of the current period.
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <SectionCard
          title="Usage Timeline"
          description="A quick view of recent billing periods."
          action={<span className="rounded-full bg-[#eff4ff] px-3 py-1 text-xs font-medium text-slate-600">Last 6 periods</span>}
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
            <div>
              <div className="flex h-56 items-end gap-3 rounded-2xl bg-[#f8f9ff] px-4 pb-4 pt-6">
                {usageTimelinePeriods.length ? usageTimelinePeriods.map((period) => {
                  const heightPercent = Math.max((period.totalCalls / maxTimelineCalls) * 100, 8);
                  const isCurrent = Number(period.billingPeriodId || 0) === Number(billing?.currentBillingPeriodId || 0);
                  return (
                    <button
                      key={period.billingPeriodId}
                      type="button"
                      onClick={() => loadBillingPeriodDetail(period.billingPeriodId)}
                      className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-3"
                    >
                      <span className="text-[10px] font-medium text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                        {formatCompactNumber(period.totalCalls)} calls
                      </span>
                      <span
                        className={`w-full rounded-t-md ${isCurrent ? 'bg-[#004ac6]' : 'bg-[#d9e3f6]'}`}
                        style={{ height: `${heightPercent}%` }}
                      />
                      <span className="text-[11px] font-medium text-slate-500">{formatShortDate(period.periodEnd)}</span>
                    </button>
                  );
                }) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                    No prior billing periods yet.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-5">
              <div>
                <h4 className="m-0 text-sm font-semibold text-slate-950">Highest usage periods</h4>
                <div className="mt-3 space-y-2">
                  {highestUsagePeriods.length ? highestUsagePeriods.map((period, index) => (
                    <button
                      key={`high-usage-${period.billingPeriodId}`}
                      type="button"
                      onClick={() => loadBillingPeriodDetail(period.billingPeriodId)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#f8f9ff]"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`h-2 w-2 rounded-full ${index === 0 ? 'bg-rose-500' : index === 1 ? 'bg-[#004ac6]' : 'bg-slate-400'}`} />
                        <span className="text-sm font-medium text-slate-900">
                          {formatPeriodRange(period.periodStart, period.periodEnd)}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-slate-950">{formatCompactNumber(period.totalCalls)} calls</span>
                    </button>
                  )) : (
                    <div className="rounded-xl bg-[#f8f9ff] px-4 py-4 text-sm text-slate-500">
                      Usage history will appear here once billing periods are recorded.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-[#f8f9ff] p-5">
                <h4 className="m-0 text-sm font-semibold text-slate-950">Usage insight</h4>
                <p className="m-0 mt-3 text-sm leading-6 text-slate-600">{usageInsight}</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Billing History">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#eff4ff] text-slate-600">
                  <th className="px-4 py-4 text-xs font-semibold">Period</th>
                  <th className="px-4 py-4 text-xs font-semibold">Calls</th>
                  <th className="px-4 py-4 text-xs font-semibold">Total</th>
                  <th className="px-4 py-4 text-xs font-semibold">Status</th>
                  <th className="px-4 py-4 text-right text-xs font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {billingHistoryRows.length ? billingHistoryRows.map((period) => {
                  const isSelected = Number(selectedBillingPeriodId || 0) === Number(period.billingPeriodId || 0);
                  const isCurrent = Number(period.billingPeriodId || 0) === Number(billing?.currentBillingPeriodId || 0);
                  return (
                    <tr
                      key={period.billingPeriodId}
                      className={`border-b border-slate-100 transition-colors ${isSelected ? 'bg-[#f8f9ff]' : 'hover:bg-[#fafcff]'}`}
                    >
                      <td className="px-4 py-4 text-sm text-slate-700">
                        <div className="font-medium text-slate-950">{formatPeriodRange(period.periodStart, period.periodEnd)}</div>
                        <div className="mt-1 text-xs text-slate-500">{isCurrent ? 'Current period' : (period.planCode || 'Recorded period')}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        <div>{formatCompactNumber(period.includedCallCountUsed || 0)} / {formatCompactNumber(period.includedCallCount || 0)} used</div>
                        <div className="mt-1 text-xs text-slate-500">{formatCompactNumber(period.overageCallCount || 0)} overage</div>
                      </td>
                      <td className="px-4 py-4 text-sm font-semibold text-slate-950">
                        {formatMoney(period.totalEstimatedInvoiceCents || 0)}
                      </td>
                      <td className="px-4 py-4">
                        <BillingPeriodStatusBadge status={period.status} />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Button
                          variant={isSelected ? 'default' : 'outline'}
                          size="sm"
                          type="button"
                          onClick={() => loadBillingPeriodDetail(period.billingPeriodId)}
                          disabled={selectedBillingPeriodLoading && isSelected}
                        >
                          {selectedBillingPeriodLoading && isSelected ? 'Loading...' : 'View'}
                        </Button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">No billing periods have been recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {selectedBillingPeriodLoading && !selectedBillingPeriod ? (
          <SectionCard title="Selected Period" description="Loading the selected billing period.">
            <div className="text-sm text-slate-500">Loading period details...</div>
          </SectionCard>
        ) : null}

        {selectedBillingPeriod ? (
          <SectionCard
            title="Selected Period"
            description={formatPeriodRange(selectedBillingPeriod.periodStart, selectedBillingPeriod.periodEnd)}
            action={<BillingPeriodStatusBadge status={selectedBillingPeriod.status} />}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {selectedPeriodSummaryMetrics.map((metric) => (
                <MetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  tone={metric.tone}
                />
              ))}
            </div>

            <div className="mt-5 rounded-2xl bg-[#f8f9ff] p-5">
              <KeyValueGrid items={selectedPeriodDetails} />
            </div>

            <div className="mt-6">
              <h3 className="m-0 text-lg font-semibold tracking-tight text-slate-950">Calls In This Period</h3>
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
                <h3 className="m-0 text-lg font-semibold tracking-tight text-slate-950">Adjustments</h3>
                <div className="mt-3">
                  <AdjustmentsTable items={selectedPeriodAdjustments.items} />
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : null}
      </div>
    </SectionPage>
  );
}

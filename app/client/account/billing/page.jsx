'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

const PANEL_KEYS = {
  plan: 'plan',
  payment: 'payment',
  invoices: 'invoices'
};

function formatMoney(amountCents) {
  const amount = Number(amountCents || 0) / 100;
  const normalized = Number.isFinite(amount) ? amount : 0;
  const fractionDigits = Math.round(normalized * 100) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2
  }).format(normalized);
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatShortDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatCardBrand(value) {
  const text = String(value || '').trim();
  if (!text) return 'Card';
  return text
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMaskedCard(last4) {
  const suffix = String(last4 || '').trim();
  return suffix ? `•••• ${suffix}` : 'None';
}

function fetchJson(url, options) {
  return fetch(url, { cache: 'no-store', ...options }).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const error = new Error(data?.message || data?.error || 'request_failed');
      error.code = data?.error || null;
      throw error;
    }
    return data;
  });
}

function getBillingActionLabel(type) {
  if (type === 'portal') return 'Manage Billing';
  if (type === 'checkout') return 'Activate Billing';
  if (type === 'reactivate') return 'Restart Service';
  return 'Manage Billing';
}

function getBusyBillingActionLabel(type) {
  if (type === 'reactivate') return 'Restarting...';
  return 'Opening...';
}

function getBillingBadgeTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active') return 'success';
  if (normalized === 'trialing') return 'info';
  if (['past_due', 'unpaid', 'incomplete', 'deactivated', 'trial_expired'].includes(normalized)) return 'danger';
  if (normalized === 'canceled') return 'neutral';
  return 'info';
}

function getPaymentBadgeTone(hasPaymentMethod) {
  return hasPaymentMethod ? 'success' : 'danger';
}

function getInvoiceBadgeTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'paid') return 'success';
  if (normalized === 'open') return 'info';
  if (normalized === 'past due' || normalized === 'past_due') return 'danger';
  if (!normalized) return 'neutral';
  return 'neutral';
}

function badgeClassName(tone) {
  if (tone === 'success') {
    return 'bg-[#007f2f]/10 text-[#006323]';
  }
  if (tone === 'danger') {
    return 'bg-[#ffdad6] text-[#93000a]';
  }
  if (tone === 'neutral') {
    return 'bg-[#d9e3f6] text-[#434655]';
  }
  return 'bg-[#dbe1ff] text-[#003ea8]';
}

function renderStatusDot(tone) {
  if (tone === 'success') return 'bg-[#006323]';
  if (tone === 'danger') return 'bg-[#ba1a1a]';
  if (tone === 'neutral') return 'bg-[#737686]';
  return 'bg-[#004ac6]';
}

function buildPlanHeroDescription(billing) {
  const includedCount = Number(billing?.callPricing?.includedCallCount || billing?.plan?.includedCallCount || 0);
  const interval = String(billing?.plan?.billingIntervalLabel || '').trim().toLowerCase();
  if (includedCount > 0 && interval === 'monthly') {
    return `Perfect for growing teams handling up to ${formatCount(includedCount)} inbound calls monthly.`;
  }
  if (includedCount > 0 && interval === 'annual') {
    return `Perfect for growing teams handling up to ${formatCount(includedCount)} inbound calls yearly.`;
  }
  if (includedCount > 0) {
    return `Perfect for growing teams handling up to ${formatCount(includedCount)} inbound calls each billing cycle.`;
  }
  if (billing?.plan?.isCustom) {
    return 'Custom billing terms for this EveryCall workspace.';
  }
  return 'Billing for this workspace is managed in Stripe and summarized here.';
}

function buildInvoiceCardSubtitle(summary) {
  const nextChargeDate = formatShortDate(summary?.nextCharge?.date);
  if (nextChargeDate) return `Next billing: ${nextChargeDate}`;
  if (summary?.latestInvoice?.hasInvoice) return `Latest invoice: ${summary.latestInvoice.statusLabel}`;
  return 'Latest invoice summary';
}

function intervalUnitLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'annual') return '/ yr';
  if (normalized === 'monthly') return '/ mo';
  return '/ cycle';
}

function buildPlanFeatureItems(billing) {
  const includedCount = Number(billing?.callPricing?.includedCallCount || billing?.plan?.includedCallCount || 0);
  const interval = String(billing?.plan?.billingIntervalLabel || '').trim().toLowerCase();
  const periodLabel = interval === 'annual' ? 'year' : 'month';
  const overageRateCents = Number(billing?.callPricing?.callOverageRateCents || billing?.plan?.callOverageRateCents || 0);

  return [
    includedCount > 0
      ? `${formatCount(includedCount)} Inbound Calls / ${periodLabel}`
      : 'Custom inbound call allowance',
    overageRateCents > 0
      ? `${formatMoney(overageRateCents)} per additional call`
      : 'Custom additional call pricing',
    'Billing managed securely in Stripe'
  ];
}

function buildNextChargeLabel(nextCharge) {
  if (!nextCharge) return 'No charge scheduled';
  if (nextCharge.mode === 'trial_end') {
    return nextCharge.date ? `Trial ends ${formatShortDate(nextCharge.date)}` : 'Trial active';
  }
  if (nextCharge.mode === 'amount_due') {
    return nextCharge.amountCents ? `${formatMoney(nextCharge.amountCents)} due` : 'Amount due';
  }
  if (nextCharge.amountCents && nextCharge.date) {
    return `${formatMoney(nextCharge.amountCents)} on ${formatShortDate(nextCharge.date)}`;
  }
  if (nextCharge.amountCents) {
    return formatMoney(nextCharge.amountCents);
  }
  return 'No charge scheduled';
}

function buildPendingPlanLabel(pendingPlan) {
  if (!pendingPlan?.label) return null;
  const effectiveDate = formatShortDate(pendingPlan.effectiveAt);
  return effectiveDate
    ? `${pendingPlan.label} starts ${effectiveDate}`
    : `${pendingPlan.label} starts next renewal`;
}

function buildCouponSummary(coupon) {
  if (!coupon) return '';

  const summary = [];
  const monthlyDiscountPercent = Number(coupon.monthlyDiscountPercent || 0);
  const overageDiscountPercent = Number(coupon.overageDiscountPercent || 0);
  const freeTrialDays = Number(coupon.freeTrialDays || 0);

  if (monthlyDiscountPercent > 0) {
    summary.push(`${monthlyDiscountPercent}% off your monthly plan`);
  }
  if (overageDiscountPercent > 0) {
    summary.push(`${overageDiscountPercent}% off overages`);
  }
  if (freeTrialDays > 0) {
    summary.push(`${freeTrialDays} extra trial day${freeTrialDays === 1 ? '' : 's'}`);
  }

  return summary.join(' · ');
}

function ActionButton({
  tone = 'secondary',
  label,
  icon = null,
  onClick,
  disabled = false
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-all ${
        tone === 'primary'
          ? 'bg-gradient-to-br from-[#004ac6] to-[#2563eb] text-white shadow-[0px_8px_16px_-4px_rgba(37,99,235,0.25)] hover:-translate-y-0.5'
          : 'border border-[#c3c6d7]/40 bg-transparent text-[#121c2a] hover:bg-[#eff4ff]'
      } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0`}
    >
      <span>{label}</span>
      {icon ? <span className="material-symbols-outlined text-[18px]">{icon}</span> : null}
    </button>
  );
}

function MasterCard({
  active = false,
  icon,
  title,
  subtitle,
  badge = null,
  onClick
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-start gap-4 overflow-hidden rounded-lg p-5 text-left transition-all ${
        active
          ? 'border-l-4 border-[#004ac6] bg-white shadow-[0px_8px_16px_-4px_rgba(18,28,42,0.05)]'
          : 'border border-[#c3c6d7]/15 bg-white hover:bg-[#eff4ff]'
      }`}
    >
      {active ? <div className="absolute inset-0 bg-gradient-to-r from-[#dbe1ff]/70 to-transparent opacity-70" /> : null}
      <div
        className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
          active
            ? 'bg-[#e6eeff] text-[#004ac6]'
            : 'bg-[#dee9fc] text-[#434655] group-hover:text-[#004ac6]'
        }`}
      >
        <span className="material-symbols-outlined text-[22px]" style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}>
          {icon}
        </span>
      </div>
      <div className="relative z-10 flex min-w-0 flex-col">
        <h3 className="text-base font-semibold text-[#121c2a]">{title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#434655]">
          <span className="min-w-0 truncate">{subtitle}</span>
          {badge ? (
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClassName(badge.tone)}`}>
              {badge.label}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function DetailBadge({ label, tone = 'info' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold uppercase tracking-wider ${badgeClassName(tone)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${renderStatusDot(tone)}`} />
      {label}
    </span>
  );
}

function ContentCard({ label, children }) {
  return (
    <div className="flex flex-col rounded-lg border border-[#c3c6d7]/15 bg-[#f8f9ff] p-6">
      <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-[#434655]">{label}</h4>
      {children}
    </div>
  );
}

function FeatureList({ items = [] }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-3 text-sm text-[#121c2a]">
          <span className="material-symbols-outlined text-[20px] text-[#006323]">check_circle</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function LoadingLayout() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="w-full lg:w-1/3">
          <div className="space-y-4">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-[92px] animate-pulse rounded-lg border border-[#c3c6d7]/15 bg-white" />
            ))}
          </div>
        </div>
        <div className="w-full lg:w-2/3">
          <div className="h-[540px] animate-pulse rounded-xl border border-[#c3c6d7]/10 bg-white shadow-[0px_24px_48px_-12px_rgba(18,28,42,0.04)]" />
        </div>
      </div>
    </div>
  );
}

export default function AccountBillingPage() {
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState(null);
  const [viewer, setViewer] = useState({ canManage: false, userRole: null });
  const [loadState, setLoadState] = useState('loading');
  const [manageBusy, setManageBusy] = useState(false);
  const [billingCouponCode, setBillingCouponCode] = useState('');
  const [billingCouponBusy, setBillingCouponBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState(null);
  const [selectedPanel, setSelectedPanel] = useState(PANEL_KEYS.plan);

  const loadPage = async () => {
    setLoadState('loading');
    try {
      const billingData = await fetchJson('/api/v1/billing');
      setBilling(billingData?.billing || null);
      setViewer(billingData?.viewer || { canManage: false, userRole: null });
      setLoadState(billingData?.billing ? 'ready' : 'error');
      if (!billingData?.billing) {
        setFlashStatus({ tone: 'bad', message: 'Could not load billing details.' });
      }
    } catch (error) {
      setLoadState('error');
      setFlashStatus({ tone: 'bad', message: error?.message || 'Could not load billing details.' });
    }
  };

  useEffect(() => {
    void loadPage();
  }, []);

  useEffect(() => {
    const checkoutState = String(searchParams?.get('checkout') || '').trim().toLowerCase();
    if (checkoutState === 'success') {
      setFlashStatus({ tone: 'ok', message: 'Billing updated.' });
      return;
    }
    if (checkoutState === 'cancel') {
      setFlashStatus({ tone: 'warn', message: 'Billing checkout was canceled.' });
    }
  }, [searchParams]);

  const launchStripeFlow = async (preferredType) => {
    const openPortal = () => fetchJson('/api/v1/billing/portal', { method: 'POST' });
    const openCheckout = () => fetchJson('/api/v1/billing/checkout', { method: 'POST' });

    if (preferredType === 'portal') {
      try {
        const data = await openPortal();
        window.location.href = data.portalUrl;
        return;
      } catch (error) {
        if (error?.code !== 'billing_customer_missing') {
          throw error;
        }
      }
      const fallback = await openCheckout();
      window.location.href = fallback.checkoutUrl;
      return;
    }

    try {
      const data = await openCheckout();
      window.location.href = data.checkoutUrl;
    } catch (error) {
      if (error?.code !== 'subscription_already_exists') {
        throw error;
      }
      const fallback = await openPortal();
      window.location.href = fallback.portalUrl;
    }
  };

  const handleBillingAction = async () => {
    const actionType = billing?.summary?.manageAction?.type;
    if (!actionType || !viewer.canManage) return;

    if (actionType === 'reactivate') {
      const confirmed = window.confirm('Restart this account and provision a new Sales Receptionist Number?');
      if (!confirmed) return;
    }

    setManageBusy(true);
    try {
      if (actionType === 'reactivate') {
        const data = await fetchJson('/api/v1/billing/reactivate', { method: 'POST' });
        await loadPage();
        setFlashStatus({ tone: 'ok', message: data?.message || 'Service restarted.' });
        return;
      }

      await launchStripeFlow(actionType);
    } catch (error) {
      setFlashStatus({ tone: 'bad', message: error?.message || 'Could not open billing management.' });
    } finally {
      setManageBusy(false);
    }
  };

  const applyBillingCoupon = async () => {
    const code = String(billingCouponCode || '').trim().toUpperCase();
    if (!code) {
      setFlashStatus({ tone: 'warn', message: 'Enter a coupon code first.' });
      return;
    }

    setBillingCouponBusy(true);
    try {
      const data = await fetchJson('/api/v1/billing/coupons/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      setBillingCouponCode('');
      await loadPage();
      setFlashStatus({ tone: 'ok', message: data?.message || 'Coupon applied.' });
    } catch (error) {
      setFlashStatus({ tone: 'bad', message: error?.message || 'Could not apply coupon.' });
    } finally {
      setBillingCouponBusy(false);
    }
  };

  const summary = billing?.summary || null;
  const pageStatus = flashStatus || summary?.alert || null;
  const canManage = Boolean(viewer?.canManage) && loadState === 'ready';
  const billingActionType = summary?.manageAction?.type || null;
  const billingActionLabel = manageBusy ? getBusyBillingActionLabel(billingActionType) : getBillingActionLabel(billingActionType);
  const billingStatus = String(billing?.status || '').trim().toLowerCase();
  const planBaseAmount = Number(billing?.plan?.baseAmountCents || 0);
  const includedCallCount = Number(billing?.callPricing?.includedCallCount || billing?.plan?.includedCallCount || 0);
  const totalCallsThisCycle = Number(billing?.callUsage?.includedCallCountUsed || 0) + Number(billing?.callUsage?.overageCallCount || 0);
  const overageCalls = Number(billing?.callUsage?.overageCallCount || 0);
  const pendingPlan = billing?.pendingPlan || summary?.plan?.pendingPlan || null;
  const pendingPlanLabel = buildPendingPlanLabel(pendingPlan);
  const activeCoupon = billing?.activeCoupon || null;
  const couponSummary = buildCouponSummary(activeCoupon);
  const couponEntryDisabled = !canManage || billingStatus === 'deactivated' || billingCouponBusy || manageBusy;
  const usagePercent = includedCallCount > 0
    ? Math.min((totalCallsThisCycle / includedCallCount) * 100, 100)
    : 0;
  const cycleResetLabel = formatShortDate(billing?.currentPeriod?.end || billing?.currentPeriodEnd);
  const paymentMethod = summary?.paymentMethod || { hasPaymentMethod: false };
  const latestInvoice = summary?.latestInvoice || { hasInvoice: false };

  const panels = [
    {
      key: PANEL_KEYS.plan,
      icon: 'package',
      title: 'Current Plan',
      subtitle: billing?.plan?.label || 'Plan',
      badge: {
        label: summary?.statusLabel || 'Active',
        tone: getBillingBadgeTone(billing?.status)
      }
    },
    {
      key: PANEL_KEYS.payment,
      icon: 'credit_card',
      title: 'Payment Methods',
      subtitle: paymentMethod?.hasPaymentMethod
        ? `${formatCardBrand(paymentMethod.brand)} ending in ${paymentMethod.last4}`
        : 'No payment method on file'
    },
    {
      key: PANEL_KEYS.invoices,
      icon: 'receipt',
      title: 'Invoice History',
      subtitle: buildInvoiceCardSubtitle(summary)
    }
  ];

  let detailTitle = billing?.plan?.label || 'Billing';
  let detailDescription = '';
  let detailMetricValue = '';
  let detailMetricUnit = '';
  let detailBadgeLabel = '';
  let detailBadgeTone = 'info';
  let detailPrimaryAction = {
    label: billingActionLabel,
    onClick: handleBillingAction,
    disabled: !canManage || manageBusy,
    icon: billingActionType === 'reactivate' ? 'autorenew' : 'arrow_forward'
  };
  let detailSecondaryAction = {
    label: 'Manage Plan',
    onClick: handleBillingAction,
    disabled: !canManage || manageBusy
  };
  let detailLeft = null;
  let detailRight = null;

  if (selectedPanel === PANEL_KEYS.payment) {
    detailTitle = 'Payment Methods';
    detailDescription = 'Your default payment method is used for subscription renewals and invoice payments handled in Stripe.';
    detailMetricValue = formatMaskedCard(paymentMethod?.last4);
    detailMetricUnit = paymentMethod?.hasPaymentMethod ? 'card' : 'on file';
    detailBadgeLabel = paymentMethod?.hasPaymentMethod ? 'On File' : 'Needs Attention';
    detailBadgeTone = getPaymentBadgeTone(paymentMethod?.hasPaymentMethod);
    detailSecondaryAction = {
      label: billingActionType === 'reactivate' ? 'Current Plan' : (billingActionType === 'portal' ? 'Update Payment Method' : 'Add Payment Method'),
      onClick: billingActionType === 'reactivate' ? () => setSelectedPanel(PANEL_KEYS.plan) : handleBillingAction,
      disabled: billingActionType === 'reactivate' ? false : (!canManage || manageBusy)
    };
    detailLeft = (
      <ContentCard label="Default Payment Method">
        <div className="font-['Space_Grotesk'] text-2xl font-medium text-[#121c2a]">
          {paymentMethod?.hasPaymentMethod
            ? `${formatCardBrand(paymentMethod.brand)} ending in ${paymentMethod.last4}`
            : 'No payment method on file'}
        </div>
        <p className="mt-2 text-sm text-[#434655]">
          {paymentMethod?.hasPaymentMethod
            ? `Expires ${String(paymentMethod.expMonth).padStart(2, '0')}/${paymentMethod.expYear}`
            : 'Add a payment method in Stripe to keep billing current.'}
        </p>
      </ContentCard>
    );
    detailRight = (
      <FeatureList
        items={[
          'Add or update your card anytime in billing management',
          'Your default card is used for subscription renewals',
          'Keeping a current payment method helps avoid service interruptions'
        ]}
      />
    );
  } else if (selectedPanel === PANEL_KEYS.invoices) {
    detailTitle = 'Invoice History';
    detailDescription = 'Latest invoice summary and upcoming charge information. Full invoice history and downloads are handled in Stripe.';
    detailMetricValue = latestInvoice?.hasInvoice
      ? formatMoney(latestInvoice.displayAmountCents)
      : (summary?.nextCharge?.amountCents ? formatMoney(summary.nextCharge.amountCents) : 'None');
    detailMetricUnit = latestInvoice?.hasInvoice ? 'last invoice' : 'scheduled';
    detailBadgeLabel = latestInvoice?.hasInvoice ? latestInvoice.statusLabel : 'No Invoices';
    detailBadgeTone = getInvoiceBadgeTone(latestInvoice?.statusLabel);
    detailSecondaryAction = {
      label: billingActionType === 'reactivate' ? 'Current Plan' : (billingActionType === 'portal' ? 'View Invoices' : 'Activate Billing'),
      onClick: billingActionType === 'reactivate' ? () => setSelectedPanel(PANEL_KEYS.plan) : handleBillingAction,
      disabled: billingActionType === 'reactivate' ? false : (!canManage || manageBusy)
    };
    detailLeft = (
      <ContentCard label="Latest Invoice">
        <div className="font-['Space_Grotesk'] text-2xl font-medium text-[#121c2a]">
          {latestInvoice?.hasInvoice ? formatMoney(latestInvoice.displayAmountCents) : 'No invoices yet'}
        </div>
        <p className="mt-2 text-sm text-[#434655]">
          {latestInvoice?.hasInvoice
            ? `${formatShortDate(latestInvoice.createdAt)} · ${latestInvoice.statusLabel}`
            : 'Your first invoice will appear here after billing starts.'}
        </p>
        <div className="mt-5 space-y-3 text-sm text-[#121c2a]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#434655]">Next charge</span>
            <span className="font-medium">{buildNextChargeLabel(summary?.nextCharge)}</span>
          </div>
        </div>
      </ContentCard>
    );
    detailRight = (
      <FeatureList
        items={[
          'Review your latest charges and payment status in one place',
          'Use billing management to view receipts and download invoices',
          'If a payment needs attention, you will see it here'
        ]}
      />
    );
  } else {
    detailTitle = billing?.plan?.label || 'Current Plan';
    detailDescription = pendingPlanLabel
      ? `${buildPlanHeroDescription(billing)} ${pendingPlanLabel}.`
      : buildPlanHeroDescription(billing);
    detailMetricValue = formatMoney(planBaseAmount);
    detailMetricUnit = intervalUnitLabel(billing?.plan?.billingIntervalLabel);
    detailBadgeLabel = summary?.statusLabel || 'Active';
    detailBadgeTone = getBillingBadgeTone(billing?.status);
    detailSecondaryAction = {
      label: billingActionType === 'reactivate' ? 'Current Plan' : 'Manage Plan',
      onClick: billingActionType === 'reactivate' ? () => {} : handleBillingAction,
      disabled: billingActionType === 'reactivate' ? true : (!canManage || manageBusy)
    };
    detailLeft = (
      <ContentCard label="Current Cycle Usage">
        <div className="mb-2 flex items-end justify-between">
          <span className="font-['Space_Grotesk'] text-2xl font-medium text-[#121c2a]">
            {formatCount(totalCallsThisCycle)}
          </span>
          <span className="text-sm text-[#434655]">
            of {formatCount(includedCallCount)} calls handled
          </span>
        </div>
        <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[#d9e3f6]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#004ac6] to-[#2563eb]"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <p className="text-xs text-[#434655]">
          {cycleResetLabel ? `Resets on ${cycleResetLabel}` : 'Usage resets each billing cycle'}
        </p>
        {overageCalls > 0 ? (
          <p className="mt-3 text-xs font-medium text-[#93000a]">
            {formatCount(overageCalls)} calls over plan
          </p>
        ) : null}
        {pendingPlanLabel ? (
          <p className="mt-3 text-xs font-medium text-[#004ac6]">
            Scheduled change: {pendingPlanLabel}
          </p>
        ) : null}
      </ContentCard>
    );
    detailRight = (
      <FeatureList
        items={[
          ...(pendingPlanLabel ? [`Scheduled change: ${pendingPlanLabel}`] : []),
          ...buildPlanFeatureItems(billing)
        ]}
      />
    );
  }

  return (
    <SectionPage tabs={accountNavItems} status={pageStatus}>
      {loadState !== 'ready' || !billing ? (
        <LoadingLayout />
      ) : (
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="w-full lg:w-1/3">
              <div className="flex flex-col gap-4">
                {panels.map((panel) => (
                  <MasterCard
                    key={panel.key}
                    active={selectedPanel === panel.key}
                    icon={panel.icon}
                    title={panel.title}
                    subtitle={panel.subtitle}
                    badge={panel.badge || null}
                    onClick={() => setSelectedPanel(panel.key)}
                  />
                ))}
              </div>
            </div>

            <div className="w-full lg:w-2/3">
              <div className="relative flex flex-col rounded-xl border border-[#c3c6d7]/10 bg-white p-8 shadow-[0px_24px_48px_-12px_rgba(18,28,42,0.04)]">
                <div className="mb-6 flex flex-col items-start justify-between gap-4 border-b border-[#dee9fc] pb-6 md:flex-row md:items-center">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h2 className="font-['Space_Grotesk'] text-3xl font-bold tracking-tight text-[#121c2a]">
                        {detailTitle}
                      </h2>
                      <DetailBadge label={detailBadgeLabel} tone={detailBadgeTone} />
                    </div>
                    <p className="max-w-xl text-sm text-[#434655]">{detailDescription}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-['Space_Grotesk'] flex items-end justify-end gap-1 text-4xl font-bold tracking-tight text-[#121c2a]">
                      <span>{detailMetricValue}</span>
                      <span className="mb-1 text-base font-normal text-[#434655]">{detailMetricUnit}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                  {detailLeft}
                  <div className="flex flex-col justify-center">
                    {detailRight}
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-4 border-t border-[#dee9fc] pt-6 xl:flex-row xl:items-end xl:justify-between">
                  {selectedPanel === PANEL_KEYS.plan ? (
                    <div className="w-full xl:max-w-md">
                      <div className="mb-2 text-xs font-bold uppercase tracking-widest text-[#434655]">Coupon Code</div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={billingCouponCode}
                          onChange={(event) => setBillingCouponCode(event.target.value.toUpperCase())}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void applyBillingCoupon();
                            }
                          }}
                          placeholder="Enter coupon code"
                          disabled={couponEntryDisabled}
                          className="w-full rounded-lg border border-[#c3c6d7]/40 bg-white px-4 py-2.5 text-sm text-[#121c2a] outline-none transition-all placeholder:text-[#737686] focus:border-[#004ac6] focus:ring-2 focus:ring-[#dbe1ff] disabled:cursor-not-allowed disabled:bg-[#f4f6fb] disabled:text-[#737686]"
                        />
                        <ActionButton
                          tone="secondary"
                          label={billingCouponBusy ? 'Applying...' : (activeCoupon ? 'Replace Coupon' : 'Apply Coupon')}
                          onClick={applyBillingCoupon}
                          disabled={couponEntryDisabled}
                        />
                      </div>
                      <p className="mt-2 text-xs text-[#434655]">
                        {billingStatus === 'deactivated'
                          ? 'Restart service before applying a coupon.'
                          : activeCoupon
                            ? `Active coupon: ${activeCoupon.code}${couponSummary ? ` · ${couponSummary}` : ''}`
                            : 'Have a coupon? Enter it here before you start or update billing.'}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-col justify-end gap-4 sm:flex-row xl:ml-auto">
                    <ActionButton
                      tone="secondary"
                      label={detailSecondaryAction.label}
                      onClick={detailSecondaryAction.onClick}
                      disabled={detailSecondaryAction.disabled}
                    />
                    <ActionButton
                      tone="primary"
                      label={detailPrimaryAction.label}
                      icon={detailPrimaryAction.icon}
                      onClick={detailPrimaryAction.onClick}
                      disabled={detailPrimaryAction.disabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </SectionPage>
  );
}

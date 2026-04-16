'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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

function formatLongDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
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

function SectionAction({ label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-sm font-semibold text-slate-700 transition-colors hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-300"
    >
      {label}
    </button>
  );
}

function SummarySection({ label, title, detail = '', action = null, children }) {
  return (
    <section className="px-6 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
          <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-[2rem]">
            {title}
          </div>
          {detail ? <div className="mt-2 text-sm leading-6 text-slate-500">{detail}</div> : null}
        </div>
        {action}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

function ChargeBreakdown({ items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-4">
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
            <span className={`${
              item.tone === 'total'
                ? 'font-semibold text-slate-950'
                : item.tone === 'credit'
                  ? 'text-emerald-700'
                  : 'text-slate-600'
            }`}
            >
              {item.label}
            </span>
            <span className={`${
              item.tone === 'total'
                ? 'font-semibold text-slate-950'
                : item.tone === 'credit'
                  ? 'font-medium text-emerald-700'
                  : 'font-medium text-slate-900'
            }`}
            >
              {formatMoney(item.amountCents)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildPrimaryChargeLine(nextCharge) {
  if (!nextCharge) return '-';
  if (nextCharge.mode === 'trial_end') {
    return nextCharge.date ? `Trial ends ${formatLongDate(nextCharge.date)}` : 'Trial active';
  }
  if (nextCharge.mode === 'amount_due') {
    return nextCharge.amountCents ? `${formatMoney(nextCharge.amountCents)} due` : 'Amount due';
  }
  if (nextCharge.amountCents && nextCharge.date) {
    return `${formatMoney(nextCharge.amountCents)} on ${formatLongDate(nextCharge.date)}`;
  }
  if (nextCharge.amountCents) {
    return formatMoney(nextCharge.amountCents);
  }
  return 'No charge scheduled';
}

function buildChargeDetail(nextCharge) {
  if (!nextCharge) return '';
  if (nextCharge.mode === 'amount_due') {
    const invoiceDate = formatShortDate(nextCharge.date);
    return invoiceDate ? `${nextCharge.statusLabel} · Invoice from ${invoiceDate}` : nextCharge.statusLabel;
  }
  return nextCharge.statusLabel || '';
}

function buildPlanDetail(summaryPlan, billingPlan) {
  if (summaryPlan?.endsAt) {
    const dateLabel = formatLongDate(summaryPlan.endsAt);
    return dateLabel ? `Access ends ${dateLabel}` : 'Access ends at the end of the current term.';
  }
  if (summaryPlan?.allowanceSummary) {
    return summaryPlan.allowanceSummary;
  }
  const cadence = String(billingPlan?.billingIntervalLabel || '').trim().toLowerCase();
  return cadence ? `Billed ${cadence}.` : '';
}

function buildPaymentMethodTitle(paymentMethod) {
  if (!paymentMethod?.hasPaymentMethod) return 'None on file';
  return `${formatCardBrand(paymentMethod.brand)} ending in ${paymentMethod.last4}`;
}

function buildPaymentMethodDetail(paymentMethod) {
  if (!paymentMethod?.hasPaymentMethod) {
    return 'Add a payment method in Stripe.';
  }
  if (paymentMethod.expMonth && paymentMethod.expYear) {
    return `Expires ${String(paymentMethod.expMonth).padStart(2, '0')}/${paymentMethod.expYear}`;
  }
  return '';
}

function buildInvoiceTitle(latestInvoice) {
  if (!latestInvoice?.hasInvoice) return 'No invoices yet';
  const invoiceDate = formatShortDate(latestInvoice.createdAt);
  const amountLabel = formatMoney(latestInvoice.displayAmountCents);
  return `Last invoice: ${invoiceDate || 'Recent'} · ${amountLabel} · ${latestInvoice.statusLabel}`;
}

export default function AccountBillingPage() {
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState(null);
  const [viewer, setViewer] = useState({ canManage: false, userRole: null });
  const [loadState, setLoadState] = useState('loading');
  const [manageBusy, setManageBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [flashStatus, setFlashStatus] = useState(null);

  const loadBilling = async () => {
    setLoadState('loading');
    try {
      const data = await fetchJson('/api/v1/billing');
      setBilling(data?.billing || null);
      setViewer(data?.viewer || { canManage: false, userRole: null });
      setLoadState(data?.billing ? 'ready' : 'error');
      if (!data?.billing) {
        setFlashStatus({ tone: 'bad', message: 'Could not load billing details.' });
      }
    } catch (error) {
      setLoadState('error');
      setFlashStatus({ tone: 'bad', message: error?.message || 'Could not load billing details.' });
    }
  };

  useEffect(() => {
    void loadBilling();
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

  const handlePrimaryAction = async () => {
    if (!billing?.summary?.manageAction || !viewer.canManage) return;
    const actionType = billing.summary.manageAction.type;

    if (actionType === 'reactivate') {
      const confirmed = window.confirm('Restart this account and provision a new Sales Receptionist Number?');
      if (!confirmed) return;
    }

    setManageBusy(true);
    try {
      if (actionType === 'reactivate') {
        const data = await fetchJson('/api/v1/billing/reactivate', { method: 'POST' });
        await loadBilling();
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

  const summary = billing?.summary || null;
  const showStripeActions = summary?.manageAction?.type !== 'reactivate';
  const nextCharge = summary?.nextCharge || null;
  const pageStatus = flashStatus || summary?.alert || null;
  const primaryLabel = summary?.manageAction?.type === 'reactivate'
    ? (manageBusy ? 'Restarting...' : 'Restart service')
    : (manageBusy ? 'Opening...' : 'Manage billing');

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Billing"
      subtitle="Manage your subscription and payment details."
      status={pageStatus}
      primaryAction={{
        label: primaryLabel,
        brand: true,
        onClick: handlePrimaryAction,
        disabled: loadState !== 'ready' || manageBusy || !viewer.canManage
      }}
    >
      <div className="mx-auto w-full max-w-[760px]">
        {loadState !== 'ready' || !billing ? (
          <div className="rounded-[1.5rem] border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500 sm:px-8">
            {loadState === 'error' ? 'Billing details are unavailable right now.' : 'Loading billing summary...'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white divide-y divide-slate-200">
            <SummarySection
              label="Next charge"
              title={buildPrimaryChargeLine(nextCharge)}
              detail={buildChargeDetail(nextCharge)}
              action={(
                <SectionAction
                  label={detailsOpen ? 'Hide details' : 'View details'}
                  onClick={() => setDetailsOpen((current) => !current)}
                  disabled={!Array.isArray(nextCharge?.breakdown) || !nextCharge.breakdown.length}
                />
              )}
            >
              {detailsOpen ? <ChargeBreakdown items={nextCharge?.breakdown || []} /> : null}
            </SummarySection>

            <SummarySection
              label="Plan"
              title={summary?.plan?.name || billing?.plan?.label || 'Plan'}
              detail={buildPlanDetail(summary?.plan, billing?.plan)}
              action={showStripeActions ? (
                <SectionAction
                  label="Manage plan"
                  onClick={handlePrimaryAction}
                  disabled={!viewer.canManage || manageBusy}
                />
              ) : null}
            />

            <SummarySection
              label="Payment method"
              title={buildPaymentMethodTitle(summary?.paymentMethod)}
              detail={buildPaymentMethodDetail(summary?.paymentMethod)}
              action={showStripeActions ? (
                <SectionAction
                  label="Update payment method"
                  onClick={handlePrimaryAction}
                  disabled={!viewer.canManage || manageBusy}
                />
              ) : null}
            />

            <SummarySection
              label="Invoices"
              title={buildInvoiceTitle(summary?.latestInvoice)}
              detail=""
              action={showStripeActions ? (
                <SectionAction
                  label="View invoices"
                  onClick={handlePrimaryAction}
                  disabled={!viewer.canManage || manageBusy}
                />
              ) : null}
            />
          </div>
        )}
      </div>
    </SectionPage>
  );
}

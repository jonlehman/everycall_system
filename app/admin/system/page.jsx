'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import GuidePanel from '../../client/_components/GuidePanel';

function toneClass(tone) {
  if (tone === 'bad') return 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900';
  if (tone === 'ok') return 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900';
  if (tone === 'warn') return 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900';
  return 'rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function formatDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatMoneyInput(amountCents) {
  const amount = Number(amountCents || 0) / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function parseMoneyInput(value, { allowZero = false } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return allowZero ? 0 : null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100);
  if (rounded < 0) return null;
  if (!allowZero && rounded <= 0) return null;
  return rounded;
}

function buildCouponDraft(coupon = null) {
  return {
    billingCouponId: coupon?.billingCouponId || '',
    code: coupon?.code || '',
    status: coupon?.status || 'active',
    monthlyDiscountPercent: coupon ? String(Number(coupon.monthlyDiscountPercent || 0)) : '0',
    overageDiscountPercent: coupon ? String(Number(coupon.overageDiscountPercent || 0)) : '0',
    freeTrialDays: coupon ? String(Number(coupon.freeTrialDays || 0)) : '0',
    discountDurationDays: coupon ? String(Number(coupon.discountDurationDays || 0)) : '0',
    redeemBy: formatDateTimeInput(coupon?.redeemBy),
    notes: coupon?.notes || '',
    planScopes: Array.isArray(coupon?.planScopes) && coupon.planScopes.length ? coupon.planScopes : ['growth']
  };
}

function buildPlanDrafts(plans) {
  return (Array.isArray(plans) ? plans : []).map((plan) => ({
    code: String(plan?.code || '').trim(),
    label: String(plan?.label || '').trim(),
    monthlyAmount: formatMoneyInput(plan?.monthlyAmountCents),
    includedCalls: String(Number(plan?.includedCallCount ?? plan?.includedCount ?? 0)),
    callOverageRate: formatMoneyInput(plan?.callOverageRateCents ?? plan?.leadRateCents),
    stripeProductId: String(plan?.stripeProductId || plan?.stripe_product_id || '').trim(),
    stripePriceId: String(plan?.stripePriceId || plan?.stripe_price_id || '').trim()
  }));
}

function RuntimeFlag({ label, active }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${active ? 'text-emerald-700' : 'text-red-700'}`}>
        {active ? 'Configured' : 'Missing'}
      </div>
    </div>
  );
}

function RecentTable({ title, emptyLabel, columns, rows }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="m-0 text-lg font-semibold text-slate-900">{title}</h2>
      {rows?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${index}`} className="border-b border-slate-100 last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-2 align-top text-slate-700">
                      {column.render ? column.render(row[column.key], row) : (row[column.key] || '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 text-sm text-slate-500">{emptyLabel}</div>
      )}
    </div>
  );
}

export default function AdminSystemPage() {
  const [phrase, setPhrase] = useState('');
  const [defaultTrialDays, setDefaultTrialDays] = useState('30');
  const [billingPlans, setBillingPlans] = useState([]);
  const [telnyxSmsNumber, setTelnyxSmsNumber] = useState('');
  const [telnyxSmsNumberId, setTelnyxSmsNumberId] = useState('');
  const [telnyxSmsMessagingProfileId, setTelnyxSmsMessagingProfileId] = useState('');
  const [configStatus, setConfigStatus] = useState({ message: 'Loading system config...', tone: 'warn' });
  const [couponStatus, setCouponStatus] = useState({ message: 'Loading coupons...', tone: 'warn' });
  const [debugStatus, setDebugStatus] = useState({ message: 'Loading SMS diagnostics...', tone: 'warn' });
  const [testStatus, setTestStatus] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [testMode, setTestMode] = useState('opt_in');
  const [debugData, setDebugData] = useState({
    config: null,
    runtime: {
      telnyxApiKeyConfigured: false,
      telnyxPublicKeyConfigured: false
    },
    recentHealth: [],
    recentFailovers: [],
    recentDeliveries: []
  });
  const [coupons, setCoupons] = useState([]);
  const [couponDraft, setCouponDraft] = useState(buildCouponDraft());
  const [couponSaving, setCouponSaving] = useState(false);

  const loadConfig = async () => {
    setConfigStatus({ message: 'Loading system config...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config');
      const data = resp.ok ? await resp.json() : null;
      if (!data) {
        setConfigStatus({ message: 'Failed to load system config.', tone: 'bad' });
        return;
      }
      setPhrase(data?.config?.global_emergency_phrase || '');
      setDefaultTrialDays(String(data?.config?.default_trial_days || '30'));
      setBillingPlans(buildPlanDrafts(data?.config?.billing_plans_json || []));
      setTelnyxSmsNumber(data?.config?.telnyx_sms_number || '');
      setTelnyxSmsNumberId(data?.config?.telnyx_sms_number_id || '');
      setTelnyxSmsMessagingProfileId(data?.config?.telnyx_sms_messaging_profile_id || '');
      setConfigStatus({ message: 'System config loaded.', tone: 'ok' });
    } catch {
      setConfigStatus({ message: 'Failed to load system config.', tone: 'bad' });
    }
  };

  const loadCoupons = async () => {
    setCouponStatus({ message: 'Loading coupons...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/admin/billing/coupons');
      const data = resp.ok ? await resp.json() : null;
      if (!data) {
        setCouponStatus({ message: 'Failed to load coupons.', tone: 'bad' });
        return;
      }
      setCoupons(Array.isArray(data.coupons) ? data.coupons : []);
      setCouponStatus({ message: 'Coupons loaded.', tone: 'ok' });
    } catch {
      setCouponStatus({ message: 'Failed to load coupons.', tone: 'bad' });
    }
  };

  const loadDiagnostics = async () => {
    setDebugStatus({ message: 'Loading SMS diagnostics...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/sms/debug');
      const data = resp.ok ? await resp.json() : null;
      if (!data) {
        setDebugStatus({ message: 'Failed to load SMS diagnostics.', tone: 'bad' });
        return;
      }
      setDebugData({
        config: data.config || null,
        runtime: data.runtime || {
          telnyxApiKeyConfigured: false,
          telnyxPublicKeyConfigured: false
        },
        recentHealth: data.recentHealth || [],
        recentFailovers: data.recentFailovers || [],
        recentDeliveries: data.recentDeliveries || []
      });
      setDebugStatus({ message: 'SMS diagnostics loaded.', tone: 'ok' });
    } catch {
      setDebugStatus({ message: 'Failed to load SMS diagnostics.', tone: 'bad' });
    }
  };

  useEffect(() => {
    loadConfig();
    loadCoupons();
    loadDiagnostics();
  }, []);

  const saveConfig = async () => {
    if (!phrase.trim()) {
      setConfigStatus({ message: 'Global emergency phrase is required.', tone: 'bad' });
      return;
    }
    const normalizedTrialDays = Number(defaultTrialDays || 0);
    if (!Number.isInteger(normalizedTrialDays) || normalizedTrialDays < 1 || normalizedTrialDays > 365) {
      setConfigStatus({ message: 'Default free trial days must be between 1 and 365.', tone: 'bad' });
      return;
    }
    const normalizedPlans = [];
    for (const plan of billingPlans) {
      const monthlyAmountCents = parseMoneyInput(plan.monthlyAmount);
      const includedCallCount = Number(plan.includedCalls || 0);
      const callOverageRateCents = parseMoneyInput(plan.callOverageRate, { allowZero: true });
      if (!plan?.code || !plan?.label?.trim() || monthlyAmountCents === null || callOverageRateCents === null || !Number.isInteger(includedCallCount) || includedCallCount < 0) {
        setConfigStatus({ message: 'Each billing tier needs a label, monthly amount, included calls, and overage per call.', tone: 'bad' });
        return;
      }
      normalizedPlans.push({
        code: plan.code,
        label: plan.label.trim(),
        monthlyAmountCents,
        includedCallCount,
        callOverageRateCents,
        stripeProductId: String(plan.stripeProductId || '').trim(),
        stripePriceId: String(plan.stripePriceId || '').trim()
      });
    }
    setConfigStatus({ message: 'Saving system config...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalEmergencyPhrase: phrase.trim(),
          defaultTrialDays: normalizedTrialDays,
          billingPlans: normalizedPlans,
          telnyxSmsNumber: telnyxSmsNumber.trim(),
          telnyxSmsNumberId: telnyxSmsNumberId.trim(),
          telnyxSmsMessagingProfileId: telnyxSmsMessagingProfileId.trim()
        })
      });
      setConfigStatus(resp.ok
        ? { message: 'System config saved.', tone: 'ok' }
        : { message: 'Save failed.', tone: 'bad' });
      if (resp.ok) {
        loadConfig();
        loadDiagnostics();
      }
    } catch {
      setConfigStatus({ message: 'Save failed.', tone: 'bad' });
    }
  };

  const updateBillingPlanField = (index, key, value) => {
    setBillingPlans((current) => current.map((plan, planIndex) => (
      planIndex === index ? { ...plan, [key]: value } : plan
    )));
  };

  const resetCouponDraft = () => {
    setCouponDraft(buildCouponDraft());
  };

  const toggleCouponPlanScope = (planCode) => {
    setCouponDraft((current) => {
      const currentScopes = Array.isArray(current.planScopes) ? current.planScopes : [];
      return {
        ...current,
        planScopes: currentScopes.includes(planCode)
          ? currentScopes.filter((item) => item !== planCode)
          : [...currentScopes, planCode]
      };
    });
  };

  const saveCoupon = async () => {
    const normalizedCode = String(couponDraft.code || '').trim().toUpperCase();
    const monthlyDiscountPercent = Number(couponDraft.monthlyDiscountPercent || 0);
    const overageDiscountPercent = Number(couponDraft.overageDiscountPercent || 0);
    const freeTrialDays = Number(couponDraft.freeTrialDays || 0);
    const discountDurationDays = Number(couponDraft.discountDurationDays || 0);
    const planScopes = Array.isArray(couponDraft.planScopes) ? couponDraft.planScopes.filter(Boolean) : [];

    if (!normalizedCode) {
      setCouponStatus({ message: 'Coupon code is required.', tone: 'bad' });
      return;
    }
    if (!planScopes.length) {
      setCouponStatus({ message: 'Select at least one plan for the coupon.', tone: 'bad' });
      return;
    }
    if ([monthlyDiscountPercent, overageDiscountPercent].some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      setCouponStatus({ message: 'Discount percentages must be between 0 and 100.', tone: 'bad' });
      return;
    }
    if (!Number.isInteger(freeTrialDays) || freeTrialDays < 0 || !Number.isInteger(discountDurationDays) || discountDurationDays < 0) {
      setCouponStatus({ message: 'Trial and duration days must be 0 or higher whole numbers.', tone: 'bad' });
      return;
    }
    if (monthlyDiscountPercent <= 0 && overageDiscountPercent <= 0 && freeTrialDays <= 0) {
      setCouponStatus({ message: 'Add at least one benefit before saving the coupon.', tone: 'bad' });
      return;
    }

    setCouponSaving(true);
    setCouponStatus({ message: 'Saving coupon...', tone: 'warn' });
    try {
      const payload = {
        code: normalizedCode,
        status: couponDraft.status,
        monthlyDiscountPercent,
        overageDiscountPercent,
        freeTrialDays,
        discountDurationDays,
        redeemBy: couponDraft.redeemBy ? new Date(couponDraft.redeemBy).toISOString() : null,
        notes: couponDraft.notes,
        planScopes
      };
      const isEditing = Boolean(couponDraft.billingCouponId);
      const resp = await fetch(
        isEditing ? `/api/v1/admin/billing/coupons/${encodeURIComponent(couponDraft.billingCouponId)}` : '/api/v1/admin/billing/coupons',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setCouponStatus({ message: data?.message || 'Coupon save failed.', tone: 'bad' });
        return;
      }
      setCouponStatus({ message: isEditing ? 'Coupon updated.' : 'Coupon created.', tone: 'ok' });
      resetCouponDraft();
      loadCoupons();
    } catch {
      setCouponStatus({ message: 'Coupon save failed.', tone: 'bad' });
    } finally {
      setCouponSaving(false);
    }
  };

  const sendTestSms = async () => {
    if (!testPhone.trim()) {
      setTestStatus({ message: 'Enter a destination phone number first.', tone: 'bad' });
      return;
    }
    setTestStatus({ message: 'Sending test SMS...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testPhone.trim(),
          mode: testMode
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setTestStatus({ message: data?.message || 'Test SMS failed.', tone: 'bad' });
        return;
      }
      setTestStatus({
        message: data?.providerMessageId
          ? `Test SMS accepted by Telnyx. Message ID: ${data.providerMessageId}.`
          : 'Test SMS accepted by Telnyx.',
        tone: 'ok'
      });
      loadDiagnostics();
    } catch {
      setTestStatus({ message: 'Test SMS failed.', tone: 'bad' });
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">System Config</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadDiagnostics}>Refresh SMS Diagnostics</Button>
        </div>
      </div>

      <div className={toneClass(configStatus.tone)}>
        {configStatus.message}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">Global Emergency Phrase</label>
        <textarea
          className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
        />

        <div className="mt-6">
          <h2 className="m-0 text-lg font-semibold text-slate-900">Billing Defaults</h2>
          <div className="mt-1 text-sm text-slate-500">
            These defaults are used for new tenants and when an admin resets a tenant back to a standard pricing tier.
          </div>
          <div className="mt-4 max-w-xs">
            <label className="block text-sm font-medium text-slate-700">Global Free Trial Days</label>
            <input
              type="number"
              min="1"
              max="365"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={defaultTrialDays}
              onChange={(event) => setDefaultTrialDays(event.target.value)}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {billingPlans.map((plan, index) => (
              <div key={plan.code || index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium text-slate-500">{plan.code || `Plan ${index + 1}`}</div>
                <div className="mt-3 grid gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Label</label>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={plan.label}
                      onChange={(event) => updateBillingPlanField(index, 'label', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Monthly Amount</label>
                    <div className="mt-2 flex items-center rounded-lg border border-slate-300 bg-white px-3">
                      <span className="text-sm text-slate-500">$</span>
                      <input
                        inputMode="decimal"
                        className="w-full border-0 bg-transparent px-2 py-2 text-sm focus:outline-none"
                        value={plan.monthlyAmount}
                        onChange={(event) => updateBillingPlanField(index, 'monthlyAmount', event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Included Calls</label>
                    <input
                      inputMode="numeric"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={plan.includedCalls}
                      onChange={(event) => updateBillingPlanField(index, 'includedCalls', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Overage Per Call</label>
                    <div className="mt-2 flex items-center rounded-lg border border-slate-300 bg-white px-3">
                      <span className="text-sm text-slate-500">$</span>
                      <input
                        inputMode="decimal"
                        className="w-full border-0 bg-transparent px-2 py-2 text-sm focus:outline-none"
                        value={plan.callOverageRate}
                        onChange={(event) => updateBillingPlanField(index, 'callOverageRate', event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Stripe Product ID</label>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={plan.stripeProductId}
                      onChange={(event) => updateBillingPlanField(index, 'stripeProductId', event.target.value)}
                      placeholder="prod_..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Stripe Price ID</label>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={plan.stripePriceId}
                      onChange={(event) => updateBillingPlanField(index, 'stripePriceId', event.target.value)}
                      placeholder="price_..."
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <h2 className="m-0 text-lg font-semibold text-slate-900">Coupons</h2>
          <div className="mt-1 text-sm text-slate-500">
            Create one-time codes that can discount the base subscription, call overages, and optionally open a no-card free trial.
          </div>
          <div className={`mt-4 ${toneClass(couponStatus.tone)}`}>
            {couponStatus.message}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Code</label>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.code}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                  placeholder="SPRING100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Status</label>
                <select
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.status}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                  <option value="redeemed">redeemed</option>
                  <option value="expired">expired</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Monthly Discount %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.monthlyDiscountPercent}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, monthlyDiscountPercent: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Overage Discount %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.overageDiscountPercent}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, overageDiscountPercent: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Free Trial Days</label>
                <input
                  type="number"
                  min="0"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.freeTrialDays}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, freeTrialDays: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Discount Duration Days</label>
                <input
                  type="number"
                  min="0"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.discountDurationDays}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, discountDurationDays: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Redeem By</label>
                <input
                  type="datetime-local"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={couponDraft.redeemBy}
                  onChange={(event) => setCouponDraft((current) => ({ ...current, redeemBy: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Applies To Plans</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {billingPlans.map((plan) => {
                    const checked = couponDraft.planScopes.includes(plan.code);
                    return (
                      <label key={plan.code} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCouponPlanScope(plan.code)}
                        />
                        {plan.label || plan.code}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700">Notes</label>
              <textarea
                className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={couponDraft.notes}
                onChange={(event) => setCouponDraft((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={saveCoupon} disabled={couponSaving}>
                {couponSaving ? 'Saving...' : (couponDraft.billingCouponId ? 'Update Coupon' : 'Create Coupon')}
              </Button>
              <Button variant="outline" onClick={resetCouponDraft} disabled={couponSaving}>
                Reset
              </Button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Plans</th>
                  <th className="px-3 py-2 font-medium">Monthly</th>
                  <th className="px-3 py-2 font-medium">Overage</th>
                  <th className="px-3 py-2 font-medium">Trial</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Redeemed</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {coupons.length ? coupons.map((coupon) => (
                  <tr key={coupon.billingCouponId} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 font-medium text-slate-900">{coupon.code}</td>
                    <td className="px-3 py-2 text-slate-700">{coupon.status}</td>
                    <td className="px-3 py-2 text-slate-700">{Array.isArray(coupon.planScopes) && coupon.planScopes.length ? coupon.planScopes.join(', ') : '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{Number(coupon.monthlyDiscountPercent || 0)}%</td>
                    <td className="px-3 py-2 text-slate-700">{Number(coupon.overageDiscountPercent || 0)}%</td>
                    <td className="px-3 py-2 text-slate-700">{Number(coupon.freeTrialDays || 0)} day(s)</td>
                    <td className="px-3 py-2 text-slate-700">{Number(coupon.discountDurationDays || 0) === 0 ? 'Unlimited' : `${coupon.discountDurationDays} day(s)`}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {coupon.redemption
                        ? (
                          <div>
                            <div>{coupon.redemption.tenantKey}</div>
                            <div className="text-xs text-slate-500">{formatTimestamp(coupon.redemption.redeemedAt)}</div>
                          </div>
                        )
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCouponDraft(buildCouponDraft(coupon));
                          setCouponStatus({ message: `Editing ${coupon.code}.`, tone: 'warn' });
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-slate-500">No coupons created yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <GuidePanel title="Coupons Guide" eyebrow="How coupons work" icon="sell">
              <div>
                Coupons are EveryCall-owned, not Stripe-owned. Customers enter them on the EveryCall billing page before checkout, and Stripe Checkout itself stays coupon-free.
              </div>
              <div>
                Each code is one-time use across the whole system. After one tenant redeems it successfully, nobody else can use it.
              </div>
              <div>
                Coupons can apply to one or more standard plans: <code>Starter</code>, <code>Growth</code>, and <code>Pro</code>. They do not apply to <code>Custom</code> pricing by default.
              </div>
              <div>
                <strong>Monthly Discount %</strong> reduces the base subscription amount. For already-active Stripe subscriptions, that discounted monthly amount applies on the next billing period, not immediately.
              </div>
              <div>
                <strong>Overage Discount %</strong> reduces call overage charges inside EveryCall billing. The discounted amount is what gets sent to Stripe as the overage invoice item.
              </div>
              <div>
                <strong>Free Trial Days</strong> opens a no-card trial. The tenant can stay active during that trial without entering a payment method.
              </div>
              <div>
                <strong>Discount Duration Days</strong> controls how long the monthly and overage discounts apply after paid billing begins. <code>0</code> means unlimited.
              </div>
              <div>
                Trial timing and discount timing are separate. Trial days start when the coupon is redeemed. Discount duration starts when paid billing starts, so customers do not lose discount time during the free trial.
              </div>
              <div>
                If a tenant already has an active coupon and a new coupon is redeemed successfully, the new one replaces the old one automatically.
              </div>
              <div>
                <strong>Redeem By</strong> is optional. If set, the coupon can no longer be redeemed after that timestamp.
              </div>
              <div>
                The coupons table shows whether a code has already been redeemed, by which tenant, and when it happened. Use <strong>Edit</strong> to update an unused or operationally managed code.
              </div>
            </GuidePanel>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">Shared Telnyx SMS Number</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsNumber}
              onChange={(event) => setTelnyxSmsNumber(event.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Telnyx SMS Number ID</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsNumberId}
              onChange={(event) => setTelnyxSmsNumberId(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Telnyx Messaging Profile ID</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={telnyxSmsMessagingProfileId}
              onChange={(event) => setTelnyxSmsMessagingProfileId(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveConfig}>Save System Config</Button>
        </div>
      </div>

      <div className={toneClass(debugStatus.tone)}>
        {debugStatus.message}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RuntimeFlag label="Shared SMS Number" active={Boolean(debugData?.config?.telnyx_sms_number)} />
        <RuntimeFlag label="Messaging Profile ID" active={Boolean(debugData?.config?.telnyx_sms_messaging_profile_id)} />
        <RuntimeFlag label="TELNYX_API_KEY" active={Boolean(debugData?.runtime?.telnyxApiKeyConfigured)} />
        <RuntimeFlag label="TELNYX_PUBLIC_KEY" active={Boolean(debugData?.runtime?.telnyxPublicKeyConfigured)} />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
        Outbound test sends only confirm that EveryCall can hand the message to Telnyx. Final carrier delivery still depends on the sender being properly 10DLC-registered and the webhook public key being correct if you want inbound/failover events to validate.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="m-0 text-lg font-semibold text-slate-900">Send Test SMS</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div>
            <label className="block text-sm font-medium text-slate-700">Destination Phone Number</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Message Type</label>
            <select
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={testMode}
              onChange={(event) => setTestMode(event.target.value)}
            >
              <option value="opt_in">Opt-In Copy</option>
              <option value="test">Generic Test Copy</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={sendTestSms}>Send Test SMS</Button>
          </div>
        </div>
        {testStatus?.message ? (
          <div className={`mt-4 ${toneClass(testStatus.tone)}`}>
            {testStatus.message}
          </div>
        ) : null}
      </div>

      <RecentTable
        title="Recent SMS Channel Health"
        emptyLabel="No recent SMS channel health records."
        rows={debugData.recentHealth}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'status', label: 'Status' },
          { key: 'last_error_code', label: 'Error Code' },
          { key: 'last_error_message', label: 'Error Message' },
          { key: 'updated_at', label: 'Updated', render: (value) => formatTimestamp(value) }
        ]}
      />

      <RecentTable
        title="Recent SMS Failovers"
        emptyLabel="No recent SMS failover events."
        rows={debugData.recentFailovers}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'provider_message_id', label: 'Message ID' },
          { key: 'reason', label: 'Reason' },
          { key: 'created_at', label: 'Recorded', render: (value) => formatTimestamp(value) }
        ]}
      />

      <RecentTable
        title="Recent SMS Notification Deliveries"
        emptyLabel="No recent SMS delivery attempts."
        rows={debugData.recentDeliveries}
        columns={[
          { key: 'tenant_key', label: 'Tenant' },
          { key: 'destination', label: 'Destination' },
          { key: 'status', label: 'Status' },
          { key: 'provider_reference', label: 'Message ID' },
          { key: 'last_error_code', label: 'Error Code' },
          { key: 'last_error_message', label: 'Error Message' },
          { key: 'updated_at', label: 'Updated', render: (value) => formatTimestamp(value) }
        ]}
      />
    </section>
  );
}

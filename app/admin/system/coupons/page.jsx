'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../../client/_components/GuidePanel';
import { buildCouponDraft, buildPlanDrafts, formatTimestamp, toneClass } from '../_components/systemShared';

export default function AdminSystemCouponsPage() {
  const [couponStatus, setCouponStatus] = useState({ message: 'Loading coupons...', tone: 'warn' });
  const [billingPlans, setBillingPlans] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [couponDraft, setCouponDraft] = useState(buildCouponDraft());
  const [couponSaving, setCouponSaving] = useState(false);

  const loadConfig = async () => {
    const resp = await fetch('/api/v1/system/config');
    const data = resp.ok ? await resp.json() : null;
    if (data?.config) {
      setBillingPlans(buildPlanDrafts(data.config.billing_plans_json || []));
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

  useEffect(() => {
    loadConfig();
    loadCoupons();
  }, []);

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

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="m-0 text-xl font-semibold text-slate-900">Coupons</h2>
        <p className="mt-1 text-sm text-slate-500">
          Create one-time codes for subscription discounts, overage discounts, and optional no-card trials.
        </p>
      </div>

      <div className={toneClass(couponStatus.tone)}>{couponStatus.message}</div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="block">Code</label>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={couponDraft.code}
              onChange={(event) => setCouponDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
              placeholder="SPRING100"
            />
          </div>
          <div>
            <label className="block">Status</label>
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
            <label className="block">Monthly Discount %</label>
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
            <label className="block">Overage Discount %</label>
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
            <label className="block">Free Trial Days</label>
            <input
              type="number"
              min="0"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={couponDraft.freeTrialDays}
              onChange={(event) => setCouponDraft((current) => ({ ...current, freeTrialDays: event.target.value }))}
            />
          </div>
          <div>
            <label className="block">Discount Duration Days</label>
            <input
              type="number"
              min="0"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={couponDraft.discountDurationDays}
              onChange={(event) => setCouponDraft((current) => ({ ...current, discountDurationDays: event.target.value }))}
            />
          </div>
          <div>
            <label className="block">Redeem By</label>
            <input
              type="datetime-local"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={couponDraft.redeemBy}
              onChange={(event) => setCouponDraft((current) => ({ ...current, redeemBy: event.target.value }))}
            />
          </div>
          <div>
            <label className="block">Applies To Plans</label>
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
          <label className="block">Notes</label>
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                  {coupon.redemption ? (
                    <div>
                      <div>{coupon.redemption.tenantKey}</div>
                      <div className="text-xs text-slate-500">{formatTimestamp(coupon.redemption.redeemedAt)}</div>
                    </div>
                  ) : '—'}
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
    </section>
  );
}

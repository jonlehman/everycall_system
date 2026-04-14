export function toneClass(tone) {
  if (tone === 'bad') return 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900';
  if (tone === 'ok') return 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900';
  if (tone === 'warn') return 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900';
  return 'rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700';
}

export function formatTimestamp(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

export function formatDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function formatMoneyInput(amountCents) {
  const amount = Number(amountCents || 0) / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function parseMoneyInput(value, { allowZero = false } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return allowZero ? 0 : null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100);
  if (rounded < 0) return null;
  if (!allowZero && rounded <= 0) return null;
  return rounded;
}

export function buildCouponDraft(coupon = null) {
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

export function buildPlanDrafts(plans) {
  return (Array.isArray(plans) ? plans : []).map((plan) => ({
    code: String(plan?.code || '').trim(),
    label: String(plan?.label || '').trim(),
    monthlyAmount: formatMoneyInput(plan?.monthlyAmountCents),
    annualAmount: formatMoneyInput(plan?.annualAmountCents),
    includedCalls: String(Number(plan?.includedCallCount ?? plan?.includedCount ?? 0)),
    callOverageRate: formatMoneyInput(plan?.callOverageRateCents ?? plan?.leadRateCents),
    stripeProductId: String(plan?.stripeProductId || plan?.stripe_product_id || '').trim(),
    stripePriceId: String(plan?.stripePriceId || plan?.stripe_price_id || '').trim(),
    stripeAnnualPriceId: String(plan?.stripeAnnualPriceId || plan?.stripe_annual_price_id || '').trim()
  }));
}

export function RuntimeFlag({ label, active }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${active ? 'text-emerald-700' : 'text-red-700'}`}>
        {active ? 'Configured' : 'Missing'}
      </div>
    </div>
  );
}

export function RecentTable({ title, emptyLabel, columns, rows }) {
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

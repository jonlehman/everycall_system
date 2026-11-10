export const DEFAULT_SALES_SIGNUP_AMOUNT_CENTS = 10000;
export const MIN_SALES_SIGNUP_AMOUNT_CENTS = 100;
// Conservative EveryCall application cap, within Stripe's supported USD limits.
export const MAX_SALES_SIGNUP_AMOUNT_CENTS = 99999999;
export function validSalesSignupAmount(value) {
  return Number.isSafeInteger(value) && value >= MIN_SALES_SIGNUP_AMOUNT_CENTS && value <= MAX_SALES_SIGNUP_AMOUNT_CENTS;
}
export function parseSalesSignupDollars(value) {
  const text = String(value || '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [dollars, fraction = ''] = text.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  return validSalesSignupAmount(cents) ? cents : null;
}
export function formatSalesSignupAmount(cents = DEFAULT_SALES_SIGNUP_AMOUNT_CENTS) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

// UPIB-007/008: always calculate from the original anniversary, never the clamped previous month.
export function calendarMonthBoundary(anchor, months) {
  const original = new Date(anchor);
  if (!Number.isFinite(original.getTime()) || !Number.isInteger(months)) throw Error('invalid_billing_anchor');
  const boundary = new Date(original);
  boundary.setUTCDate(1);
  boundary.setUTCMonth(original.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0)).getUTCDate();
  boundary.setUTCDate(Math.min(original.getUTCDate(), lastDay));
  return boundary;
}
export function monthlyUsageWindow(anchor, at = new Date()) {
  const origin = new Date(anchor), now = new Date(at);
  if (now < origin) throw Error('usage_before_payment');
  let index = (now.getUTCFullYear() - origin.getUTCFullYear()) * 12 + now.getUTCMonth() - origin.getUTCMonth();
  if (calendarMonthBoundary(origin, index) > now) index -= 1;
  return { index, start: calendarMonthBoundary(origin, index), end: calendarMonthBoundary(origin, index + 1) };
}

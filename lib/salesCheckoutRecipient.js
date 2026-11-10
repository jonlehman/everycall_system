// Shared formatting only; authorization and destination checks remain server-side.
export function normalizeSalesCheckoutPhone(value) {
  if (typeof value !== 'string' || value.length > 60 || !/^[+\d\s().-]+$/.test(value)) return null;
  let phone = value.replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(phone)) phone = `+1${phone}`;
  else if (/^1\d{10}$/.test(phone)) phone = `+${phone}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

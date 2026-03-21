export function formatPhoneDisplay(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  const localDigits = digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits;

  if (localDigits.length === 10) {
    return `${localDigits.slice(0, 3)}-${localDigits.slice(3, 6)}-${localDigits.slice(6)}`;
  }

  return raw;
}

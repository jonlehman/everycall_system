// Selection labels are independent of the legacy scalar workflow outcome.
export const SALES_DISPOSITIONS = Object.freeze([
  ['voicemail_no_message', 'Reached voicemail — no opportunity to leave message'],
  ['voicemail_left', 'Left voicemail'],
  ['wrong_number', 'Bad number'],
  ['do_not_call', 'DND'],
  ['potential', 'Potential (opportunity but not now)'],
  ['prospect', 'Prospect (interested)'],
  ['customer', 'Customer'],
  ['callback_requested', 'Follow up'],
]);
export const LEGACY_SALES_OUTCOMES = Object.freeze(['no_answer', 'voicemail', 'wrong_number', 'callback_requested', 'not_interested', 'do_not_call', 'connected_no_demo', 'demo_completed', 'signup_link_sent']);
export const SALES_DISPOSITION_KEYS = Object.freeze([...new Set([...SALES_DISPOSITIONS.map(([key]) => key), ...LEGACY_SALES_OUTCOMES])]);
const PRIORITY = ['do_not_call', 'wrong_number', 'not_interested', 'callback_requested', 'customer', 'prospect', 'potential', 'signup_link_sent', 'demo_completed', 'connected_no_demo', 'voicemail_left', 'voicemail_no_message', 'voicemail', 'no_answer'];
export function canonicalSalesOutcome(dispositions = []) {
  const selected = PRIORITY.find(key => dispositions.includes(key));
  if (['customer', 'prospect', 'potential'].includes(selected)) return 'connected_no_demo';
  if (['voicemail_left', 'voicemail_no_message'].includes(selected)) return 'voicemail';
  return selected || '';
}
export function salesDispositionLabel(value) {
  return SALES_DISPOSITIONS.find(([key]) => key === value)?.[1] || String(value || '').replaceAll('_', ' ');
}
export function callDispositions(call) {
  const stored = call?.dispositions || call?.metadata?.dispositions || call?.metadata_json?.dispositions;
  return Array.isArray(stored) ? stored.filter(key => SALES_DISPOSITION_KEYS.includes(key)) : LEGACY_SALES_OUTCOMES.includes(call?.outcome) ? [call.outcome] : [];
}

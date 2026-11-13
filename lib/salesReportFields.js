// This is the report/export contract. Never derive fields from a database row or metadata keys.
export const SALES_REPORT_FIELDS = [
  ['Call', [
    ['id', 'Call ID'], ['prospectId', 'Prospect ID'], ['operatorId', 'Rep ID'], ['operatorName', 'Rep'],
    ['businessName', 'Business (current)'], ['businessCategory', 'Category (current)'], ['websiteUrl', 'Website (current)'],
    ['prospectStatus', 'Prospect status (current)'], ['timezone', 'Prospect timezone (current)'],
    ['state', 'Call state'], ['direction', 'Direction'], ['phoneTestMode', 'Phone test call'],
    ['prospectNumber', 'Prospect number'], ['dialedNumber', 'Dialed number (outbound)'], ['callerNumber', 'Caller number (inbound)'],
  ]],
  ['Called contact · saved at dial time', [
    ['contactId', 'Contact ID'], ['numberId', 'Number ID'], ['contactName', 'Contact name'],
    ['contactFirstName', 'First name'], ['contactLastName', 'Last name'], ['contactTitle', 'Title'],
    ['contactEmail', 'Email'], ['contactDecisionMaker', 'Decision maker'], ['contactInfluencer', 'Influencer'],
    ['numberType', 'Number type'], ['numberLabel', 'Number label'],
  ]],
  ['Results and notes', [
    ['outcome', 'Outcome'], ['dispositions', 'Selected dispositions'], ['outcomeNotes', 'Outcome notes'], ['liveNotes', 'Live notes'],
    ['aiState', 'AI state'], ['providerErrorCode', 'Provider error code'],
    ['hasTranscript', 'Transcript stored'], ['hasRecording', 'Recording stored'],
  ]],
  ['Timing · UTC', [
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['startedAt', 'Started'], ['connectedAt', 'Connected'],
    ['demoStartedAt', 'Demo started'], ['demoEndedAt', 'Demo ended'], ['endedAt', 'Ended'],
    ['outcomeRecordedAt', 'Outcome saved'], ['callbackAt', 'Callback scheduled'], ['linkSentAt', 'Link sent'],
    ['bookedAt', 'Setup booked'], ['paidAt', 'Paid timestamp'],
    ['sessionSeconds', 'Session duration (seconds)'], ['connectedSeconds', 'Connected duration (seconds)'], ['demoSeconds', 'Demo duration (seconds)'],
  ]],
  ['Operational identifiers', [
    ['conferenceId', 'Conference ID'], ['operatorLegId', 'Operator leg ID'], ['operatorSessionId', 'Operator session ID'],
    ['prospectLegId', 'Prospect leg ID'], ['prospectSessionId', 'Prospect session ID'],
    ['aiTelnyxLegId', 'AI leg ID'], ['aiTelnyxSessionId', 'AI session ID'], ['openaiCallId', 'OpenAI call ID'],
  ]],
];
export const SALES_REPORT_EXPORT_LIMIT = 2000;

export function salesReportCsv(rows) {
  const fields = SALES_REPORT_FIELDS.flatMap(([, values]) => values);
  const cell = (value) => {
    let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString()
      : Array.isArray(value) ? value.join('; ') : String(value);
    // Neutralize spreadsheet formulas, including values hidden behind whitespace/control characters.
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [fields.map(([, label]) => cell(label)).join(','),
    ...rows.map(row => fields.map(([key]) => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}

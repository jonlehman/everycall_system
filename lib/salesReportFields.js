// Explicit provider facts plus exact-identity EveryCall label enrichment. No arbitrary payloads.
export const SALES_REPORT_FIELDS = [
  ['Telnyx call record', [
    ['id', 'Telnyx record ID'], ['providerLegId', 'Telnyx leg ID'], ['providerSessionId', 'Telnyx session ID'],
    ['providerConnectionId', 'Telnyx connection ID'], ['connectionName', 'Telnyx connection name'],
    ['direction', 'Telnyx direction'], ['status', 'Status derived from Telnyx flags'],
    ['attempted', 'Telnyx attempted'], ['connected', 'Telnyx connected'], ['completed', 'Telnyx completed'],
    ['callerNumber', 'Telnyx caller number'], ['destinationNumber', 'Telnyx destination number'], ['callerName', 'Telnyx caller name'],
    ['countryCode', 'Telnyx country code'], ['sourceCountryCode', 'Telnyx source country code'],
  ]],
  ['Provider timing · displayed Pacific; CSV preserves UTC', [
    ['startedAt', 'Telnyx started (UTC)'], ['endedAt', 'Telnyx finished (UTC)'],
    ['elapsedSeconds', 'Provider start-to-finish elapsed seconds'], ['callSeconds', 'Telnyx call_sec'], ['billedSeconds', 'Telnyx billed_sec'],
  ]],
  ['EveryCall labels · exact provider identity match', [
    ['operatorId', 'EveryCall rep ID'], ['operatorName', 'EveryCall rep label (current)'],
    ['businessName', 'EveryCall business label (current)'], ['salesCallId', 'Matched EveryCall session ID'],
    ['matchMethod', 'Identity match method'], ['classification', 'Identity classification'], ['relatedLeg', 'Multiple records in provider session'],
  ]],
  ['Source and retrieval', [
    ['source', 'Source'], ['retrievedAt', 'Provider retrieved (UTC)'], ['snapshot', 'Report dataset fingerprint'],
    ['coverageNotice', 'Provider coverage limitation'],
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

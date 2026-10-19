'use client';
import { useMemo, useState } from 'react';
import { FIELD_DEFINITIONS, guessMappings, parseCsv, validateMappedRows } from './csvImport';
import { fetchSalesJson, normalizeImportResult } from './salesApi';
import { Card, Field, Detail, ActionButton, ErrorNotice } from './SalesUi';

export default function CsvImportPanel({ onImported, missingTimezonePolicy = 'block' }) {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mappings, setMappings] = useState({});
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const validation = useMemo(
    () => parsed
      ? validateMappedRows(parsed.rows, mappings, { missingTimezonePolicy })
      : null,
    [parsed, mappings, missingTimezonePolicy]
  );

  const readFile = async (event) => {
    const file = event.target.files?.[0];
    setResult(null);
    setParseError('');
    setParsed(null);
    setMappings({});
    setFileName(file?.name || '');
    if (!file) return;
    try {
      const nextParsed = parseCsv(await file.text());
      setParsed(nextParsed);
      setMappings(guessMappings(nextParsed.headers));
    } catch (error) {
      setParseError(error?.message || 'Could not read this CSV.');
    }
  };

  const updateMapping = (fieldKey, header) => {
    setMappings((current) => {
      const next = { ...current, [fieldKey]: header };
      if (header) {
        Object.keys(next).forEach((otherKey) => {
          if (otherKey !== fieldKey && next[otherKey] === header) next[otherKey] = '';
        });
      }
      return next;
    });
  };

  const importRecords = async () => {
    if (!validation?.validRecords.length || validation.errors.length) return;
    setBusy(true);
    setResult(null);
    try {
      const payload = await fetchSalesJson('/api/v1/admin/sales/prospects/import', {
        method: 'POST',
        body: JSON.stringify({ records: validation.validRecords })
      });
      const nextResult = normalizeImportResult(payload);
      setResult({ ...nextResult, error: '' });
      await onImported?.();
    } catch (error) {
      setResult({
        imported: 0,
        skipped: 0,
        errors: [],
        error: error?.message || 'CSV import failed.'
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <details open>
        <summary className="cursor-pointer list-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-base font-semibold text-slate-950">Import prospects</h2>
              <p className="mt-1 text-sm text-slate-500">Upload, map, and validate a CSV before creating queue records.</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              {fileName || 'CSV'}
            </span>
          </div>
        </summary>

        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4">
          <Field
            label="CSV or TSV file"
            hint={`Comma-separated CSV and tab-separated spreadsheet exports are accepted. Required: business name, phone, explicit yes/no permission${missingTimezonePolicy === 'block' ? ', and an IANA timezone' : ''}.`}
          >
            <div className="grid gap-2">
              <input
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={readFile}
                className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-800 hover:file:bg-slate-200"
              />
              <a
                href="/samples/sales-prospects-demo.csv"
                download="everycall-sales-prospects-demo.csv"
                className="w-fit text-sm font-semibold text-[#004ac6] underline decoration-[#004ac6]/40 underline-offset-2 hover:decoration-[#004ac6] focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6]"
              >
                Download example CSV (4 fictional prospects, one per mainland U.S. time zone)
              </a>
            </div>
          </Field>

          <ErrorNotice title="CSV could not be read" message={parseError} />

          {parsed ? (
            <>
              <div>
                <h3 className="m-0 text-sm font-semibold text-slate-900">Column mapping</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {FIELD_DEFINITIONS.map((field) => {
                    const fieldRequired = field.required
                      || (field.key === 'timezone' && missingTimezonePolicy === 'block');
                    return (
                      <Field key={field.key} label={`${field.label}${fieldRequired ? ' *' : ''}`}>
                        <select
                          value={mappings[field.key] || ''}
                          onChange={(event) => updateMapping(field.key, event.target.value)}
                          className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15"
                        >
                          <option value="">Not mapped</option>
                          {parsed.headers.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </Field>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-live="polite">
                <Detail label="CSV rows" value={validation?.total ?? 0} />
                <Detail label="Valid records" value={validation?.validRecords.length ?? 0} />
                <Detail label="Needs correction" value={validation?.errors.length ?? 0} />
                <Detail label="Permission: No" value={validation?.permissionDenied ?? 0} />
                <Detail label="Suppressed" value={validation?.suppressed ?? 0} />
              </div>

              {validation?.errors.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-semibold">Resolve these items before importing</div>
                  <ul className="mt-2 max-h-36 list-disc space-y-1 overflow-y-auto pl-5">
                    {validation.errors.slice(0, 20).map((error, index) => (
                      <li key={`${error.rowNumber || 'mapping'}-${index}`}>
                        {error.rowNumber ? `Row ${error.rowNumber}: ` : ''}{error.message}
                      </li>
                    ))}
                  </ul>
                  {validation.errors.length > 20 ? (
                    <div className="mt-2 text-xs">Showing the first 20 of {validation.errors.length} issues.</div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <ActionButton
                  onClick={importRecords}
                  disabled={busy || !validation?.validRecords.length || Boolean(validation?.errors.length)}
                  title={validation?.errors.length ? 'Correct every validation issue before importing.' : ''}
                >
                  {busy ? 'Importing…' : `Import ${validation?.validRecords.length || 0} records`}
                </ActionButton>
                <span className="text-xs text-slate-500">
                  Permission-denied and suppressed rows are retained for suppression, but cannot be called.
                </span>
              </div>
            </>
          ) : null}

          {result ? (
            result.error ? (
              <ErrorNotice title="Import failed" message={result.error} />
            ) : (
              <div
                className={`rounded-xl border p-3 text-sm ${result.errors.length || result.skipped
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
                role="status"
              >
                Processed {result.imported}: {result.inserted} new, {result.updated} updated; {result.skipped} rejected.
                {result.errors.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {result.errors.slice(0, 20).map((error, index) => (
                      <li key={`${error?.rowNumber || 'server'}-${index}`}>
                        {error?.rowNumber ? `Row ${error.rowNumber}: ` : ''}
                        {error?.message || error?.code || 'The row was rejected.'}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </details>
    </Card>
  );
}

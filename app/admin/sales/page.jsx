'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  displayStatus,
  fetchSalesJson,
  isDemoReady,
  normalizeCall,
  normalizeImportResult,
  normalizeInvitation,
  normalizeQueue,
  normalizeWebrtc
} from './salesApi';
import {
  FIELD_DEFINITIONS,
  guessMappings,
  parseCsv,
  validateMappedRows
} from './csvImport';
import { connectTelnyxBrowserClient } from './telnyxBrowserClient';
import ProspectsManager from './ProspectsManager';

const OUTCOMES = [
  ['no_answer', 'No answer'],
  ['voicemail', 'Voicemail'],
  ['wrong_number', 'Wrong number'],
  ['callback_requested', 'Callback requested'],
  ['not_interested', 'Not interested'],
  ['do_not_call', 'Do not call'],
  ['connected_no_demo', 'Connected, no demo'],
  ['demo_completed', 'Demo completed'],
  ['signup_link_sent', 'Signup link sent'],
  ['signup_completed', 'Signup completed']
];

const SIGNUP_STEPS = [
  { key: 'sent', label: 'Link sent' },
  { key: 'opened', label: 'Opened' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'provisioning', label: 'Number provisioning' },
  { key: 'ready', label: 'Account ready' }
];

function Card({ children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function StatusPill({ status, tone }) {
  const normalized = String(status || '').toLowerCase();
  let colors = 'border-slate-200 bg-slate-50 text-slate-700';
  if (tone === 'good' || ['ready', 'demo_ready', 'connected', 'completed', 'account_ready'].includes(normalized)) {
    colors = 'border-emerald-200 bg-emerald-50 text-emerald-800';
  } else if (tone === 'bad' || ['failed', 'error', 'blocked', 'suppressed', 'attention_required'].includes(normalized)) {
    colors = 'border-red-200 bg-red-50 text-red-700';
  } else if (tone === 'warn' || ['preparing', 'queued', 'pending', 'dialing'].includes(normalized)) {
    colors = 'border-amber-200 bg-amber-50 text-amber-800';
  } else if (tone === 'blue' || ['live', 'ai_live', 'prospect_connected'].includes(normalized)) {
    colors = 'border-blue-200 bg-blue-50 text-blue-800';
  }
  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${colors}`}>
      <span className="truncate">{displayStatus(status)}</span>
    </span>
  );
}

function ActionButton({
  children,
  disabled = false,
  onClick,
  tone = 'primary',
  title,
  type = 'button',
  className = ''
}) {
  const tones = {
    primary: 'border-[#004ac6] bg-[#004ac6] text-white hover:bg-[#003fa8]',
    secondary: 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
    danger: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
    amber: 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={`min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15 disabled:bg-slate-100 ${props.className || ''}`}
    />
  );
}

function ErrorNotice({ title = 'Action failed', message }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 break-words">{message}</div>
    </div>
  );
}

function Detail({ label, value, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{children || value || '—'}</div>
    </div>
  );
}

function demoStatusTone(status) {
  if (['ready', 'demo_ready', 'ready_to_call'].includes(status)) return 'good';
  if (['failed', 'build_failed', 'error'].includes(status)) return 'bad';
  return 'warn';
}

function permissionLabel(prospect) {
  if (prospect?.permission === true) return 'Permission: Yes';
  if (prospect?.permission === false) return 'Permission: No';
  return 'Permission: Unknown';
}

function callDisableReason({ prospect, call, busy, softphoneState }) {
  if (busy) return 'Another action is still in progress.';
  if (!prospect) return 'There is no current prospect.';
  if (!prospect.eligible) {
    return prospect.callBlockedReason
      || prospect.suppressionReason
      || 'This prospect is not eligible to call.';
  }
  if (!isDemoReady(prospect)) return 'The company demo must be ready before calling.';
  if (softphoneState !== 'ready') return 'The Telnyx browser softphone must be ready before calling.';
  if (call?.id && !call.terminal) return 'A call is already active.';
  return '';
}

function startDemoDisableReason({ call, busy }) {
  if (busy) return 'Another action is still in progress.';
  if (!call?.id || call.terminal) return 'Start a call first.';
  if (!call.prospectConnected) return 'The prospect must be connected.';
  if (!call.aiReady) return 'The AI standby leg is not ready.';
  if (call.aiLive) return 'The AI demo is already in the conference.';
  return '';
}

function invitationProgress(invitation) {
  if (!invitation?.id) return -1;
  const status = invitation.status;
  const delivery = invitation.deliveryStatus;
  if (['account_ready', 'ready', 'completed', 'signup_completed'].includes(status)
    || ['account_ready', 'ready'].includes(invitation.accountStatus)) return 4;
  if (['provisioning', 'number_provisioning'].includes(status)
    || ['provisioning', 'running', 'pending', 'failed'].includes(invitation.provisioningStatus)
    || invitation.attentionRequired) return 3;
  if (['submitted', 'intake_submitted'].includes(status) || invitation.submittedAt) return 2;
  if (['opened', 'viewed'].includes(status) || invitation.openedAt) return 1;
  if (['sent', 'delivered'].includes(status) || ['sent', 'delivered'].includes(delivery) || invitation.sentAt) return 0;
  return -1;
}

function CsvImportPanel({ onImported, missingTimezonePolicy = 'block' }) {
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
      <details>
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

function QueuePanel({
  queue,
  loading,
  error,
  warmBusy,
  onRefresh,
  onWarm,
  onPrepare,
  onSkip,
  prepareBusyId,
  skipBusyId
}) {
  return (
    <Card className="h-fit xl:sticky xl:top-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-950">Calling queue</h2>
          <p className="mt-1 text-xs text-slate-500">Current prospect plus the next 10 demos (11 total).</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <ErrorNotice title="Queue unavailable" message={error} />

      <div className="mt-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Current</div>
        {!queue.current ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No callable prospects are queued.
          </div>
        ) : (
          <div className="rounded-xl border border-[#004ac6]/25 bg-[#eff4ff] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">{queue.current.businessName || 'Unnamed business'}</div>
                <div className="mt-1 truncate text-xs text-slate-600">{queue.current.contactName || queue.current.phone || 'No contact name'}</div>
              </div>
              <StatusPill status={queue.current.demoStatus} tone={demoStatusTone(queue.current.demoStatus)} />
            </div>
            {!isDemoReady(queue.current) && queue.current.preparationEligible ? (
              <ActionButton
                className="mt-3 w-full"
                tone="secondary"
                disabled={prepareBusyId === queue.current.id}
                onClick={() => onPrepare(queue.current)}
              >
                {prepareBusyId === queue.current.id ? 'Preparing…' : 'Prepare demo'}
              </ActionButton>
            ) : null}
            {(queue.current.demoStatus === 'failed' || queue.current.demoFailure || !queue.current.website) ? (
              <ActionButton
                className="mt-2 w-full"
                tone="secondary"
                disabled={skipBusyId === queue.current.id}
                onClick={() => onSkip(queue.current)}
              >
                {skipBusyId === queue.current.id ? 'Skipping…' : 'Skip unusable demo'}
              </ActionButton>
            ) : null}
            {queue.current.demoFailure ? (
              <div className="mt-2 break-words text-xs text-red-700">{queue.current.demoFailure}</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Upcoming</div>
        <ol className="space-y-2">
          {queue.upcoming.map((prospect, index) => (
            <li key={prospect.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{prospect.businessName || 'Unnamed business'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusPill status={prospect.demoStatus} tone={demoStatusTone(prospect.demoStatus)} />
                    {!prospect.eligible ? <StatusPill status="Blocked" tone="bad" /> : null}
                  </div>
                  {prospect.demoFailure ? (
                    <div className="mt-2 line-clamp-2 text-xs text-red-700">{prospect.demoFailure}</div>
                  ) : null}
                </div>
                <div className="grid shrink-0 gap-1 text-right">
                  {!isDemoReady(prospect) && prospect.preparationEligible ? (
                    <button
                      type="button"
                      onClick={() => onPrepare(prospect)}
                      disabled={prepareBusyId === prospect.id}
                      className="text-xs font-semibold text-[#004ac6] hover:underline disabled:text-slate-400"
                    >
                      {prepareBusyId === prospect.id ? 'Working…' : prospect.demoFailure ? 'Retry' : 'Prepare'}
                    </button>
                  ) : null}
                  {(prospect.demoStatus === 'failed' || prospect.demoFailure || !prospect.website) ? (
                    <button
                      type="button"
                      onClick={() => onSkip(prospect)}
                      disabled={skipBusyId === prospect.id}
                      className="text-xs font-semibold text-slate-600 hover:underline disabled:text-slate-400"
                    >
                      {skipBusyId === prospect.id ? 'Skipping…' : 'Skip'}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        {!queue.upcoming.length ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
            No upcoming prospects.
          </div>
        ) : null}
      </div>

      <ActionButton className="mt-4 w-full" tone="secondary" onClick={onWarm} disabled={warmBusy || loading}>
        {warmBusy ? 'Warming demos…' : 'Replenish warm queue'}
      </ActionButton>
    </Card>
  );
}

function ProspectPanel({ prospect }) {
  if (!prospect) {
    return (
      <Card>
        <h2 className="m-0 text-base font-semibold text-slate-950">Prospect</h2>
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          Import prospects or refresh the queue to begin.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 break-words text-xl font-semibold text-slate-950">{prospect.businessName || 'Unnamed business'}</h2>
          <p className="mt-1 text-sm text-slate-500">{prospect.contactName || 'No contact name supplied'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={prospect.demoStatus} tone={demoStatusTone(prospect.demoStatus)} />
          <StatusPill
            status={permissionLabel(prospect)}
            tone={prospect.permission === true ? 'good' : 'bad'}
          />
          {prospect.suppressed ? <StatusPill status="Suppressed" tone="bad" /> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
        <Detail label="Phone" value={prospect.phone} />
        <Detail label="Local time" value={prospect.localTime || prospect.timezone} />
        <Detail label="Category" value={prospect.businessCategory} />
        <Detail
          label="Prior activity"
          value={prospect.outcome
            ? `${displayStatus(prospect.outcome)}${prospect.lastOutcomeAt
              ? ` · ${new Date(prospect.lastOutcomeAt).toLocaleString()}`
              : ''}`
            : 'No prior call outcome'}
        />
        <Detail label="Contact email" value={prospect.email} />
        <Detail label="Lead-delivery email" value={prospect.leadDeliveryEmail} />
        <Detail label="Website">
          {prospect.website ? (
            <a
              href={prospect.website}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[#004ac6] underline decoration-[#004ac6]/30 underline-offset-2"
            >
              {prospect.website}
            </a>
          ) : '—'}
        </Detail>
      </div>

      {prospect.callBlockedReason ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">Calling blocked: </span>{prospect.callBlockedReason}
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="m-0 text-sm font-semibold text-slate-900">Website-derived talking points</h3>
        {prospect.talkingPoints.length ? (
          <ul className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {prospect.talkingPoints.map((point, index) => (
              <li key={`${point}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                {point}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No talking points are available yet.</p>
        )}
      </div>
    </Card>
  );
}

function CallPanel({
  prospect,
  call,
  busyAction,
  microphoneState,
  softphoneState,
  softphoneError,
  browserCallState,
  remoteAudioRef,
  onCall,
  onAction,
  onReconnect
}) {
  const callBlocked = callDisableReason({
    prospect,
    call,
    busy: Boolean(busyAction),
    softphoneState
  });
  const demoBlocked = startDemoDisableReason({ call, busy: Boolean(busyAction) });
  const providerError = call?.providerError;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-950">Browser call</h2>
          <p className="mt-1 text-sm text-slate-500">You stay live and unmuted while the receptionist demonstrates the call.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={call?.state || 'Not started'} tone={call?.prospectConnected ? 'blue' : undefined} />
          <StatusPill status={`AI: ${displayStatus(call?.aiState || 'Not started')}`} tone={call?.aiReady ? 'good' : 'warn'} />
        </div>
      </div>

      <audio
        id="sales-console-remote-audio"
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="hidden"
        aria-label="Remote call audio"
      />

      <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
        <Detail label="Browser softphone" value={displayStatus(softphoneState)} />
        <Detail label="Microphone" value={displayStatus(microphoneState)} />
        <Detail label="Browser call" value={displayStatus(browserCallState)} />
        <Detail label="Prospect leg" value={call?.prospectConnected ? 'Connected' : displayStatus(call?.state || 'Not started')} />
        <Detail label="AI standby" value={call?.aiReady ? 'Ready' : displayStatus(call?.aiState || 'Not started')} />
      </div>

      <ErrorNotice title="Browser calling error" message={softphoneError} />
      <ErrorNotice title="Provider error" message={providerError} />

      {softphoneState === 'error' || softphoneState === 'disconnected' ? (
        <div className="mt-3">
          <ActionButton tone="secondary" onClick={onReconnect} disabled={Boolean(busyAction)}>
            Reconnect browser calling
          </ActionButton>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          onClick={onCall}
          disabled={Boolean(callBlocked)}
          title={callBlocked}
        >
          {busyAction === 'call' ? 'Calling…' : 'Call'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('start_demo')}
          disabled={Boolean(demoBlocked)}
          title={demoBlocked}
          tone="amber"
        >
          {busyAction === 'start_demo' ? 'Starting…' : 'Start Demo'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('pause_ai')}
          disabled={Boolean(busyAction) || !call?.aiLive || call?.aiPaused || call?.terminal}
          title={!call?.aiLive ? 'The AI must be live before it can be paused.' : ''}
          tone="secondary"
        >
          {busyAction === 'pause_ai' ? 'Pausing…' : 'Pause AI'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('end_demo')}
          disabled={Boolean(busyAction) || !call?.aiLive || call?.terminal}
          title={!call?.aiLive ? 'The AI has not joined this call.' : ''}
          tone="secondary"
        >
          {busyAction === 'end_demo' ? 'Ending demo…' : 'End Demo'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('end_call')}
          disabled={Boolean(busyAction) || !call?.id || call?.terminal}
          title={!call?.id || call?.terminal ? 'There is no active call to end.' : ''}
          tone="danger"
        >
          {busyAction === 'end_call' ? 'Ending call…' : 'End Call'}
        </ActionButton>
      </div>

      {callBlocked && prospect ? (
        <p className="mt-3 text-xs text-slate-500">Call unavailable: {callBlocked}</p>
      ) : null}
      {demoBlocked && call?.id && !call?.aiLive ? (
        <p className="mt-1 text-xs text-slate-500">Start Demo unavailable: {demoBlocked}</p>
      ) : null}

      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <span className="font-semibold">Live operator audio stays on.</span> There is intentionally no mute-on-demo control.
      </div>
    </Card>
  );
}

function ConversionPanel({
  prospect,
  call,
  invitation,
  busyAction,
  setupOpen,
  setSetupOpen,
  contactFields,
  setContactFields,
  outcome,
  setOutcome,
  note,
  setNote,
  onSendInvitation,
  onSaveOutcome
}) {
  const progress = invitationProgress(invitation);
  const signupStatus = invitation?.attentionRequired
    ? 'attention_required'
    : invitation?.accountStatus === 'account_ready'
      ? 'account_ready'
      : invitation?.provisioningStatus || invitation?.status;
  const canStartSetup = Boolean(prospect?.id && call?.id && call.prospectConnected && !call.terminal);
  const canSend = canStartSetup
    && Boolean(contactFields.email.trim())
    && Boolean(contactFields.leadDeliveryEmail.trim());
  const outcomeBlocked = Boolean(outcome) && (!call?.id || !call.terminal);

  return (
    <Card className="h-fit">
      <h2 className="m-0 text-base font-semibold text-slate-950">Conversion</h2>
      <p className="mt-1 text-sm text-slate-500">Guide setup, then record the human call outcome.</p>

      <div className="mt-4">
        <ActionButton
          className="w-full"
          tone="secondary"
          onClick={() => setSetupOpen((current) => !current)}
          disabled={!canStartSetup && !setupOpen}
          title={!canStartSetup ? 'Connect the prospect before starting assisted setup.' : ''}
        >
          {setupOpen ? 'Hide setup' : 'Start Setup'}
        </ActionButton>
      </div>

      {setupOpen ? (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
          <Field label="Confirmed contact name">
            <TextInput
              value={contactFields.contactName}
              onChange={(event) => setContactFields((current) => ({ ...current, contactName: event.target.value }))}
              autoComplete="name"
            />
          </Field>
          <Field label="Confirmed login email">
            <TextInput
              type="email"
              value={contactFields.email}
              onChange={(event) => setContactFields((current) => ({ ...current, email: event.target.value }))}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Confirmed lead-delivery email">
            <TextInput
              type="email"
              value={contactFields.leadDeliveryEmail}
              onChange={(event) => setContactFields((current) => ({ ...current, leadDeliveryEmail: event.target.value }))}
              autoComplete="email"
              required
            />
          </Field>
          <ActionButton
            className="w-full"
            onClick={onSendInvitation}
            disabled={Boolean(busyAction) || !canSend}
            title={!canSend ? 'Confirm both email addresses while the prospect is connected.' : ''}
          >
            {busyAction === 'invitation' ? 'Sending…' : 'Send Signup Link'}
          </ActionButton>
          <p className="m-0 text-xs text-slate-500">
            The prospect reviews the prefilled intake, creates their own password, and accepts the required terms.
          </p>
        </div>
      ) : null}

      {invitation?.id ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">Signup progress</div>
            <StatusPill
              status={signupStatus}
              tone={invitation.attentionRequired ? 'bad' : progress >= 0 ? 'blue' : 'warn'}
            />
          </div>
          <ol className="mt-3 grid gap-2">
            {SIGNUP_STEPS.map((step, index) => {
              const reached = index <= progress;
              const current = index === progress;
              return (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${reached ? 'bg-[#004ac6]' : 'bg-slate-300'} ${current ? 'ring-4 ring-blue-100' : ''}`}
                  />
                  <span className={reached ? 'font-semibold text-slate-900' : 'text-slate-500'}>{step.label}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 text-xs text-slate-500">
            Delivery: {displayStatus(invitation.deliveryStatus)}
            {invitation.expiresAt ? ` · Expires ${new Date(invitation.expiresAt).toLocaleString()}` : ''}
            {invitation.provisionedNumber ? ` · Number ${invitation.provisionedNumber}` : ''}
          </div>
          {invitation.attentionRequired ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {invitation.provisioningErrorMessage
                || invitation.provisioningStatusDetail
                || 'Number setup needs attention.'}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4">
        <Field label="Call outcome">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15"
          >
            <option value="">Select an outcome</option>
            {OUTCOMES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Note">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Add concise follow-up context."
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15"
          />
        </Field>
        <ActionButton
          className="w-full"
          tone="secondary"
          onClick={onSaveOutcome}
          disabled={Boolean(busyAction) || !prospect?.id || (!outcome && !note.trim()) || outcomeBlocked}
          title={outcomeBlocked ? 'End the live call before recording its outcome.' : ''}
        >
          {busyAction === 'outcome' ? 'Saving…' : 'Save Outcome & Note'}
        </ActionButton>
      </div>
    </Card>
  );
}

export default function AdminSalesConsolePage() {
  const [activeTab, setActiveTab] = useState('calling');
  const [queue, setQueue] = useState({
    current: null,
    prospects: [],
    upcoming: [],
    currentProspectId: '',
    warmQueueSize: 11,
    missingTimezonePolicy: 'block'
  });
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [warmBusy, setWarmBusy] = useState(false);
  const [prepareBusyId, setPrepareBusyId] = useState('');
  const [skipBusyId, setSkipBusyId] = useState('');
  const [call, setCall] = useState(null);
  const [invitation, setInvitation] = useState(null);
  const [busyAction, setBusyAction] = useState('');
  const [operationError, setOperationError] = useState('');
  const [callRefreshError, setCallRefreshError] = useState('');
  const [microphoneState, setMicrophoneState] = useState('Not requested');
  const [softphoneState, setSoftphoneState] = useState('Loading token');
  const [softphoneError, setSoftphoneError] = useState('');
  const [browserCallState, setBrowserCallState] = useState('Not started');
  const [setupOpen, setSetupOpen] = useState(false);
  const [contactFields, setContactFields] = useState({
    contactName: '',
    email: '',
    leadDeliveryEmail: ''
  });
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const remoteAudioRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const softphoneRef = useRef(null);
  const browserCallRef = useRef(null);
  const softphoneGenerationRef = useRef(0);
  const lastTerminalCallRef = useRef('');
  const callCreateAttemptRef = useRef({ prospectId: '', idempotencyKey: '' });
  const noteCreateAttemptRef = useRef({
    prospectId: '',
    salesCallId: '',
    body: '',
    idempotencyKey: ''
  });

  const releaseMicrophone = useCallback(() => {
    microphoneStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    setMicrophoneState('Released');
  }, []);

  const loadQueue = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setQueueLoading(true);
    setQueueError('');
    try {
      const payload = await fetchSalesJson('/api/v1/admin/sales/queue');
      const nextQueue = normalizeQueue(payload);
      setQueue(nextQueue);
      return nextQueue;
    } catch (error) {
      setQueueError(error?.message || 'Could not load the sales queue.');
      return null;
    } finally {
      if (!quiet) setQueueLoading(false);
    }
  }, []);

  const warmQueue = useCallback(async ({ quiet = false, currentProspectId = '' } = {}) => {
    if (!quiet) setWarmBusy(true);
    try {
      await fetchSalesJson('/api/v1/admin/sales/queue/warm', {
        method: 'POST',
        body: JSON.stringify({
          currentProspectId: currentProspectId || undefined,
          size: 11
        })
      });
      await loadQueue({ quiet: true });
    } catch (error) {
      if (!quiet) setQueueError(error?.message || 'Could not replenish the warm queue.');
    } finally {
      if (!quiet) setWarmBusy(false);
    }
  }, [loadQueue]);

  useEffect(() => {
    let active = true;
    (async () => {
      const loadedQueue = await loadQueue();
      if (active && loadedQueue) {
        await warmQueue({
          quiet: true,
          currentProspectId: loadedQueue.currentProspectId
        });
      }
    })();
    return () => { active = false; };
  }, [loadQueue, warmQueue]);

  useEffect(() => {
    const hasPendingDemo = queue.prospects.some((prospect) => (
      ['not_prepared', 'queued', 'preparing', 'building', 'stale'].includes(prospect.demoStatus)
    ));
    if (!hasPendingDemo) return undefined;
    const interval = window.setInterval(() => { void loadQueue({ quiet: true }); }, 3000);
    return () => window.clearInterval(interval);
  }, [queue.prospects, loadQueue]);

  useEffect(() => {
    const prospect = queue.current;
    setContactFields({
      contactName: prospect?.contactName || '',
      email: prospect?.email || '',
      leadDeliveryEmail: prospect?.leadDeliveryEmail || prospect?.email || ''
    });
    setOutcome(prospect?.outcome || '');
    setNote(prospect?.note || '');
    setSetupOpen(false);
    setInvitation(null);
    noteCreateAttemptRef.current = {
      prospectId: '',
      salesCallId: '',
      body: '',
      idempotencyKey: ''
    };
    setCall((current) => (
      current?.prospectId && current.prospectId !== prospect?.id ? null : current
    ));
  }, [queue.current?.id]);

  const initializeSoftphone = useCallback(async () => {
    const generation = softphoneGenerationRef.current + 1;
    softphoneGenerationRef.current = generation;
    setSoftphoneState('Loading token');
    setSoftphoneError('');
    const previous = softphoneRef.current;
    softphoneRef.current = null;
    browserCallRef.current = null;
    if (previous) await previous.disconnect();

    try {
      const payload = await fetchSalesJson('/api/v1/admin/sales/webrtc-token');
      const config = normalizeWebrtc(payload);
      if (!config.token) throw new Error('The server did not provide a Telnyx WebRTC token.');
      if (generation !== softphoneGenerationRef.current) return;
      const client = await connectTelnyxBrowserClient({
        token: config.token,
        remoteElement: remoteAudioRef.current,
        onState: (state) => {
          if (generation === softphoneGenerationRef.current) setSoftphoneState(state);
        },
        onError: (message) => {
          if (generation !== softphoneGenerationRef.current) return;
          setSoftphoneError(message);
          if (browserCallRef.current) setBrowserCallState('Error');
        },
        onCallUpdate: (update) => {
          if (generation !== softphoneGenerationRef.current) return;
          browserCallRef.current = update.call || browserCallRef.current;
          setBrowserCallState(update.state || 'unknown');
          if (update.cause && !['normal_clearing', 'originator_cancel'].includes(update.cause.toLowerCase())) {
            setSoftphoneError(`${update.cause}${update.causeCode ? ` (${update.causeCode})` : ''}`);
          }
          if (['destroy', 'hangup', 'purge', 'ended'].includes(update.state)) {
            releaseMicrophone();
          }
        }
      });
      if (generation !== softphoneGenerationRef.current) {
        await client.disconnect();
        return;
      }
      softphoneRef.current = client;
      setSoftphoneState('ready');
    } catch (error) {
      if (generation !== softphoneGenerationRef.current) return;
      setSoftphoneState('error');
      setSoftphoneError(error?.message || 'Telnyx browser calling could not connect.');
    }
  }, [releaseMicrophone]);

  useEffect(() => {
    void initializeSoftphone();
    return () => {
      softphoneGenerationRef.current += 1;
      const client = softphoneRef.current;
      softphoneRef.current = null;
      if (client) void client.disconnect();
    };
  }, [initializeSoftphone]);

  const pollCall = useCallback(async () => {
    if (!call?.id) return;
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(call.id)}`);
      const nextCall = normalizeCall(payload);
      setCallRefreshError('');
      setCall(nextCall);
      if (nextCall.signup) setInvitation(normalizeInvitation(nextCall.signup));
      if (nextCall.terminal && lastTerminalCallRef.current !== nextCall.id) {
        lastTerminalCallRef.current = nextCall.id;
        await loadQueue({ quiet: true });
      }
    } catch (error) {
      setCallRefreshError(error?.message || 'Could not refresh the call state.');
    }
  }, [call?.id, loadQueue]);

  useEffect(() => {
    if (!call?.id) return undefined;
    const invitationComplete = invitation && (
      ['account_ready', 'ready', 'completed', 'expired', 'failed', 'revoked'].includes(invitation.status)
      || ['account_ready', 'ready', 'attention_required'].includes(invitation.accountStatus)
    );
    if (call.terminal && (!invitation || invitationComplete)) return undefined;
    const interval = window.setInterval(() => { void pollCall(); }, call.terminal ? 3000 : 1500);
    return () => window.clearInterval(interval);
  }, [call?.id, call?.terminal, invitation?.id, invitation?.status, invitation?.accountStatus, pollCall]);

  useEffect(() => () => {
    microphoneStreamRef.current?.getTracks?.().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!call?.terminal) return;
    if (softphoneRef.current) void softphoneRef.current.hangup();
    browserCallRef.current = null;
    releaseMicrophone();
  }, [call?.terminal, releaseMicrophone]);

  const prepareProspect = async (prospect) => {
    if (!prospect?.id) return;
    setPrepareBusyId(prospect.id);
    setOperationError('');
    try {
      await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/demo`, {
        method: 'POST',
        body: JSON.stringify({ force: Boolean(prospect.demoFailure) })
      });
      await loadQueue({ quiet: true });
    } catch (error) {
      setOperationError(error?.message || 'Could not prepare this demo.');
    } finally {
      setPrepareBusyId('');
    }
  };

  const skipProspect = async (prospect) => {
    if (!prospect?.id) return;
    setSkipBusyId(prospect.id);
    setOperationError('');
    try {
      await fetchSalesJson(
        `/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/skip`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: prospect.demoFailure || 'Demo is unusable for this calling session.'
          })
        }
      );
      await loadQueue({ quiet: true });
    } catch (error) {
      setOperationError(error?.message || 'Could not skip this prospect.');
    } finally {
      setSkipBusyId('');
    }
  };

  const ensureMicrophone = async () => {
    if (microphoneStreamRef.current?.active) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not provide microphone access.');
    }
    setMicrophoneState('Requesting permission');
    try {
      microphoneStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      setMicrophoneState('Permission granted');
    } catch (error) {
      setMicrophoneState('Permission denied');
      throw new Error(error?.name === 'NotAllowedError'
        ? 'Microphone permission is required for browser calling.'
        : 'The browser microphone could not be opened.');
    }
  };

  const startCall = async () => {
    const prospect = queue.current;
    if (!prospect?.id) return;
    setBusyAction('call');
    setOperationError('');
    setCallRefreshError('');
    setSoftphoneError('');
    setBrowserCallState('Starting');
    let createdCall = null;
    if (callCreateAttemptRef.current.prospectId !== prospect.id
      || !callCreateAttemptRef.current.idempotencyKey) {
      callCreateAttemptRef.current = {
        prospectId: prospect.id,
        idempotencyKey: globalThis.crypto?.randomUUID?.()
          || `sales-call-${prospect.id}-${Date.now()}`
      };
    }
    try {
      if (!softphoneRef.current?.isReady()) {
        throw new Error('Telnyx browser calling is not ready.');
      }
      await ensureMicrophone();
      const payload = await fetchSalesJson('/api/v1/admin/sales/calls', {
        method: 'POST',
        idempotencyKey: callCreateAttemptRef.current.idempotencyKey,
        body: JSON.stringify({ prospectId: prospect.id })
      });
      const nextCall = normalizeCall(payload);
      if (!nextCall.id) throw new Error('The server did not return a sales call ID.');
      createdCall = nextCall;
      setCall(nextCall);
      setInvitation(nextCall.signup ? normalizeInvitation(nextCall.signup) : null);
      setSetupOpen(false);
      setOutcome('');
      setNote('');
      callCreateAttemptRef.current = { prospectId: '', idempotencyKey: '' };
      const callOptions = nextCall.webrtc?.callOptions || {};
      browserCallRef.current = softphoneRef.current.placeCall(
        callOptions,
        microphoneStreamRef.current
      );
    } catch (error) {
      setOperationError(error?.message || 'The call could not be started.');
      setBrowserCallState('Failed');
      if (createdCall?.id) {
        try {
          const cleanupPayload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(createdCall.id)}/actions`, {
            method: 'POST',
            body: JSON.stringify({ action: 'end_call' })
          });
          setCall(normalizeCall(cleanupPayload));
          callCreateAttemptRef.current = { prospectId: '', idempotencyKey: '' };
        } catch {
          // The original browser-call error remains primary; polling can still reconcile this call.
        }
      }
    } finally {
      setBusyAction('');
    }
  };

  const performCallAction = async (action) => {
    if (!call?.id) return;
    setBusyAction(action);
    setOperationError('');
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(call.id)}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      const nextCall = normalizeCall(payload);
      if (!nextCall.id) throw new Error('The server did not return the updated call state.');
      setCall(nextCall);
      if (nextCall.signup) setInvitation(normalizeInvitation(nextCall.signup));
      if (nextCall.terminal || action === 'end_call') {
        await softphoneRef.current?.hangup();
        browserCallRef.current = null;
        releaseMicrophone();
        await loadQueue({ quiet: true });
      }
    } catch (error) {
      setOperationError(error?.message || `${displayStatus(action)} failed.`);
    } finally {
      setBusyAction('');
    }
  };

  const sendInvitation = async () => {
    const prospect = queue.current;
    if (!prospect?.id || !call?.id) return;
    setBusyAction('invitation');
    setOperationError('');
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/signup-invitations`, {
        method: 'POST',
        idempotencyKey: `sales-signup-${call.id}`,
        body: JSON.stringify({
          salesCallId: call.id,
          contactEmail: contactFields.email.trim(),
          leadDeliveryEmail: contactFields.leadDeliveryEmail.trim(),
        })
      });
      const nextInvitation = normalizeInvitation(payload);
      if (!nextInvitation.id) throw new Error('The server did not return a signup invitation ID.');
      setInvitation(nextInvitation);
      await pollCall();
    } catch (error) {
      setOperationError(error?.message || 'The signup link could not be sent.');
    } finally {
      setBusyAction('');
    }
  };

  const saveOutcome = async () => {
    const prospect = queue.current;
    if (!prospect?.id) return;
    setBusyAction('outcome');
    setOperationError('');
    try {
      await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          contactName: contactFields.contactName.trim(),
          contactEmail: contactFields.email.trim(),
          leadDeliveryEmail: contactFields.leadDeliveryEmail.trim()
        })
      });
      if (outcome) {
        if (!call?.id) throw new Error('A sales call is required before recording an outcome.');
        const outcomePayload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(call.id)}/outcome`, {
          method: 'POST',
          idempotencyKey: `sales-outcome-${call.id}`,
          body: JSON.stringify({ outcome, notes: note.trim() })
        });
        setCall(normalizeCall(outcomePayload));
      } else if (note.trim()) {
        const noteRequest = {
          prospectId: prospect.id,
          salesCallId: call?.id || '',
          body: note.trim()
        };
        const previousAttempt = noteCreateAttemptRef.current;
        if (
          previousAttempt.prospectId !== noteRequest.prospectId
          || previousAttempt.salesCallId !== noteRequest.salesCallId
          || previousAttempt.body !== noteRequest.body
          || !previousAttempt.idempotencyKey
        ) {
          noteCreateAttemptRef.current = {
            ...noteRequest,
            idempotencyKey: globalThis.crypto?.randomUUID?.()
              || `sales-note-${prospect.id}-${Date.now()}`
          };
        }
        await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/notes`, {
          method: 'POST',
          idempotencyKey: noteCreateAttemptRef.current.idempotencyKey,
          body: JSON.stringify({
            salesCallId: call?.id || null,
            body: note.trim()
          })
        });
        noteCreateAttemptRef.current = {
          prospectId: '',
          salesCallId: '',
          body: '',
          idempotencyKey: ''
        };
      }
      const loadedQueue = await loadQueue({ quiet: true });
      await warmQueue({
        quiet: true,
        currentProspectId: loadedQueue?.currentProspectId || ''
      });
    } catch (error) {
      setOperationError(error?.message || 'The outcome and note could not be saved.');
    } finally {
      setBusyAction('');
    }
  };

  const handleImported = async () => {
    const loadedQueue = await loadQueue({ quiet: true });
    await warmQueue({
      quiet: true,
      currentProspectId: loadedQueue?.currentProspectId || ''
    });
  };

  return (
    <div className="grid gap-4 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-slate-950">Sales Console</h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeTab === 'calling'
              ? 'Human-led browser calls with a prepared EveryCall receptionist ready to join.'
              : 'A focused prospect list with contact details, outcomes, and follow-up status.'}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500" aria-live="polite">
          {activeTab === 'calling'
            ? (queue.current ? `${queue.prospects.length} prospects loaded` : 'Queue waiting')
            : 'Prospect management'}
        </div>
      </header>

      <nav className="flex w-fit gap-1 rounded-full border border-slate-200 bg-slate-100 p-1" aria-label="Sales console sections">
        <button
          type="button"
          onClick={() => setActiveTab('calling')}
          aria-current={activeTab === 'calling' ? 'page' : undefined}
          className={`min-h-9 rounded-full px-4 text-sm font-semibold transition ${activeTab === 'calling' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}
        >
          Calling console
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('prospects')}
          aria-current={activeTab === 'prospects' ? 'page' : undefined}
          className={`min-h-9 rounded-full px-4 text-sm font-semibold transition ${activeTab === 'prospects' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}
        >
          Prospects
        </button>
      </nav>

      {activeTab === 'prospects' ? (
        <>
          <CsvImportPanel
            onImported={handleImported}
            missingTimezonePolicy={queue.missingTimezonePolicy}
          />
          <ProspectsManager onProspectsChanged={handleImported} />
        </>
      ) : (
        <>
          <ErrorNotice title="Sales console action failed" message={operationError} />
          <ErrorNotice title="Call status refresh failed" message={callRefreshError} />

          <div className="grid items-start gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
            <QueuePanel
              queue={queue}
              loading={queueLoading}
              error={queueError}
              warmBusy={warmBusy}
              onRefresh={() => { void loadQueue(); }}
              onWarm={() => {
                void warmQueue({ currentProspectId: queue.currentProspectId });
              }}
              onPrepare={(prospect) => { void prepareProspect(prospect); }}
              onSkip={(prospect) => { void skipProspect(prospect); }}
              prepareBusyId={prepareBusyId}
              skipBusyId={skipBusyId}
            />

            <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="grid min-w-0 gap-4">
                <ProspectPanel prospect={queue.current} />
                <CallPanel
                  prospect={queue.current}
                  call={call}
                  busyAction={busyAction}
                  microphoneState={microphoneState}
                  softphoneState={softphoneState}
                  softphoneError={softphoneError}
                  browserCallState={browserCallState}
                  remoteAudioRef={remoteAudioRef}
                  onCall={() => { void startCall(); }}
                  onAction={(action) => { void performCallAction(action); }}
                  onReconnect={() => { void initializeSoftphone(); }}
                />
              </div>

              <ConversionPanel
                prospect={queue.current}
                call={call}
                invitation={invitation}
                busyAction={busyAction}
                setupOpen={setupOpen}
                setSetupOpen={setSetupOpen}
                contactFields={contactFields}
                setContactFields={setContactFields}
                outcome={outcome}
                setOutcome={setOutcome}
                note={note}
                setNote={setNote}
                onSendInvitation={() => { void sendInvitation(); }}
                onSaveOutcome={() => { void saveOutcome(); }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

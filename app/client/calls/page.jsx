'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeTranscriptText } from '@everycall/contracts/callTranscript';
import { useMediaQuery } from '@mui/material';
import { Button } from '../../../components/ui/button';
import { getLeadStatusMeta } from '../../../lib/leadBilling';
import ClientPage from '../_components/ClientPage';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

const PAGE_SIZE = 10;
const TRANSCRIPT_TURN_PATTERN = /^(assistant|caller|agent|system)\s*:\s*(.*)$/i;
const CALL_CATEGORY_OPTIONS = [
  'project_inquiry',
  'general_inquiry',
  'existing_customer_support',
  'vendor_or_sales',
  'spam',
  'wrong_number',
  'hangup_or_incomplete',
  'other_non_billable'
];

function formatLabel(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeTranscriptSpeaker(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'agent') return 'assistant';
  if (normalized === 'assistant' || normalized === 'caller' || normalized === 'system') return normalized;
  return '';
}

function parseTranscriptTurns(text) {
  const cleaned = sanitizeTranscriptText(String(text || ''));
  if (!cleaned) return [];

  return cleaned
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .reduce((turns, line) => {
      const match = line.match(TRANSCRIPT_TURN_PATTERN);
      if (!match) {
        if (turns.length) {
          turns[turns.length - 1].text = `${turns[turns.length - 1].text}\n\n${line}`;
          return turns;
        }
        turns.push({ speaker: 'assistant', text: line });
        return turns;
      }

      const speaker = normalizeTranscriptSpeaker(match[1]);
      const message = String(match[2] || '').trim();
      if (!speaker || speaker === 'system' || !message) return turns;

      const previousTurn = turns[turns.length - 1];
      if (previousTurn?.speaker === speaker) {
        previousTurn.text = `${previousTurn.text}\n\n${message}`;
        return turns;
      }

      turns.push({ speaker, text: message });
      return turns;
    }, []);
}

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatQueueWhenParts(value) {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const timeText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isSameCalendarDay(date, now)) {
    return { primary: timeText, secondary: 'Today' };
  }
  if (isSameCalendarDay(date, yesterday)) {
    return { primary: 'Yesterday', secondary: timeText };
  }
  return {
    primary: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    secondary: timeText
  };
}

function queueStatusClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['completed', 'contacted', 'scheduled'].includes(normalized)) return 'bg-emerald-100 text-emerald-700';
  if (['new', 'in_progress'].includes(normalized)) return 'bg-blue-100 text-blue-700';
  if (['unable_to_reach', 'missed'].includes(normalized)) return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function queueUrgencyDotClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical') return 'bg-red-500 animate-pulse';
  if (normalized === 'high') return 'bg-amber-500';
  if (normalized === 'low') return 'bg-slate-300';
  return 'bg-slate-400';
}

function queueUrgencyTextClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical') return 'text-slate-900 font-semibold';
  if (normalized === 'high') return 'text-slate-900 font-semibold';
  return 'text-slate-500 font-medium';
}

function leadBadgeClass(tone) {
  if (tone === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function normalizeCallCategory(outcomeType, isValidLead) {
  const normalized = String(outcomeType || '').trim().toLowerCase();
  if (
    isValidLead
    || [
      'callback_request',
      'estimate_request',
      'quote_request',
      'consultation_request',
      'appointment_request',
      'project_request',
      'project_inquiry',
      'service_request',
      'lead',
      'new_customer_lead',
      'message_taken',
      'transfer'
    ].includes(normalized)
  ) {
    return 'project_inquiry';
  }
  if (['general_inquiry', 'general_question', 'question_only'].includes(normalized)) {
    return 'general_inquiry';
  }
  if (normalized === 'existing_customer_support' || normalized === 'existing_customer') {
    return 'existing_customer_support';
  }
  if (['vendor_or_sales', 'vendor', 'sales_call'].includes(normalized)) {
    return 'vendor_or_sales';
  }
  if (normalized === 'spam') {
    return 'spam';
  }
  if (normalized === 'wrong_number') {
    return 'wrong_number';
  }
  if (['hangup', 'hangup_incomplete', 'canceled'].includes(normalized)) {
    return 'hangup_or_incomplete';
  }
  return 'other_non_billable';
}

export default function CallsPage() {
  const isMobile = useMediaQuery('(max-width: 980px)');
  const [calls, setCalls] = useState([]);
  const [selectedCallSid, setSelectedCallSid] = useState('');
  const [detailMeta, setDetailMeta] = useState(null);
  const [detailTranscript, setDetailTranscript] = useState('');
  const [detailStatus, setDetailStatus] = useState('Select a call to review details and edit status, urgency, summary, and notes.');
  const [saveStatus, setSaveStatus] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [queuePage, setQueuePage] = useState(0);
  const [detailDraft, setDetailDraft] = useState({
    status: 'new',
    urgency: 'normal',
    summary: '',
    notes: '',
    firstName: '',
    lastName: '',
    callbackNumber: '',
    serviceRequired: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    requestedDate: '',
    requestedTime: ''
  });
  const [lastSavedAt, setLastSavedAt] = useState('');
  const searchInputRef = useRef(null);
  const transcriptRef = useRef(null);

  const loadCalls = async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError('');
    try {
      const resp = await fetch(`/api/v1/calls`);
      if (!resp.ok) {
        setLoadError('Could not load calls. Refresh to retry.');
        return;
      }
      const data = await resp.json();
      setCalls(data.calls || []);
    } catch {
      setLoadError('Could not load calls. Refresh to retry.');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const resp = await fetch('/api/v1/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backfill_summaries' })
      });
      if (!resp.ok) {
        setLoadError('Could not refresh summaries. Refresh to retry.');
        return;
      }
      await loadCalls({ showLoading: false });
    } catch {
      setLoadError('Could not refresh summaries. Refresh to retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalls();
  }, []);

  useEffect(() => {
    setQueuePage(0);
  }, [statusFilter, urgencyFilter, categoryFilter, search, dateFrom, dateTo]);

  const loadDetail = async (callSid) => {
    if (!callSid) return;
    setSelectedCallSid(callSid);
    setSaveStatus('');
    setDetailStatus('Loading call details...');
    setDetailMeta(null);
    setDetailTranscript('');

    const [metaResp, transcriptResp] = await Promise.all([
      fetch(`/api/v1/calls?callSid=${encodeURIComponent(callSid)}`),
      fetch(`/api/v1/calls?mode=transcript&callSid=${encodeURIComponent(callSid)}`)
    ]);

    if (metaResp.ok) {
      const data = await metaResp.json();
      const call = data.call || null;
      setDetailMeta(call);
      setDetailDraft({
        status: call?.status || 'new',
        urgency: call?.urgency || 'normal',
        summary: call?.summary || '',
        notes: call?.state_json?.client_notes || '',
        firstName: call?.caller_first_name || '',
        lastName: call?.caller_last_name || '',
        callbackNumber: call?.callback_number || '',
        serviceRequired: call?.service_required || '',
        addressLine1: call?.address_line1 || '',
        addressLine2: call?.address_line2 || '',
        city: call?.city || '',
        state: call?.state || '',
        postalCode: call?.postal_code || '',
        requestedDate: call?.requested_date || '',
        requestedTime: call?.requested_time || ''
      });
    }

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      setDetailTranscript(data.transcript || '');
    }

    setDetailStatus('');
  };

  const saveDetail = async (mode = 'all') => {
    if (!detailMeta?.call_sid) return;
    setSaveStatus(mode === 'notes' ? 'Saving notes...' : 'Saving...');
    const resp = await fetch('/api/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        callSid: detailMeta.call_sid,
        status: detailDraft.status,
        urgency: detailDraft.urgency,
        summary: detailDraft.summary,
        notes: detailDraft.notes,
        firstName: detailDraft.firstName,
        lastName: detailDraft.lastName,
        callbackNumber: detailDraft.callbackNumber,
        serviceRequired: detailDraft.serviceRequired,
        addressLine1: detailDraft.addressLine1,
        addressLine2: detailDraft.addressLine2,
        city: detailDraft.city,
        state: detailDraft.state,
        postalCode: detailDraft.postalCode,
        requestedDate: detailDraft.requestedDate,
        requestedTime: detailDraft.requestedTime
      })
    });
    if (!resp.ok) {
      setSaveStatus('Save failed.');
      return;
    }
    const savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setLastSavedAt(savedAt);
    setSaveStatus(mode === 'notes' ? 'Notes saved.' : 'Saved.');
    await Promise.all([loadCalls(), loadDetail(detailMeta.call_sid)]);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const tag = target?.tagName;
      const isTypingContext = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (event.key === '/' && !isTypingContext) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
        return;
      }

      if ((event.key === 's' || event.key === 'S') && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingContext) {
        if (!detailMeta?.call_sid) return;
        event.preventDefault();
        saveDetail('notes');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailMeta?.call_sid, detailDraft.notes]);

  const rows = useMemo(() => calls.map((call, idx) => ({
    id: call.call_sid || idx,
    sid: call.call_sid,
    from: formatPhoneDisplay(call.from_number) || '-',
    summary: call.summary || '-',
    leadOutcomeType: call.lead_outcome_type || '',
    leadIsValid: Boolean(call.lead_is_valid),
    leadIsBillable: Boolean(call.lead_is_billable),
    leadDecisionReason: call.lead_decision_reason || '',
    callCategory: normalizeCallCategory(call.lead_outcome_type, call.lead_is_valid),
    firstName: call.caller_first_name || '',
    lastName: call.caller_last_name || '',
    addressLine1: call.address_line1 || '',
    addressLine2: call.address_line2 || '',
    city: call.city || '',
    state: call.state || '',
    postalCode: call.postal_code || '',
    when: new Date(call.created_at).toLocaleString(),
    status: call.status,
    urgency: call.urgency || 'normal',
    createdAt: call.created_at
  })), [calls]);

  const filteredRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (urgencyFilter !== 'all' && row.urgency !== urgencyFilter) return false;
    if (categoryFilter !== 'all' && row.callCategory !== categoryFilter) return false;
    if (search.trim()) {
      const hay = [
        row.sid,
        row.from,
        row.summary,
        `${row.firstName} ${row.lastName}`.trim(),
        row.addressLine1,
        row.addressLine2,
        row.city,
        row.state,
        row.postalCode
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search.trim().toLowerCase())) return false;
    }
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      if (new Date(row.createdAt).getTime() < fromTime) return false;
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime();
      if (new Date(row.createdAt).getTime() > toTime) return false;
    }
    return true;
  });

  const status = loadError
    ? { tone: 'bad', message: loadError }
    : loading
      ? { tone: 'warn', message: 'Loading calls...' }
      : { tone: 'ok', message: `${filteredRows.length} call(s) in view.` };

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, pageCount - 1);
  const pagedRows = filteredRows.slice(safeQueuePage * PAGE_SIZE, (safeQueuePage + 1) * PAGE_SIZE);
  const pageStart = filteredRows.length ? safeQueuePage * PAGE_SIZE + 1 : 0;
  const pageEnd = filteredRows.length ? Math.min(filteredRows.length, (safeQueuePage + 1) * PAGE_SIZE) : 0;
  const transcriptTurns = useMemo(() => parseTranscriptTurns(detailTranscript), [detailTranscript]);

  const hasUnsavedChanges = Boolean(detailMeta) && (
    detailDraft.status !== (detailMeta.status || 'new')
    || detailDraft.urgency !== (detailMeta.urgency || 'normal')
    || detailDraft.summary !== (detailMeta.summary || '')
    || detailDraft.notes !== (detailMeta.state_json?.client_notes || '')
    || detailDraft.firstName !== (detailMeta.caller_first_name || '')
    || detailDraft.lastName !== (detailMeta.caller_last_name || '')
    || detailDraft.callbackNumber !== (detailMeta.callback_number || '')
    || detailDraft.serviceRequired !== (detailMeta.service_required || '')
    || detailDraft.addressLine1 !== (detailMeta.address_line1 || '')
    || detailDraft.addressLine2 !== (detailMeta.address_line2 || '')
    || detailDraft.city !== (detailMeta.city || '')
    || detailDraft.state !== (detailMeta.state || '')
    || detailDraft.postalCode !== (detailMeta.postal_code || '')
    || detailDraft.requestedDate !== (detailMeta.requested_date || '')
    || detailDraft.requestedTime !== (detailMeta.requested_time || '')
  );

  return (
    <ClientPage
      title="Calls"
      subtitle="Review new leads, follow-up work, and full call history in one place."
      status={status}
      primaryAction={{ label: 'Refresh Data', brand: true, onClick: refreshData }}
    >
      <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]'} min-w-0`}>
        <div className="min-w-0 space-y-4">
          <section className="relative overflow-hidden rounded-xl border border-[#c3c6d7]/10 bg-[#eff4ff] p-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#004ac6]">filter_list</span>
                <h2 className="m-0 font-semibold tracking-[-0.02em] text-slate-900">Queue Views</h2>
              </div>
              <p className="m-0 mt-1 text-sm font-medium text-slate-500">Use filters to focus the call queue before you open details.</p>
            </div>

            <div className={`mt-6 grid gap-6 ${isMobile ? 'grid-cols-1' : 'md:grid-cols-4'}`}>
              <div className="space-y-1.5">
                <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Search Text</label>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400">search</span>
                  <input
                    ref={searchInputRef}
                    className="w-full rounded-md border-none bg-white py-2 pl-10 pr-4 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Number, summary, name, or location"
                    aria-label="Search Text"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Call Status</label>
                <select
                  className="w-full appearance-none rounded-md border-none bg-white px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Call Status"
                >
                  <option value="all">All Statuses</option>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="unable_to_reach">Unable to Reach</option>
                  <option value="canceled">Canceled</option>
                  <option value="spam">Spam / Wrong Number</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Urgency</label>
                <select
                  className="w-full appearance-none rounded-md border-none bg-white px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                  value={urgencyFilter}
                  onChange={(event) => setUrgencyFilter(event.target.value)}
                  aria-label="Urgency Level"
                >
                  <option value="all">All Priorities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Call Category</label>
                <select
                  className="w-full appearance-none rounded-md border-none bg-white px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  aria-label="Call Category"
                >
                  <option value="all">All Categories</option>
                  {CALL_CATEGORY_OPTIONS.map((value) => (
                    <option key={value} value={value}>{formatLabel(value)}</option>
                  ))}
                </select>
              </div>

              <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'md:col-span-3 md:grid-cols-2'}`}>
                <div className="space-y-1.5">
                  <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Date From</label>
                  <input
                    className="w-full rounded-md border-none bg-white px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    aria-label="Date From"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Date To</label>
                  <input
                    className="w-full rounded-md border-none bg-white px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    aria-label="Date To"
                  />
                </div>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1 rounded-md px-4 py-2 text-sm font-bold text-[#004ac6] transition-all hover:bg-white/50"
                  onClick={() => {
                    setStatusFilter('all');
                    setUrgencyFilter('all');
                    setCategoryFilter('all');
                    setDateFrom('');
                    setDateTo('');
                    setSearch('');
                  }}
                >
                  <span className="material-symbols-outlined text-lg">restart_alt</span>
                  Reset Filters
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#c3c6d7]/10 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#c3c6d7]/10 bg-[#eff4ff]">
                    <th className="px-6 py-4 text-[0.75rem] font-bold uppercase tracking-widest text-slate-500">Time</th>
                    <th className="px-6 py-4 text-[0.75rem] font-bold uppercase tracking-widest text-slate-500">Number</th>
                    <th className="px-6 py-4 text-[0.75rem] font-bold uppercase tracking-widest text-slate-500">AI Summary</th>
                    <th className="px-6 py-4 text-[0.75rem] font-bold uppercase tracking-widest text-slate-500">Call Category</th>
                    <th className="px-6 py-4 text-[0.75rem] font-bold uppercase tracking-widest text-slate-500">Status</th>
                    <th className="px-6 py-4 text-[0.75rem] font-bold uppercase tracking-widest text-slate-500">Urgency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c3c6d7]/5">
                  {pagedRows.length ? pagedRows.map((row) => {
                    const whenParts = formatQueueWhenParts(row.createdAt);
                    const selected = selectedCallSid === row.sid;
                    return (
                      <tr
                        key={row.id}
                        className={`cursor-pointer transition-colors ${selected ? 'bg-[#004ac6]/5 hover:bg-[#004ac6]/10' : 'hover:bg-[#eff4ff]'}`}
                        onClick={() => loadDetail(row.sid)}
                      >
                        <td className="px-6 py-5">
                          <p className="m-0 text-sm font-semibold text-slate-900">{whenParts.primary}</p>
                          <p className="m-0 text-xs text-slate-500">{whenParts.secondary}</p>
                        </td>
                        <td className="px-6 py-5">
                          <p className={`m-0 text-sm font-bold ${selected ? 'text-[#004ac6]' : 'text-slate-900'}`}>{row.from}</p>
                        </td>
                        <td className="px-6 py-5">
                          <div className="max-w-xs">
                            <p
                              className="m-0 overflow-hidden text-sm text-slate-500"
                              title={row.summary || ''}
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 1,
                                WebkitBoxOrient: 'vertical'
                              }}
                            >
                              {row.summary || '-'}
                            </p>
                            <div className="mt-2">
                              {(() => {
                                const leadMeta = getLeadStatusMeta({
                                  lead_outcome_type: row.leadOutcomeType,
                                  lead_is_valid: row.leadIsValid,
                                  lead_is_billable: row.leadIsBillable,
                                  lead_decision_reason: row.leadDecisionReason
                                });
                                return (
                                  <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${leadBadgeClass(leadMeta.tone)}`}>
                                    {leadMeta.label}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.7rem] font-semibold tracking-wide text-slate-700">
                            {formatLabel(row.callCategory)}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-extrabold uppercase tracking-wider ${queueStatusClass(row.status)}`}>
                            {formatLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${queueUrgencyDotClass(row.urgency)}`} />
                            <span className={`text-sm ${queueUrgencyTextClass(row.urgency)}`}>{formatLabel(row.urgency)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td className="px-6 py-8 text-sm text-slate-500" colSpan={6}>
                        {loading ? 'Loading calls...' : 'No calls match the current filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-[#c3c6d7]/10 bg-[#eff4ff]/30 px-6 py-4">
              <p className="m-0 text-xs font-semibold text-slate-500">
                Showing {pageStart}-{pageEnd} of {filteredRows.length} calls
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded p-1 transition-colors hover:bg-[#eff4ff] disabled:opacity-40"
                  onClick={() => setQueuePage((current) => Math.max(0, current - 1))}
                  disabled={safeQueuePage === 0}
                >
                  <span className="material-symbols-outlined text-slate-500">chevron_left</span>
                </button>
                <button
                  type="button"
                  className="rounded p-1 transition-colors hover:bg-[#eff4ff] disabled:opacity-40"
                  onClick={() => setQueuePage((current) => Math.min(pageCount - 1, current + 1))}
                  disabled={safeQueuePage >= pageCount - 1}
                >
                  <span className="material-symbols-outlined text-slate-500">chevron_right</span>
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="min-w-0">
          <div className="rounded-xl border border-[#c3c6d7]/10 bg-white p-6 shadow-xl xl:sticky xl:top-24">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="m-0 text-xl font-bold tracking-tight text-slate-900">Call Details</h2>
                <p className="m-0 mt-1 text-xs font-medium text-slate-500">Review intake information and notes.</p>
              </div>
              <div className="rounded-lg bg-[#004ac6]/10 p-2">
                <span className="material-symbols-outlined text-[#004ac6]">contact_page</span>
              </div>
            </div>

          {!detailMeta ? (
            <div className="rounded-xl border border-[#c3c6d7]/10 bg-[#eff4ff] p-4 text-sm text-slate-500">{detailStatus}</div>
          ) : (
            <>
              <div className="space-y-6">
                <div className="rounded-lg border-l-4 border-[#004ac6] bg-[#eff4ff]/50 p-4">
                  <label className="mb-2 block text-[0.65rem] font-extrabold uppercase tracking-widest text-[#004ac6]">AI Summary</label>
                  <textarea
                    className="min-h-[110px] w-full resize-none border-none bg-transparent p-0 text-sm leading-relaxed text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:ring-0"
                    value={detailDraft.summary}
                    onChange={(event) => setDetailDraft((prev) => ({ ...prev, summary: event.target.value }))}
                    placeholder="Add or refine the AI summary for this call."
                  />
                </div>

                <div className="grid gap-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {(() => {
                      const leadMeta = getLeadStatusMeta(detailMeta);
                      return (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${leadBadgeClass(leadMeta.tone)}`}>
                              {leadMeta.label}
                            </span>
                            {detailMeta.lead_outcome_type ? (
                              <span className="text-xs text-slate-500">{formatLabel(detailMeta.lead_outcome_type)}</span>
                            ) : null}
                          </div>
                          <div className="text-sm text-slate-600">{leadMeta.detail}</div>
                          {detailMeta.lead_duplicate_of_call_sid ? (
                            <div className="text-xs text-slate-500">Duplicate of call {detailMeta.lead_duplicate_of_call_sid}</div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>

                  <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Number</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none"
                        value={formatPhoneDisplay(detailMeta.from_number) || ''}
                        readOnly
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Call Time</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none"
                        value={new Date(detailMeta.created_at).toLocaleString()}
                        readOnly
                      />
                    </div>
                  </div>

                  <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Status Update</label>
                      <select
                        className="w-full appearance-none rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.status}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, status: event.target.value }))}
                      >
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="unable_to_reach">Unable to Reach</option>
                        <option value="canceled">Canceled</option>
                        <option value="spam">Spam / Wrong Number</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Urgency</label>
                      <select
                        className="w-full appearance-none rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.urgency}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, urgency: event.target.value }))}
                      >
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>

                  <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">First Name</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.firstName}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                        placeholder="First name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Last Name</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.lastName}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                        placeholder="Last name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Callback Number</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.callbackNumber}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, callbackNumber: event.target.value }))}
                        placeholder="Callback number"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Service Required</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.serviceRequired}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, serviceRequired: event.target.value }))}
                        placeholder="Service required"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Requested Date</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        type="date"
                        value={detailDraft.requestedDate}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, requestedDate: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Requested Time</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.requestedTime}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, requestedTime: event.target.value }))}
                        placeholder="Requested time"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Address Line 1</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.addressLine1}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, addressLine1: event.target.value }))}
                        placeholder="Address line 1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Address Line 2</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.addressLine2}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, addressLine2: event.target.value }))}
                        placeholder="Address line 2"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">City</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.city}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, city: event.target.value }))}
                        placeholder="City"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">State</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.state}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, state: event.target.value }))}
                        placeholder="State"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Zip</label>
                      <input
                        className="w-full rounded-md border-none bg-[#eff4ff]/40 px-4 py-2 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                        value={detailDraft.postalCode}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, postalCode: event.target.value }))}
                        placeholder="Zip"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[0.75rem] font-bold uppercase tracking-wider text-slate-500">Internal Notes</label>
                  <textarea
                    className="w-full resize-none rounded-md border-none bg-[#eff4ff]/30 px-4 py-3 text-sm text-slate-900 ring-1 ring-[#c3c6d7]/20 outline-none transition-all focus:ring-2 focus:ring-[#004ac6]/20"
                    value={detailDraft.notes}
                    onChange={(event) => setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))}
                    style={{ minHeight: isMobile ? 96 : 120 }}
                    placeholder="Add private team notes here..."
                  />
                </div>

                <div className="border-t border-[#c3c6d7]/10 pt-4">
                  <div className="flex flex-col gap-3">
                    <Button type="button" className="w-full" onClick={() => saveDetail('all')} disabled={!hasUnsavedChanges}>
                      Save Call Log
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      className="w-full border-[#004ac6]/20 text-[#004ac6] hover:bg-[#004ac6]/5"
                      onClick={() => transcriptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      View Full Transcript
                    </Button>
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    {saveStatus || (hasUnsavedChanges ? 'Unsaved changes' : 'No changes')}
                    {lastSavedAt ? ` • Last saved ${lastSavedAt}` : ''}
                  </div>
                </div>

                <div ref={transcriptRef} className="rounded-xl border border-[#c3c6d7]/10 bg-[#eff4ff] p-4">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Transcript</div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    {transcriptTurns.length ? (
                      <div className="space-y-3">
                        {transcriptTurns.map((turn, index) => {
                          const isCaller = turn.speaker === 'caller';
                          return (
                            <div key={`${turn.speaker}-${index}`} className={`flex ${isCaller ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[88%] ${isCaller ? 'text-right' : ''}`}>
                                <div className={`mb-1 text-[11px] font-bold uppercase tracking-[0.18em] ${isCaller ? 'text-[#004ac6]' : 'text-slate-500'}`}>
                                  {isCaller ? 'Caller' : 'Assistant'}
                                </div>
                                <div
                                  className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                                    isCaller
                                      ? 'rounded-br-md bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(0,74,198,0.16)]'
                                      : 'rounded-bl-md border border-slate-200 bg-[#eff4ff] text-slate-900'
                                  }`}
                                >
                                  <p className="m-0 whitespace-pre-wrap">{turn.text}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        No transcript available yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          </div>
        </aside>
      </div>
    </ClientPage>
  );
}

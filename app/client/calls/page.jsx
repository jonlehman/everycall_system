'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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

function formatQueueDate(value) {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameCalendarDay(date, now)) {
    return 'Today';
  }
  if (isSameCalendarDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatQueueTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function getInitials(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return 'EC';
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

function buildCallerName(firstName, lastName, fallback = '') {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || fallback || 'Unknown caller';
}

function buildCallerSecondary(row) {
  const location = [row.city, row.state].filter(Boolean).join(', ').trim();
  if (location) return location;
  if (row.from) return row.from;
  return 'Caller details unavailable';
}

function buildDetailCallerName(detailMeta, detailDraft) {
  return buildCallerName(
    detailDraft?.firstName || detailMeta?.caller_first_name,
    detailDraft?.lastName || detailMeta?.caller_last_name,
    formatPhoneDisplay(detailMeta?.from_number) || ''
  );
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
  const searchParams = useSearchParams();
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
  const [showDatePopover, setShowDatePopover] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showExportPopover, setShowExportPopover] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [detailDraft, setDetailDraft] = useState({
    status: 'new',
    urgency: 'normal',
    summary: '',
    notes: '',
    firstName: '',
    lastName: '',
    callbackNumber: '',
    callerEmail: '',
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
  const datePopoverRef = useRef(null);
  const advancedPopoverRef = useRef(null);
  const exportPopoverRef = useRef(null);
  const requestedCallSid = String(searchParams?.get('callSid') || '').trim();

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
    if (!requestedCallSid || selectedCallSid === requestedCallSid) return;
    loadDetail(requestedCallSid);
  }, [requestedCallSid, selectedCallSid]);

  useEffect(() => {
    setQueuePage(0);
  }, [statusFilter, urgencyFilter, categoryFilter, search, dateFrom, dateTo]);

  useEffect(() => {
    const onPointerDown = (event) => {
      const target = event.target;
      if (showDatePopover && datePopoverRef.current && !datePopoverRef.current.contains(target)) {
        setShowDatePopover(false);
      }
      if (showAdvancedFilters && advancedPopoverRef.current && !advancedPopoverRef.current.contains(target)) {
        setShowAdvancedFilters(false);
      }
      if (showExportPopover && exportPopoverRef.current && !exportPopoverRef.current.contains(target)) {
        setShowExportPopover(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showDatePopover, showAdvancedFilters, showExportPopover]);

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
      if (call?.call_sid) {
        setCalls((current) => {
          const existingIndex = current.findIndex((entry) => entry.call_sid === call.call_sid);
          if (existingIndex === -1) {
            return [call, ...current];
          }
          const next = [...current];
          next[existingIndex] = { ...next[existingIndex], ...call };
          return next;
        });
      }
      setDetailMeta(call);
      setDetailDraft({
        status: call?.status || 'new',
        urgency: call?.urgency || 'normal',
        summary: call?.summary || '',
        notes: call?.state_json?.client_notes || '',
        firstName: call?.caller_first_name || '',
        lastName: call?.caller_last_name || '',
        callbackNumber: call?.callback_number || '',
        callerEmail: call?.caller_email || '',
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
        callerEmail: detailDraft.callerEmail,
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

  const resetFilters = () => {
    setStatusFilter('all');
    setUrgencyFilter('all');
    setCategoryFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  const exportCallsCsv = async () => {
    const normalizedFrom = String(exportDateFrom || '').trim();
    const normalizedTo = String(exportDateTo || '').trim();
    if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
      setExportStatus('The export start date must be before the end date.');
      return;
    }

    setExporting(true);
    setExportStatus('');
    try {
      const params = new URLSearchParams({ mode: 'export' });
      if (normalizedFrom) params.set('dateFrom', normalizedFrom);
      if (normalizedTo) params.set('dateTo', normalizedTo);
      const response = await fetch(`/api/v1/calls?${params.toString()}`);
      if (!response.ok) {
        throw new Error('export_failed');
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `everycall-calls-${normalizedFrom || 'all'}-to-${normalizedTo || 'all'}.csv`;
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setExportStatus('CSV exported.');
      setShowExportPopover(false);
    } catch {
      setExportStatus('Could not export calls right now.');
    } finally {
      setExporting(false);
    }
  };

  const copyTranscriptToClipboard = async () => {
    const transcriptText = String(detailTranscript || '').trim();
    if (!transcriptText) {
      setSaveStatus('No transcript to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(transcriptText);
      setSaveStatus('Transcript copied.');
    } catch {
      setSaveStatus('Could not copy transcript.');
    }
  };

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
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      const toTime = toDate.getTime();
      if (new Date(row.createdAt).getTime() > toTime) return false;
    }
    return true;
  });

  const status = loadError
    ? { tone: 'bad', message: loadError }
    : loading
      ? { tone: 'warn', message: 'Loading calls...' }
      : { tone: 'ok', message: `${filteredRows.length} call(s) in view.` };

  const statusDotClass = status.tone === 'bad'
    ? 'bg-red-500'
    : status.tone === 'warn'
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, pageCount - 1);
  const pagedRows = filteredRows.slice(safeQueuePage * PAGE_SIZE, (safeQueuePage + 1) * PAGE_SIZE);
  const pageStart = filteredRows.length ? safeQueuePage * PAGE_SIZE + 1 : 0;
  const pageEnd = filteredRows.length ? Math.min(filteredRows.length, (safeQueuePage + 1) * PAGE_SIZE) : 0;
  const transcriptTurns = useMemo(() => parseTranscriptTurns(detailTranscript), [detailTranscript]);
  const selectedLeadMeta = detailMeta ? getLeadStatusMeta(detailMeta) : null;
  const selectedCallerName = detailMeta ? buildDetailCallerName(detailMeta, detailDraft) : '';
  const selectedCallerSecondary = detailMeta
    ? ([detailDraft.callbackNumber || detailMeta.callback_number, detailDraft.city || detailMeta.city, detailDraft.state || detailMeta.state]
      .filter(Boolean)
      .join(' • ') || formatPhoneDisplay(detailMeta.from_number) || '')
    : '';
  const hasActiveFilters = statusFilter !== 'all'
    || urgencyFilter !== 'all'
    || categoryFilter !== 'all'
    || Boolean(search.trim())
    || Boolean(dateFrom)
    || Boolean(dateTo);
  const advancedFilterCount = [
    categoryFilter !== 'all' ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
  const dateFilterLabel = dateFrom || dateTo
    ? `Date: ${dateFrom || 'Start'}${dateTo ? ` to ${dateTo}` : ''}`
    : 'Date';

  const hasUnsavedChanges = Boolean(detailMeta) && (
    detailDraft.status !== (detailMeta.status || 'new')
    || detailDraft.urgency !== (detailMeta.urgency || 'normal')
    || detailDraft.summary !== (detailMeta.summary || '')
    || detailDraft.notes !== (detailMeta.state_json?.client_notes || '')
    || detailDraft.firstName !== (detailMeta.caller_first_name || '')
    || detailDraft.lastName !== (detailMeta.caller_last_name || '')
    || detailDraft.callbackNumber !== (detailMeta.callback_number || '')
    || detailDraft.callerEmail !== (detailMeta.caller_email || '')
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
    <ClientPage className="gap-8">
      <div className="grid gap-8">
        <section className="grid gap-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div>
                <h1 className="m-0 font-['Space_Grotesk'] text-4xl font-black tracking-[-0.05em] text-slate-950">Calls</h1>
                <p className="m-0 mt-2 text-sm font-medium text-slate-500">
                  Review new leads, follow-up work, and full call history in one place.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass}`} />
                <p className="m-0 text-sm font-medium text-slate-600">{status.message}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div ref={exportPopoverRef} className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                  onClick={() => {
                    setShowExportPopover((current) => {
                      const nextOpen = !current;
                      if (nextOpen) {
                        setExportDateFrom((currentFrom) => currentFrom || dateFrom);
                        setExportDateTo((currentTo) => currentTo || dateTo);
                        setShowDatePopover(false);
                        setShowAdvancedFilters(false);
                      }
                      return nextOpen;
                    });
                  }}
                >
                  <span className="material-symbols-outlined text-base">download</span>
                  Export CSV
                </button>
                {showExportPopover ? (
                  <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-[20rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_48px_-12px_rgba(18,28,42,0.12)]">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">From</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          type="date"
                          value={exportDateFrom}
                          onChange={(event) => setExportDateFrom(event.target.value)}
                          aria-label="Export Date From"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">To</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          type="date"
                          value={exportDateTo}
                          onChange={(event) => setExportDateTo(event.target.value)}
                          aria-label="Export Date To"
                        />
                      </div>
                      {exportStatus ? (
                        <div className="text-sm text-slate-500">{exportStatus}</div>
                      ) : null}
                      <div className="flex justify-between gap-3 pt-1">
                        <button
                          type="button"
                          className="text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700"
                          onClick={() => {
                            setExportDateFrom('');
                            setExportDateTo('');
                            setExportStatus('');
                          }}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="rounded-xl bg-[#004ac6] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,74,198,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={exportCallsCsv}
                          disabled={exporting}
                        >
                          {exporting ? 'Exporting...' : 'Export'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                onClick={refreshData}
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Refresh Data
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
              >
                <span className="material-symbols-outlined text-base">restart_alt</span>
                Reset Filters
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:flex-nowrap xl:items-center">
              <div className="relative min-w-0 flex-1 xl:min-w-[14rem]">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
                <input
                  ref={searchInputRef}
                  className="w-full rounded-lg border-none bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-all focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by number, summary, name, or location"
                  aria-label="Search Calls"
                />
              </div>

              <div className="hidden h-8 w-px bg-slate-200 xl:block" />

              <div className="flex flex-1 flex-wrap items-center gap-2 xl:flex-nowrap xl:justify-end">
                <select
                  className="min-w-[8.25rem] rounded-lg border-none bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition-all hover:bg-slate-50 focus:bg-slate-50 focus:ring-2 focus:ring-[#004ac6]/15"
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

                <select
                  className="min-w-[7.5rem] rounded-lg border-none bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition-all hover:bg-slate-50 focus:bg-slate-50 focus:ring-2 focus:ring-[#004ac6]/15"
                  value={urgencyFilter}
                  onChange={(event) => setUrgencyFilter(event.target.value)}
                  aria-label="Urgency"
                >
                  <option value="all">All Urgency</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>

                <div ref={datePopoverRef} className="relative">
                  <button
                    type="button"
                    className="inline-flex min-w-[8.5rem] items-center justify-between gap-2 rounded-lg border-none bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                    onClick={() => {
                      setShowDatePopover((current) => !current);
                      setShowAdvancedFilters(false);
                    }}
                  >
                    <span className="truncate">{dateFilterLabel}</span>
                    <span className="material-symbols-outlined text-base text-slate-500">expand_more</span>
                  </button>
                  {showDatePopover ? (
                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-[18rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_48px_-12px_rgba(18,28,42,0.12)]">
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500">From</label>
                          <input
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                            type="date"
                            value={dateFrom}
                            onChange={(event) => setDateFrom(event.target.value)}
                            aria-label="Date From"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500">To</label>
                          <input
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                            type="date"
                            value={dateTo}
                            onChange={(event) => setDateTo(event.target.value)}
                            aria-label="Date To"
                          />
                        </div>
                        <div className="flex justify-between gap-3 pt-1">
                          <button
                            type="button"
                            className="text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700"
                            onClick={() => {
                              setDateFrom('');
                              setDateTo('');
                            }}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className="rounded-xl bg-[#004ac6] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,74,198,0.18)]"
                            onClick={() => setShowDatePopover(false)}
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div ref={advancedPopoverRef} className="relative">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg bg-[#004ac6]/5 p-2.5 text-[#004ac6] transition-all hover:bg-[#004ac6]/10"
                    onClick={() => {
                      setShowAdvancedFilters((current) => !current);
                      setShowDatePopover(false);
                    }}
                    aria-label="Advanced Filters"
                  >
                    <span className="material-symbols-outlined">tune</span>
                  </button>
                  {advancedFilterCount ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#004ac6] px-1 text-[11px] font-bold text-white">
                      {advancedFilterCount}
                    </span>
                  ) : null}
                  {showAdvancedFilters ? (
                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-[18rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_48px_-12px_rgba(18,28,42,0.12)]">
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500">Call Category</label>
                          <select
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
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
                        <div className="flex justify-between gap-3 pt-1">
                          <button
                            type="button"
                            className="text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700"
                            onClick={resetFilters}
                          >
                            Reset Filters
                          </button>
                          <button
                            type="button"
                            className="rounded-xl bg-[#004ac6] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,74,198,0.18)]"
                            onClick={() => setShowAdvancedFilters(false)}
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {loadError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {loadError}
            </div>
          ) : null}
        </section>

        <div className={`grid min-w-0 gap-6 ${isMobile ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]'}`}>
          <div className="min-w-0 space-y-6">
            <section className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-separate border-spacing-y-4 text-left">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[28%]" />
                    <col className="w-[20%]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="px-3 pb-2 text-xs font-semibold text-slate-500">Client / Caller</th>
                      <th className="px-3 pb-2 text-xs font-semibold text-slate-500">Date</th>
                      <th className="px-3 pb-2 text-xs font-semibold text-slate-500">Time</th>
                      <th className="px-3 pb-2 text-xs font-semibold text-slate-500">AI Summary</th>
                      <th className="px-3 pb-2 text-right text-xs font-semibold text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.length ? pagedRows.map((row) => {
                      const callerName = buildCallerName(row.firstName, row.lastName, row.from);
                      const selected = selectedCallSid === row.sid;
                      const dateText = formatQueueDate(row.createdAt);
                      const timeText = formatQueueTime(row.createdAt);

                      return (
                        <tr
                          key={row.id}
                          className={`cursor-pointer transition-all ${selected ? 'bg-[#004ac6]/5' : 'hover:bg-slate-50'}`}
                          onClick={() => loadDetail(row.sid)}
                        >
                          <td className="rounded-l-2xl px-3 py-4">
                            <div className="flex items-center gap-2.5">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${selected ? 'bg-[#004ac6] text-white' : 'bg-slate-100 text-slate-700'}`}>
                                {getInitials(callerName)}
                              </div>
                              <div className="min-w-0">
                                <div className={`truncate text-sm font-bold ${selected ? 'text-[#004ac6]' : 'text-slate-900'}`}>{callerName}</div>
                                <div className="truncate text-xs text-slate-500">{buildCallerSecondary(row)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="text-sm font-semibold text-slate-900">{dateText}</div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="text-sm font-semibold text-slate-900">{timeText}</div>
                          </td>
                          <td className="px-3 py-4">
                            <p
                              className="m-0 overflow-hidden text-sm leading-5 text-slate-600"
                              title={row.summary || ''}
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical'
                              }}
                            >
                              {row.summary || '-'}
                            </p>
                          </td>
                          <td className="rounded-r-2xl px-3 py-4 text-right">
                            <div className="inline-flex flex-col items-end gap-2">
                              <span className={`rounded-full px-3 py-1 text-xs font-bold ${queueStatusClass(row.status)}`}>
                                {formatLabel(row.status)}
                              </span>
                              <span className="inline-flex items-center gap-2 text-[11px]">
                                <span className={`h-2.5 w-2.5 rounded-full ${queueUrgencyDotClass(row.urgency)}`} />
                                <span className={queueUrgencyTextClass(row.urgency)}>{formatLabel(row.urgency)}</span>
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td className="rounded-2xl px-4 py-10 text-sm text-slate-500" colSpan={5}>
                          {loading ? 'Loading calls...' : 'No calls match the current filters.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                <p className="m-0 text-xs font-semibold text-slate-500">
                  Showing {pageStart}-{pageEnd} of {filteredRows.length} calls
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => setQueuePage((current) => Math.max(0, current - 1))}
                    disabled={safeQueuePage === 0}
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => setQueuePage((current) => Math.min(pageCount - 1, current + 1))}
                    disabled={safeQueuePage >= pageCount - 1}
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>
            </section>

          </div>

          <aside className="min-w-0">
            <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0px_24px_48px_-12px_rgba(18,28,42,0.08)] xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
              <div className="mb-8 flex items-start justify-between gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#004ac6] shadow-[0_20px_35px_-18px_rgba(0,74,198,0.45)]">
                  <span className="material-symbols-outlined text-3xl text-white">call</span>
                </div>
                {detailMeta ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {selectedLeadMeta ? (
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${leadBadgeClass(selectedLeadMeta.tone)}`}>
                        {selectedLeadMeta.label}
                      </span>
                    ) : null}
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${queueStatusClass(detailDraft.status)}`}>
                      {formatLabel(detailDraft.status)}
                    </span>
                  </div>
                ) : null}
              </div>

              {!detailMeta ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  {detailStatus}
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h2 className="m-0 text-2xl font-bold tracking-[-0.03em] text-slate-950">{selectedCallerName}</h2>
                    <p className="m-0 mt-1 text-sm font-medium text-slate-500">
                      {selectedCallerSecondary || 'Review intake information and notes.'}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#004ac6]/10 bg-[#eff4ff]/60 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="material-symbols-outlined text-lg text-[#004ac6]">auto_awesome</span>
                      <h3 className="m-0 text-sm font-semibold text-slate-900">AI Summary</h3>
                    </div>
                    <textarea
                      className="min-h-[120px] w-full resize-none rounded-xl border border-transparent bg-white/70 px-4 py-3 text-sm leading-6 text-slate-900 outline-none ring-0 transition-all placeholder:text-slate-400 focus:border-[#004ac6]/20 focus:bg-white"
                      value={detailDraft.summary}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, summary: event.target.value }))}
                      placeholder="Add or refine the AI summary for this call."
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Call Details</div>
                    <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Number</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                          value={formatPhoneDisplay(detailMeta.from_number) || ''}
                          readOnly
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Call Time</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                          value={new Date(detailMeta.created_at).toLocaleString()}
                          readOnly
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Status</label>
                        <select
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:ring-2 focus:ring-[#004ac6]/15"
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
                        <label className="text-xs font-semibold text-slate-500">Urgency</label>
                        <select
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:ring-2 focus:ring-[#004ac6]/15"
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
                    {selectedLeadMeta ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        {selectedLeadMeta.detail}
                        {detailMeta.lead_duplicate_of_call_sid ? ` Duplicate of call ${detailMeta.lead_duplicate_of_call_sid}.` : ''}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Caller Details</div>
                    <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">First Name</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.firstName}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                          placeholder="First name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Last Name</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.lastName}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                          placeholder="Last name"
                        />
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500">Callback Number</label>
                          <input
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                            value={detailDraft.callbackNumber}
                            onChange={(event) => setDetailDraft((prev) => ({ ...prev, callbackNumber: event.target.value }))}
                            placeholder="Callback number"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500">Email Address</label>
                          <input
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                            type="email"
                            value={detailDraft.callerEmail}
                            onChange={(event) => setDetailDraft((prev) => ({ ...prev, callerEmail: event.target.value }))}
                            placeholder="Email address"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Service Required</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.serviceRequired}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, serviceRequired: event.target.value }))}
                          placeholder="Service required"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Requested Date</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          type="date"
                          value={detailDraft.requestedDate}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, requestedDate: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Requested Time</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.requestedTime}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, requestedTime: event.target.value }))}
                          placeholder="Requested time"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Address Line 1</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.addressLine1}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, addressLine1: event.target.value }))}
                          placeholder="Address line 1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Address Line 2</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.addressLine2}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, addressLine2: event.target.value }))}
                          placeholder="Address line 2"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">City</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.city}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, city: event.target.value }))}
                          placeholder="City"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">State</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.state}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, state: event.target.value }))}
                          placeholder="State"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500">Zip</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                          value={detailDraft.postalCode}
                          onChange={(event) => setDetailDraft((prev) => ({ ...prev, postalCode: event.target.value }))}
                          placeholder="Zip"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <label className="mb-2 block text-sm font-semibold text-slate-900">Internal Notes</label>
                    <textarea
                      className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-[#004ac6]/30 focus:bg-white focus:ring-2 focus:ring-[#004ac6]/15"
                      value={detailDraft.notes}
                      onChange={(event) => setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))}
                      style={{ minHeight: isMobile ? 96 : 120 }}
                      placeholder="Add private team notes here..."
                    />
                  </div>

                  <div className="border-t border-slate-200 pt-2">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button type="button" className="w-full" onClick={() => saveDetail('all')} disabled={!hasUnsavedChanges}>
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        className="w-full border-[#004ac6]/20 text-[#004ac6] hover:bg-[#004ac6]/5"
                        onClick={copyTranscriptToClipboard}
                        disabled={!detailTranscript.trim()}
                      >
                        Copy To Clipboard
                      </Button>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      {saveStatus || (hasUnsavedChanges ? 'Unsaved changes' : 'No changes')}
                      {lastSavedAt ? ` • Last saved ${lastSavedAt}` : ''}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Transcript</div>
                    <div className="max-h-[24rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      {transcriptTurns.length ? (
                        <div className="space-y-3">
                          {transcriptTurns.map((turn, index) => {
                            const isCaller = turn.speaker === 'caller';
                            return (
                              <div key={`${turn.speaker}-${index}`} className={`flex ${isCaller ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[88%] ${isCaller ? 'text-right' : ''}`}>
                                  <div className={`mb-1 text-[11px] font-semibold ${isCaller ? 'text-[#004ac6]' : 'text-slate-500'}`}>
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
                        <div className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
                          No transcript available yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </ClientPage>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';

const CATEGORY_OPTIONS = [
  ['services', 'Services'],
  ['service_area', 'Service area'],
  ['hours', 'Hours'],
  ['estimate_policy', 'Estimate policy'],
  ['repairs_service', 'Repairs and service'],
  ['emergency_availability', 'Emergency availability'],
  ['contact_scheduling', 'Contact and scheduling'],
  ['payment_financing', 'Payment and financing'],
  ['warranty_guarantee', 'Warranty and guarantee'],
  ['licensing_insurance', 'Licensing and insurance'],
  ['company_background', 'Company background'],
  ['pricing', 'Pricing']
];

function fetchJson(url, options) {
  return fetch(url, options).then(async (response) => {
    const payload = await response.json().catch(() => null);
    return { response, payload };
  });
}

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function referenceFor(value) {
  if (value?.tenant_fact_id || value?.tenantFactId) return `tenant:${value.tenant_fact_id || value.tenantFactId}`;
  if (value?.candidate_id || value?.candidateId) return `candidate:${value.candidate_id || value.candidateId}`;
  return '';
}

function categoryLabel(value) {
  return CATEGORY_OPTIONS.find(([key]) => key === value)?.[1] || String(value || '').replaceAll('_', ' ');
}

function selectionAsSlots(selection) {
  return (Array.isArray(selection) ? selection : []).map((row) => ({
    slot_index: Number(row.slot_index),
    candidate_id: row.candidate_id || null,
    tenant_fact_id: row.tenant_fact_id || null,
    slot_ownership: row.slot_ownership,
    approved_spoken_text: row.approved_spoken_text,
    approved_title: row.approved_title,
    approved_category: row.approved_category,
    approved_source_refs_json: row.approved_source_refs_json || [],
    approved_origin: row.approved_origin,
    edited_from_snapshot: row.edited_from_snapshot || null
  })).sort((left, right) => left.slot_index - right.slot_index);
}

function severityClasses(severity) {
  if (severity === 'HIGH') return 'border-rose-300 bg-rose-50 text-rose-950';
  if (severity === 'NORMAL') return 'border-amber-300 bg-amber-50 text-amber-950';
  return 'border-sky-200 bg-sky-50 text-sky-950';
}

function ownershipBadge(row) {
  return row.slot_ownership === 'manual' ? 'You chose this' : 'Recommended';
}

function originBadge(row) {
  if (row.approved_origin === 'tenant_confirmed') return 'You told us this';
  if (row.approved_origin === 'tenant_authored') return row.tenant_fact_kind === 'authored' ? 'You added this' : 'You corrected this';
  if (row.edited_from_snapshot) return 'Your wording';
  return '';
}

function estimatedSeconds(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 2.5));
}

function audioFromUrl(url) {
  return new Audio(url);
}

export default function KnowsByHeartSection({ onStatus, onGuideFocus, onHighFlagsChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selection, setSelection] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [dirty, setDirty] = useState(false);
  const [playingSlot, setPlayingSlot] = useState(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [highlightedSlot, setHighlightedSlot] = useState(null);
  const [audioDurations, setAudioDurations] = useState({});
  const [editState, setEditState] = useState(null);
  const [correctionState, setCorrectionState] = useState(null);
  const [creationState, setCreationState] = useState(null);
  const activeAudioRef = useRef(null);

  const load = async ({ keepPending = false } = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (query.trim()) params.set('q', query.trim());
      if (category) params.set('category', category);
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts?${params.toString()}`);
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not load facts.');
      setState(payload);
      onHighFlagsChange?.((payload.flags || []).filter((flag) => flag.severity === 'HIGH').length);
      setCandidates(Array.isArray(payload.candidates) ? payload.candidates : []);
      if (!keepPending) {
        setSelection(selectionAsSlots(payload.selection));
        setDirty(false);
      }
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not load what the receptionist knows by heart.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => load({ keepPending: dirty }), 250);
    return () => window.clearTimeout(timeout);
  }, [query, category]);

  const loadMore = async () => {
    if (!state?.nextCursor) return;
    try {
      const params = new URLSearchParams({ limit: '200', cursor: state.nextCursor });
      if (query.trim()) params.set('q', query.trim());
      if (category) params.set('category', category);
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts?${params.toString()}`);
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not load more facts.');
      setCandidates((current) => [...current, ...(payload.candidates || [])]);
      setState((current) => ({ ...current, nextCursor: payload.nextCursor, total: payload.total }));
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not load more facts.', tone: 'bad' });
    }
  };

  const candidateByReference = useMemo(() => new Map(candidates.map((candidate) => [referenceFor(candidate), candidate])), [candidates]);
  const selectionByReference = useMemo(() => new Map(selection.map((row) => [referenceFor(row), row])), [selection]);
  const selectedRows = useMemo(() => selection.map((row) => {
    const candidate = candidateByReference.get(referenceFor(row));
    return {
      ...candidate,
      ...row,
      selected: true,
      spoken_text: row.approved_spoken_text,
      title: row.approved_title,
      category: row.approved_category,
      source_refs: row.approved_source_refs_json,
      origin: row.approved_origin
    };
  }), [selection, candidateByReference]);
  const selectedReferences = new Set(selection.map(referenceFor));
  const unselectedRows = candidates.filter((candidate) => !selectedReferences.has(referenceFor(candidate)));
  const rows = [...selectedRows, ...unselectedRows];

  const toggleCandidate = (candidate) => {
    const reference = referenceFor(candidate);
    const selected = selectionByReference.get(reference);
    if (selected) {
      setSelection((current) => current.filter((row) => referenceFor(row) !== reference));
      setDirty(true);
      return;
    }
    if (candidate.selectable === false) return;
    if (selection.length >= 20) return;
    const used = new Set(selection.map((row) => Number(row.slot_index)));
    const slotIndex = Array.from({ length: 20 }, (_, index) => index).find((index) => !used.has(index));
    setSelection((current) => [...current, {
      slot_index: slotIndex,
      candidate_id: candidate.candidate_id || null,
      tenant_fact_id: candidate.tenant_fact_id || null,
      slot_ownership: 'manual',
      approved_spoken_text: candidate.spoken_text,
      approved_title: candidate.title,
      approved_category: candidate.category,
      approved_source_refs_json: candidate.source_refs || [],
      approved_origin: candidate.origin
    }].sort((left, right) => left.slot_index - right.slot_index));
    setDirty(true);
  };

  const startCreation = () => {
    const used = new Set(selection.map((row) => Number(row.slot_index)));
    const emptySlot = Array.from({ length: 20 }, (_, index) => index).find((index) => !used.has(index));
    setCreationState({ statement: '', proposal: null, slotIndex: emptySlot ?? selection[0]?.slot_index ?? 0, resolutions: {} });
  };

  const proposeCreation = async () => {
    if (!creationState?.statement?.trim()) return;
    setSaving(true);
    try {
      const { response, payload } = await fetchJson('/api/v1/knowledge/core-facts/create/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('create-propose') },
        body: JSON.stringify({ selection_version: state?.selectionVersion, statement: creationState.statement })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not prepare that fact.');
      setCreationState((current) => ({
        ...current,
        proposal: payload,
        resolutions: Object.fromEntries((payload.slotConflicts || []).map((conflict) => [conflict.slot_index, 'replace']))
      }));
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not prepare that fact.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const commitCreation = async () => {
    if (!creationState?.proposal) return;
    setSaving(true);
    try {
      const { response, payload } = await fetchJson('/api/v1/knowledge/core-facts/create', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_version: state?.selectionVersion,
          proposal_token: creationState.proposal.proposalToken,
          slot_index: Number(creationState.slotIndex),
          slot_conflict_resolutions: Object.entries(creationState.resolutions || {}).map(([slotIndex, action]) => ({ slot_index: Number(slotIndex), action }))
        })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not add that fact.');
      setCreationState(null);
      onStatus?.({ message: 'Your fact was added to What You Know By Heart.', tone: 'ok' });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not add that fact.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const acknowledgeNotice = async (notice) => {
    try {
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts/notices/${notice.id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('notice') },
        body: JSON.stringify({ selection_version: state?.selectionVersion })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not dismiss this notice.');
      await load({ keepPending: dirty });
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not dismiss this notice.', tone: 'bad' });
    }
  };

  const saveSelection = async () => {
    setSaving(true);
    try {
      const { response, payload } = await fetchJson('/api/v1/knowledge/core-facts/selection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalog_revision: state?.catalogRevision,
          selection_version: state?.selectionVersion,
          slots: selection.map((row) => ({
            slot_index: row.slot_index,
            candidate_id: row.candidate_id || null,
            tenant_fact_id: row.tenant_fact_id || null
          }))
        })
      });
      if (response.status === 409) {
        await load({ keepPending: true });
        onStatus?.({ message: 'Your website was rescanned while you were editing. Your pending choices are still here; review them and save again.', tone: 'warn' });
        return;
      }
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not save this set.');
      onStatus?.({ message: 'What your receptionist knows by heart was saved. No website rebuild was needed.', tone: 'ok' });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not save this set.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const speak = async ({ slotIndex = null, text = null, allSelected = false } = {}) => {
    const { response, payload } = await fetchJson('/api/v1/knowledge/core-facts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('speak') },
      body: JSON.stringify(allSelected
        ? { all_selected: true, playback_context: 'section_02' }
        : slotIndex != null
          ? { slot_index: slotIndex, playback_context: 'row' }
          : { text, playback_context: 'edit' })
    });
    if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not play this fact.');
    return payload.manifest || [];
  };

  const playOne = async (row, textOverride = null) => {
    try {
      activeAudioRef.current?.pause?.();
      setPlayingSlot(row.slot_index);
      const manifest = await speak(textOverride ? { text: textOverride } : { slotIndex: row.slot_index });
      const item = manifest[0];
      if (!item?.url) throw new Error('No audio was returned.');
      if (row.slot_index != null && item.durationMs != null) {
        setAudioDurations((current) => ({ ...current, [row.slot_index]: item.durationMs }));
      }
      const audio = audioFromUrl(item.url);
      activeAudioRef.current = audio;
      audio.onended = () => setPlayingSlot(null);
      audio.onerror = () => setPlayingSlot(null);
      await audio.play();
    } catch (error) {
      setPlayingSlot(null);
      onStatus?.({ message: error.message || 'Could not play this fact.', tone: 'bad' });
    }
  };

  const playAll = async () => {
    setPlayingAll(true);
    try {
      activeAudioRef.current?.pause?.();
      const manifest = await speak({ allSelected: true });
      for (const item of manifest) {
        setHighlightedSlot(item.slotIndex);
        const audio = audioFromUrl(item.url);
        activeAudioRef.current = audio;
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;
          audio.play().catch(reject);
        });
      }
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not play the selected set.', tone: 'bad' });
    } finally {
      setHighlightedSlot(null);
      setPlayingAll(false);
    }
  };

  const saveWording = async () => {
    if (!editState) return;
    setSaving(true);
    try {
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts/${editState.slotIndex}/wording`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_version: state?.selectionVersion,
          spoken_text: editState.text,
          title: editState.title
        })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not save that wording.');
      setEditState(null);
      onStatus?.({ message: 'Your exact stored wording was saved.', tone: 'ok' });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not save that wording.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const revertSlot = async (row) => {
    try {
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts/${row.slot_index}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('revert') },
        body: JSON.stringify({ selection_version: state?.selectionVersion })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not restore the earlier wording.');
      onStatus?.({ message: 'The earlier website-backed wording was restored. Your slot remains a manual choice.', tone: 'ok' });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not restore the earlier wording.', tone: 'bad' });
    }
  };

  const proposeCorrection = async () => {
    if (!correctionState) return;
    setSaving(true);
    try {
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts/${correctionState.slotIndex}/correct/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('correct-propose') },
        body: JSON.stringify({
          selection_version: state?.selectionVersion,
          statement: correctionState.statement,
          flag_id: correctionState.flagId || null
        })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not prepare that correction.');
      setCorrectionState((current) => ({
        ...current,
        proposal: payload,
        resolutions: Object.fromEntries((payload.slotConflicts || []).map((conflict) => [conflict.slot_index, 'replace']))
      }));
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not prepare that correction.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const commitCorrection = async () => {
    if (!correctionState?.proposal) return;
    setSaving(true);
    try {
      const resolutions = Object.entries(correctionState.resolutions || {}).map(([slotIndex, action]) => ({ slot_index: Number(slotIndex), action }));
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts/${correctionState.slotIndex}/correct`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_version: state?.selectionVersion,
          proposal_token: correctionState.proposal.proposalToken,
          slot_conflict_resolutions: resolutions
        })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not save that correction.');
      setCorrectionState(null);
      onStatus?.({ message: 'The correction now wins both by heart and in lookup answers.', tone: 'ok' });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not save that correction.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const resolveFlag = async (flag, action, correctedRemovalMode = null) => {
    try {
      const { response, payload } = await fetchJson(`/api/v1/knowledge/core-facts/flags/${encodeURIComponent(flag.id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('flag') },
        body: JSON.stringify({
          selection_version: state?.selectionVersion,
          action,
          corrected_removal_mode: correctedRemovalMode
        })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not resolve that review item.');
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not resolve that review item.', tone: 'bad' });
    }
  };

  const undo = async () => {
    try {
      const { response, payload } = await fetchJson('/api/v1/knowledge/core-facts/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('undo') },
        body: JSON.stringify({ selection_version: state?.selectionVersion })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Nothing is available to undo.');
      onStatus?.({
        message: payload.ownershipChanges?.length
          ? `Previous selection restored. ${payload.ownershipChanges.length} slot ownership setting changed.`
          : 'Previous selection restored.',
        tone: 'ok'
      });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not undo.', tone: 'bad' });
    }
  };

  const resetRecommendations = async () => {
    try {
      const { response, payload } = await fetchJson('/api/v1/knowledge/core-facts/reset-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('reset') },
        body: JSON.stringify({ selection_version: state?.selectionVersion })
      });
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Could not reset recommendations.');
      onStatus?.({ message: 'Recommendations reset. Your manual choices were left untouched.', tone: 'ok' });
      await load();
    } catch (error) {
      onStatus?.({ message: error.message || 'Could not reset recommendations.', tone: 'bad' });
    }
  };

  if (loading && !state) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading by-heart facts...</div>;
  }

  return (
    <div id="knows-by-heart" className="scroll-mt-24 space-y-5" onFocusCapture={onGuideFocus} onClick={onGuideFocus}>
      {(state?.flags || []).length ? (
        <div className="space-y-3">
          {(state.flags || []).map((flag) => {
            const selected = selection.find((row) => Number(row.slot_index) === Number(flag.slot_index));
            return (
              <div key={flag.id} className={`rounded-lg border p-4 ${severityClasses(flag.severity)}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold tracking-wide">{flag.severity} REVIEW</div>
                    <div className="mt-1 font-semibold">
                      {flag.flag_type === 'contradicted'
                        ? `Your website now says something different. Your receptionist is still using what you approved.`
                        : flag.flag_type === 'updated'
                          ? 'This fact was reworded on your website.'
                          : flag.flag_type === 'orphaned'
                            ? 'This fact is no longer on your website. Your receptionist is still using it.'
                            : 'A new fact may be more useful than this one.'}
                    </div>
                    {selected ? <div className="mt-2 text-sm">Saying now: “{selected.approved_spoken_text}”</div> : null}
                    {flag.payload?.website?.spoken_text ? <div className="mt-1 text-sm">Website now: “{flag.payload.website.spoken_text}”</div> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => resolveFlag(flag, 'keep')}>Keep</Button>
                    {flag.payload?.website?.candidate_id ? (
                      selected?.approved_origin === 'tenant_authored'
                        ? <Button onClick={() => setCorrectionState({
                          slotIndex: selected.slot_index,
                          statement: flag.payload.website.spoken_text || flag.payload.website.canonical_text || selected.approved_spoken_text,
                          flagId: flag.id,
                          proposal: null,
                          resolutions: {}
                        })}>Review website version</Button>
                        : <Button onClick={() => resolveFlag(flag, 'update')}>Update</Button>
                    ) : null}
                    {selected?.approved_origin === 'tenant_authored' ? (
                      <>
                        <Button variant="outline" onClick={() => resolveFlag(flag, 'remove', 'stop_by_heart')}>Stop saying by heart</Button>
                        <Button variant="outline" onClick={() => resolveFlag(flag, 'remove', 'retract_correction')}>Retract correction</Button>
                      </>
                    ) : <Button variant="outline" onClick={() => resolveFlag(flag, 'remove')}>Remove</Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {(state?.notices || []).map((notice) => {
        const payload = notice.payload_json || {};
        const fixed = payload.pricing_kind === 'fixed';
        return (
          <div key={notice.id} className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950">
            <div className="text-xs font-bold tracking-wide">PRICING FOUND</div>
            <div className="mt-1 font-semibold">We found pricing on your site. {payload.source_title || 'Pricing page'}</div>
            <p className="mt-2 text-sm">Your receptionist will talk about what drives the cost, but won't say a number. If this page is out of date, you may want to know it's live.</p>
            {fixed ? <p className="mt-2 text-sm">This looks like a set fee. If you want her to say it out loud, add it under What You Know By Heart.</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {payload.source_url ? <Button variant="outline" asChild><a href={payload.source_url} target="_blank" rel="noreferrer">View page</a></Button> : null}
              {fixed ? <Button onClick={startCreation}>Add your own fact</Button> : null}
              <Button variant="outline" onClick={() => acknowledgeNotice(notice)}>Got it</Button>
            </div>
          </div>
        );
      })}

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-['Space_Grotesk'] text-xl font-bold text-slate-900">{selection.length} of 20 selected</div>
            <p className="mt-1 text-sm text-slate-600">Selected sentences are stored in the live receptionist prompt. Save applies immediately; no website rebuild is required.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={startCreation}>Add a fact</Button>
            <Button variant="outline" onClick={undo}>Undo</Button>
            <Button variant="outline" onClick={resetRecommendations}>Reset recommendations</Button>
            <Button onClick={saveSelection} disabled={!dirty || saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
          <input
            className="w-full rounded border border-slate-200 bg-white p-3 text-sm"
            placeholder="Search facts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="rounded border border-slate-200 bg-white p-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        <div className="mt-5 space-y-3">
          {rows.length ? rows.map((row) => {
            const selected = Boolean(row.selected || selectionByReference.has(referenceFor(row)));
            const atCap = selection.length >= 20 && !selected;
            const unselectable = row.selectable === false && !selected;
            const sourceRefs = row.source_refs || row.approved_source_refs_json || [];
            const active = highlightedSlot === row.slot_index;
            return (
              <div key={referenceFor(row) || `slot-${row.slot_index}`} className={`rounded-lg border p-4 transition ${active ? 'border-blue-400 bg-blue-50' : selected ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  {unselectable ? <span className="mt-1 rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600">LOOKUP ONLY</span> : (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                      checked={selected}
                      disabled={atCap}
                      onChange={() => toggleCandidate(row)}
                      aria-label={selected ? `Remove ${row.title}` : `Select ${row.title}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold leading-7 text-slate-900">{row.spoken_text || row.approved_spoken_text}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-700">{row.title || row.approved_title}</span>
                      <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-700">{categoryLabel(row.category || row.approved_category)}</span>
                      {selected ? <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-800">{ownershipBadge(row)}</span> : null}
                      {selected && originBadge(row) ? <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-800">{originBadge(row)}</span> : null}
                    </div>
                    {sourceRefs.length ? (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {sourceRefs.map((source, index) => source.url ? (
                          <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">Source {index + 1}</a>
                        ) : null)}
                      </div>
                    ) : null}
                    {atCap ? <div className="mt-2 text-xs font-medium text-amber-700">You're at 20. Uncheck one to add another.</div> : null}
                    {unselectable ? <div className="mt-2 text-xs font-medium text-slate-600">Website pricing cannot be selected. Your receptionist can discuss what affects the cost without stating the site's figure.</div> : null}
                    {selected ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => playOne(row)} disabled={playingSlot === row.slot_index}>
                          {playingSlot === row.slot_index ? 'Playing...' : 'Hear how this sounds'}
                        </Button>
                        {audioDurations[row.slot_index] ? <span className="self-center text-xs text-slate-500">≈{Math.round(audioDurations[row.slot_index] / 1000)}s</span> : null}
                        <Button variant="outline" onClick={() => setEditState({ slotIndex: row.slot_index, text: row.spoken_text, title: row.title })}>Edit wording</Button>
                        <Button variant="outline" onClick={() => setCorrectionState({ slotIndex: row.slot_index, statement: row.spoken_text, flagId: null, proposal: null, resolutions: {} })}>Correct this fact</Button>
                        {row.edited_from_snapshot ? <Button variant="outline" onClick={() => revertSlot(row)}>Revert</Button> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          }) : <div className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No available facts match these filters.</div>}
        </div>
        {state?.nextCursor ? <div className="mt-4 text-center"><Button variant="outline" onClick={loadMore}>Load more facts</Button></div> : null}

        <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">Hear what your receptionist knows</div>
              <div className="mt-1 text-sm text-slate-600">This is what your receptionist knows and how it's stored. On a live call she'll say it naturally, in her own words.</div>
            </div>
            <Button onClick={playAll} disabled={playingAll || !selection.length}>{playingAll ? 'Playing...' : 'Play selected set'}</Button>
          </div>
          {state?.block?.facts_block_text ? <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs text-slate-700">{state.block.facts_block_text}</pre> : null}
        </div>
        <p className="mt-4 text-sm text-slate-600">Everything you don't select is still available — your receptionist looks it up when a caller asks.</p>
      </div>

      {creationState ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="font-semibold text-slate-900">Add a fact</div>
          <p className="mt-1 text-sm text-slate-600">Type the statement you want your receptionist to know. Website pricing is never copied into this form; a price is authorized only when you type and confirm it yourself.</p>
          <textarea
            className="mt-3 min-h-24 w-full rounded border border-slate-200 bg-white p-3 text-sm"
            maxLength={200}
            placeholder="We charge an $89 diagnostic fee."
            value={creationState.statement}
            onChange={(event) => setCreationState((current) => ({ ...current, statement: event.target.value, proposal: null }))}
          />
          <div className="mt-2 text-xs text-slate-500">≈{estimatedSeconds(creationState.statement)} seconds to say · {creationState.statement.length}/200</div>
          {!creationState.proposal ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={proposeCreation} disabled={saving || !creationState.statement.trim()}>Review fact</Button>
              <Button variant="outline" onClick={() => setCreationState(null)}>Cancel</Button>
            </div>
          ) : (
            <div className="mt-4 rounded border border-emerald-300 bg-white p-4">
              <div className="text-sm font-semibold">You are asserting:</div>
              <div className="mt-2 text-sm">{creationState.proposal.derivedFact.canonical_text}</div>
              <div className="mt-2 text-xs text-slate-600">{categoryLabel(creationState.proposal.derivedFact.category)} · {creationState.proposal.derivedFact.polarity}</div>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Store in slot
                <select className="ml-2 rounded border border-slate-200 p-2" value={creationState.slotIndex} onChange={(event) => setCreationState((current) => ({ ...current, slotIndex: Number(event.target.value) }))}>
                  {Array.from({ length: 20 }, (_, index) => {
                    const existing = selection.find((row) => Number(row.slot_index) === index);
                    return <option key={index} value={index}>Slot {index + 1}{existing ? ` — replace “${existing.approved_title}”` : ' — empty'}</option>;
                  })}
                </select>
              </label>
              {(creationState.proposal.slotConflicts || []).length ? (
                <div className="mt-4 space-y-3">
                  <div className="font-semibold text-amber-900">An existing fact covers this subject. Decide each affected slot before saving.</div>
                  {creationState.proposal.slotConflicts.map((conflict) => (
                    <label key={conflict.slot_index} className="block text-sm">
                      Slot {Number(conflict.slot_index) + 1}: “{conflict.approved_spoken_text}”
                      <select className="ml-2 rounded border border-slate-200 p-2" value={creationState.resolutions[conflict.slot_index] || 'replace'} onChange={(event) => setCreationState((current) => ({ ...current, resolutions: { ...current.resolutions, [conflict.slot_index]: event.target.value } }))}>
                        <option value="replace">Replace with new fact</option>
                        <option value="remove">Remove from set</option>
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={commitCreation} disabled={saving}>Confirm and add</Button>
                <Button variant="outline" onClick={() => setCreationState(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {editState ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-5">
          <div className="font-semibold text-slate-900">Say it differently</div>
          <p className="mt-1 text-sm text-slate-600">Keep the factual meaning exactly the same. If the fact itself is wrong, use Correct this fact.</p>
          <input className="mt-3 w-full rounded border border-slate-200 p-3 text-sm" value={editState.title} onChange={(event) => setEditState((current) => ({ ...current, title: event.target.value }))} />
          <textarea className="mt-3 min-h-24 w-full rounded border border-slate-200 p-3 text-sm" maxLength={200} value={editState.text} onChange={(event) => setEditState((current) => ({ ...current, text: event.target.value }))} />
          <div className="mt-2 text-xs text-slate-500">≈{estimatedSeconds(editState.text)} seconds to say · {editState.text.length}/200</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => playOne({ slot_index: editState.slotIndex }, editState.text)}>Hear how this sounds</Button>
            <Button onClick={saveWording} disabled={saving}>Save wording</Button>
            <Button variant="outline" onClick={() => setEditState(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {correctionState ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="font-semibold text-slate-900">Correct this fact</div>
          <p className="mt-1 text-sm text-slate-600">This changes what your receptionist tells callers and makes the correction authoritative in lookup answers too.</p>
          <textarea className="mt-3 min-h-24 w-full rounded border border-slate-200 bg-white p-3 text-sm" maxLength={200} value={correctionState.statement} onChange={(event) => setCorrectionState((current) => ({ ...current, statement: event.target.value, proposal: null }))} />
          <div className="mt-2 text-xs text-slate-500">≈{estimatedSeconds(correctionState.statement)} seconds to say · {correctionState.statement.length}/200</div>
          <div className="mt-3">
            <Button variant="outline" onClick={() => playOne({ slot_index: correctionState.slotIndex }, correctionState.statement)}>Hear how this sounds</Button>
          </div>
          {!correctionState.proposal ? (
            <div className="mt-3 flex gap-2">
              <Button onClick={proposeCorrection} disabled={saving}>Review correction</Button>
              <Button variant="outline" onClick={() => setCorrectionState(null)}>Cancel</Button>
            </div>
          ) : (
            <div className="mt-4 rounded border border-amber-300 bg-white p-4">
              <div className="text-sm font-semibold">You are asserting:</div>
              <div className="mt-2 text-sm">{correctionState.proposal.derivedFact.canonical_text}</div>
              <div className="mt-2 text-xs text-slate-600">{categoryLabel(correctionState.proposal.derivedFact.category)} · {correctionState.proposal.derivedFact.polarity}</div>
              {(correctionState.proposal.slotConflicts || []).length ? (
                <div className="mt-4 space-y-3">
                  <div className="font-semibold text-amber-900">You told us something different during setup. Decide each affected slot before saving.</div>
                  {correctionState.proposal.slotConflicts.map((conflict) => (
                    <label key={conflict.slot_index} className="block text-sm">
                      Slot {Number(conflict.slot_index) + 1}: “{conflict.approved_spoken_text}”
                      <select className="ml-2 rounded border border-slate-200 p-2" value={correctionState.resolutions[conflict.slot_index] || 'replace'} onChange={(event) => setCorrectionState((current) => ({ ...current, resolutions: { ...current.resolutions, [conflict.slot_index]: event.target.value } }))}>
                        <option value="replace">Replace with correction</option>
                        <option value="remove">Remove from set</option>
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex gap-2">
                <Button onClick={commitCorrection} disabled={saving}>Confirm correction</Button>
                <Button variant="outline" onClick={() => setCorrectionState(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

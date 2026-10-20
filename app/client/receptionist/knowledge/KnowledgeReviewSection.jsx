'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';

const checks = [
  ['hours_confirmed', 'Business hours are correct'],
  ['address_confirmed', 'Business address is correct'],
  ['phone_confirmed', 'Business phone is correct'],
  ['after_hours_configured', 'After-hours handling is configured'],
  ['service_area_confirmed', 'Service area is correct'],
  ['dangerous_question_reviewed', 'Sensitive and unsupported questions have safe answers'],
  ['hard_overrides_reviewed', 'Business corrections have been reviewed'],
  ['temporary_notices_checked', 'Temporary notices are current'],
  ['approved_answer_snippets_reviewed', 'Approved answers have been reviewed'],
  ['sample_calls_passed', 'Sample calls passed'],
  ['handoff_path_tested', 'Transfers or callback handoffs were tested'],
  ['outcome_capture_tested', 'Call details and outcomes were saved correctly'],
  ['pack_eval_suites_passed', 'Industry acceptance tests passed']
];
const label = value => String(value || '').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());

function downloadReport(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function request(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof result.error === 'string' ? result.error : result.error?.code;
    const messages = {
      knowledge_second_reviewer_required: 'A different owner or admin must approve this change.',
      knowledge_readiness_blocked: 'Complete the remaining review checks before publishing.',
      knowledge_reviewer_forbidden: 'An account owner or admin must review these changes.',
      knowledge_change_stale: 'Business settings changed. Submit this change again for a current review.'
    };
    throw Error(messages[code] || result.message || result.error?.message || 'Could not complete this request. Refresh the page and try again.');
  }
  return result;
}

function ChangeDetails({ value }) {
  if (value === null || value === undefined) return <span>None</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-1 pl-4">{value.map((item, index) => <li key={index}><ChangeDetails value={item} /></li>)}</ul> : <span>None</span>;
  if (typeof value === 'object') return <dl className="space-y-2">{Object.entries(value).map(([key, item]) => <div key={key}><dt className="font-medium">{label(key)}</dt><dd className="break-words pl-3">{/base64/i.test(key) && typeof item === 'string'
    ? <a className="text-blue-700 underline" href={`data:application/octet-stream;base64,${item}`} download={value.filename || 'submitted-document'}>Download submitted document for review</a>
    : <ChangeDetails value={item} />}</dd></div>)}</dl>;
  return <span className="whitespace-pre-wrap">{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</span>;
}

export default function KnowledgeReviewSection({ builds = [], onPublished }) {
  const [selectedId, setSelectedId] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [governance, setGovernance] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [evidence, setEvidence] = useState('');
  const [mode, setMode] = useState('single_admin');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selectedBuild = builds.find(build => build.build_id === selectedId);
  const selectedStatus = selectedBuild?.status || '';

  useEffect(() => {
    if (!builds.some(build => build.build_id === selectedId)) setSelectedId(builds[0]?.build_id || '');
  }, [builds, selectedId]);

  async function refresh(buildId = selectedId) {
    const [policyData, reviewData] = await Promise.all([
      request('/api/v1/knowledge/governance'),
      request(`/api/v1/knowledge/readiness${buildId ? `?buildId=${encodeURIComponent(buildId)}` : ''}`)
    ]);
    setGovernance(policyData);
    setMode(policyData.policy?.review_mode || 'single_admin');
    setReadiness(reviewData.readiness || null);
    return reviewData.readiness;
  }

  useEffect(() => {
    let current = true;
    setError('');
    setReadiness(null);
    setGovernance(null);
    setChecklist({});
    setEvidence('');
    Promise.all([
      request('/api/v1/knowledge/governance'),
      request(`/api/v1/knowledge/readiness${selectedId ? `?buildId=${encodeURIComponent(selectedId)}` : ''}`)
    ]).then(([policyData, reviewData]) => {
      if (!current) return;
      setGovernance(policyData);
      setMode(policyData.policy?.review_mode || 'single_admin');
      setReadiness(reviewData.readiness || null);
      setChecklist(reviewData.readiness?.review?.checklist_json || {});
      setEvidence(reviewData.readiness?.review?.evidence_note || '');
    }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [selectedId, selectedStatus]);

  useEffect(() => {
    let current = true;
    const reload = () => {
      Promise.all([
        request('/api/v1/knowledge/governance'),
        request(`/api/v1/knowledge/readiness${selectedId ? `?buildId=${encodeURIComponent(selectedId)}` : ''}`)
      ]).then(([policyData, reviewData]) => {
        if (!current) return;
        setGovernance(policyData);
        setReadiness(reviewData.readiness || null);
      }).catch(reason => { if (current) setError(reason.message); });
    };
    window.addEventListener('everycall:knowledge-updated', reload);
    return () => { current = false; window.removeEventListener('everycall:knowledge-updated', reload); };
  }, [selectedId]);

  async function act(work) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function saveReview(event) {
    event.preventDefault();
    await act(async () => {
      const data = await request('/api/v1/knowledge/readiness', { build_id: selectedId, checklist, evidence_note: evidence });
      setReadiness(data.readiness);
      setMessage('Review saved. Complete any remaining checks before publishing.');
    });
  }

  const pending = (governance?.changes || []).filter(change => change.status === 'draft');
  const ready = readiness?.status === 'ready_for_go_live' && selectedStatus === 'ready_to_publish';
  const knownChecks = new Map(checks);
  const contentQa = selectedBuild?.validation_summary_json?.content_qa;
  const diff = contentQa?.diff;
  const added = diff?.added_claims || diff?.added_sample || [];
  const removed = diff?.removed_claims || diff?.removed_sample || [];
  const conflicts = contentQa?.conflicts || [];
  const fullDiffAvailable = Array.isArray(diff?.added_claims) && Array.isArray(diff?.removed_claims);

  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-[#E2E8F0] bg-white p-6" aria-labelledby="knowledge-review-title">
      <div>
        <h3 id="knowledge-review-title" className="text-xl font-bold text-slate-800">Review and publish</h3>
        <p className="mt-1 text-sm text-slate-600">Review each new build before making it live. Your published knowledge stays in use while you review.</p>
      </div>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
      {governance ? (
        <div className="space-y-3 border-b border-slate-200 pb-4">
          <label className="block text-sm font-medium" htmlFor="knowledge-review-mode">Who approves business changes?</label>
          <div className="flex flex-wrap gap-3">
            <select id="knowledge-review-mode" value={mode} onChange={event => setMode(event.target.value)} disabled={busy} className="min-w-0 max-w-full rounded border border-slate-300 bg-white p-2 text-sm">
              <option value="single_admin">One owner or admin</option>
              <option value="reviewed">A second owner or admin</option>
            </select>
            <Button disabled={busy || mode === governance.policy?.review_mode} onClick={() => act(async () => {
              const result = await request('/api/v1/knowledge/governance', { review_mode: mode });
              await refresh();
              setMessage(result.result?.review_required ? 'Approval requested. The current approval rule remains in effect.' : 'Approval rule saved.');
            })}>Save approval rule</Button>
          </div>
          <p className="text-xs text-slate-500">Second-person approval covers business corrections, notices, approved answers and source confirmations. Changing back also requires approval.</p>
          {pending.length ? <div className="space-y-3">
            <h4 className="font-semibold">Changes awaiting approval</h4>
            {pending.map(change => <article key={change.change_id} className="space-y-3 rounded border border-slate-200 p-3 text-sm">
              <h5 className="font-semibold">{label(change.kind)}</h5>
              <ChangeDetails value={change.payload_json} />
              <div className="flex flex-wrap gap-2">
                {['approve', 'reject'].map(decision => <Button key={decision} disabled={busy} variant={decision === 'reject' ? 'outline' : 'default'} onClick={() => act(async () => {
                  await request('/api/v1/knowledge/governance', { change_id: change.change_id, decision, note: decisionNote });
                  await refresh();
                  await onPublished?.();
                  setMessage(decision === 'approve' ? 'Change approved.' : 'Change rejected. The draft remains in the review history.');
                })}>{decision === 'approve' ? 'Approve change' : 'Reject change'}</Button>)}
              </div>
            </article>)}
            <label className="block text-sm">Review note<input className="mt-1 block w-full rounded border border-slate-300 p-2" value={decisionNote} onChange={event => setDecisionNote(event.target.value)} disabled={busy} /></label>
            <p className="text-xs text-slate-500">The person who requested a change cannot approve it. Rejected changes remain in the review history.</p>
          </div> : null}
        </div>
      ) : null}
      {builds.length ? <>
        <label className="block text-sm font-medium" htmlFor="knowledge-review-build">Build to review</label>
        <select id="knowledge-review-build" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={busy} className="min-w-0 w-full max-w-full rounded border border-slate-300 bg-white p-2 text-sm">
          {builds.map(build => <option key={build.build_id} value={build.build_id}>{build.version || build.build_id} · {label(build.build_kind)} · {label(build.status)}</option>)}
        </select>
        {diff ? <div className="space-y-3 rounded border border-slate-200 p-3 text-sm">
          <h4 className="font-semibold">What changed</h4>
          <p>{diff.previous_build_id ? 'Compared with the previously published build.' : 'This is the first build; all facts are new.'} {diff.added_count || 0} facts added; {diff.removed_count || 0} facts removed.</p>
          {[[added, 'Added facts', diff.added_count], [removed, 'Removed facts', diff.removed_count]].map(([claims, title, count]) => <details key={title}>
            <summary>{title} ({count || 0})</summary>
            <ul className="mt-2 list-disc space-y-1 break-words pl-5">{claims.slice(0, 50).map((claim, index) => <li key={index}>{claim}</li>)}</ul>
            {count > 50 ? <p className="mt-2 text-xs text-slate-500">Showing the first 50. Download all changes to review the complete list.</p> : null}
          </details>)}
          {fullDiffAvailable ? <button type="button" className="text-blue-700 underline" onClick={() => downloadReport({ added_facts: added, removed_facts: removed }, 'knowledge-changes.json')}>Download all changes</button>
            : (diff.added_count > added.length || diff.removed_count > removed.length) ? <p className="text-amber-800">This older report has only a sample. Rebuild to obtain a complete change report.</p> : null}
        </div> : selectedBuild && ['ready_to_publish', 'qa_blocked'].includes(selectedStatus) ? <p className="text-sm text-amber-800">A change report is unavailable for this build. Review its source material before proceeding.</p> : null}
        {contentQa ? <details className="space-y-2 rounded border border-slate-200 p-3 text-sm">
          <summary className="font-semibold">Quality checks</summary>
          <p>{contentQa.fact_count ?? '—'} facts; {contentQa.card_count ?? '—'} answer cards. Recommendation: {label(contentQa.recommendation || 'review')}.</p>
          <p>Knowledge covered: {(contentQa.covered_object_types || []).map(label).join(', ') || 'See the source review.'}</p>
          <p className="text-xs text-slate-500">Automated checks look for missing source links, incomplete facts and conflicting information. Your review and test calls are still required.</p>
          <button type="button" className="text-blue-700 underline" onClick={() => downloadReport({ build_id: selectedBuild.build_id, version: selectedBuild.version, created_at: selectedBuild.created_at, quality_report: contentQa }, 'knowledge-quality-report.json')}>Download quality report</button>
        </details> : null}
        {conflicts.length ? <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <h4 className="font-semibold">Conflicting facts</h4>
          {conflicts.map((conflict, index) => <details key={index}>
            <summary>{conflict.resolution === 'unresolved' ? 'Needs resolution' : 'Resolved by source authority'} · {label(conflict.severity)}</summary>
            {conflict.reason ? <p className="mt-2">{label(conflict.reason)}</p> : null}
            <ul className="mt-2 space-y-3">{(conflict.evidence || []).map((item, evidenceIndex) => <li key={evidenceIndex} className="break-words">
              <p className="font-medium">{item.claim}</p>
              <p className="text-xs text-slate-600">{label(item.authority)}{item.page_type ? ` · ${label(item.page_type)}` : ''}</p>
              {item.evidence_text ? <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-amber-300 pl-2">{item.evidence_text}</blockquote> : null}
              {item.source_ref_ids?.length ? <p className="mt-1 break-all text-xs text-slate-500">Source references: {item.source_ref_ids.join(', ')}</p> : null}
            </li>)}</ul>
          </details>)}
        </div> : null}
        {readiness ? <>
          {readiness.blockers?.length ? <div className="rounded bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Before this build can go live:</p><ul className="mt-2 list-disc space-y-1 pl-5">{readiness.blockers.map(blocker => <li key={blocker}>{knownChecks.get(blocker) || label(blocker)}</li>)}</ul></div> : <p className="text-sm text-emerald-700">{readiness.status === 'live' ? 'This build is live.' : 'The required checks are complete.'}</p>}
          {readiness.warnings?.length ? <details className="text-sm text-slate-600"><summary>Review warnings</summary><ul className="list-disc pl-5">{readiness.warnings.map((warning, index) => <li key={index}>{typeof warning === 'string' ? label(warning) : <ChangeDetails value={warning} />}</li>)}</ul></details> : null}
          <form onSubmit={saveReview} className="space-y-4">
            <fieldset disabled={busy} className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-semibold">Confirm the checks you have completed</legend>
              {checks.map(([key, title]) => <label key={key} className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={checklist[key] === true} onChange={event => setChecklist(current => ({ ...current, [key]: event.target.checked }))} />{title}</label>)}
            </fieldset>
            <label className="block text-sm font-medium">Validation notes<textarea required disabled={busy} value={evidence} onChange={event => setEvidence(event.target.value)} rows={3} className="mt-1 block w-full rounded border border-slate-300 p-2 font-normal" placeholder="Record the test calls, results, dates and any checks that do not apply, with the reason." /></label>
            <p className="text-xs text-slate-500">Check a box only after validating it. A saved checklist does not run a test call for you.</p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="outline" disabled={busy || !selectedId || !evidence.trim()}>Save review</Button>
              <Button type="button" disabled={busy || !ready} onClick={() => act(async () => {
                await request(`/api/v1/knowledge/builds/${encodeURIComponent(selectedId)}/publish`, {});
                await onPublished?.();
                await refresh();
                setMessage('Knowledge published. This build is now used for calls.');
              })}>Publish knowledge</Button>
            </div>
          </form>
        </> : null}
      </> : <p className="text-sm text-slate-600">Create a knowledge build to begin the review.</p>}
    </section>
  );
}

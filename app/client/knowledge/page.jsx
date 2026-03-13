'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';

function SummaryCard({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function ArtifactList({ title, items, emptyLabel, renderItem }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 text-sm font-semibold text-slate-900">{title}</div>
      {items.length ? (
        <div className="grid gap-2">
          {items.map((item, index) => (
            <div key={item.id || `${title}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
              {renderItem(item)}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500">{emptyLabel}</div>
      )}
    </div>
  );
}

function FeedbackEventCard({ item }) {
  const routeDecision = String(item.routeDecision || 'pending').replaceAll('_', ' ');
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-900">{item.questionText || 'Knowledge feedback'}</div>
        <span className="badge">{routeDecision}</span>
        <span className={`badge ${item.status === 'applied' ? 'ok' : 'warn'}`}>{item.status || 'pending'}</span>
      </div>
      {item.editedAnswer ? <div className="mb-2 text-sm text-slate-700">{item.editedAnswer}</div> : null}
      {item.userFeedbackText ? <div className="text-xs text-slate-500">{item.userFeedbackText}</div> : null}
    </div>
  );
}

function PendingCorrectionCard({ item, value, onChange, onApprove, onReject, busy }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-900">{item.questionText || 'Pending fact correction'}</div>
        <span className="badge warn">Needs Review</span>
        <span className="badge">{String(item.routeDecision || 'fact_correction_proposal').replaceAll('_', ' ')}</span>
      </div>
      {item.draftAnswer ? (
        <div className="mb-2 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Current Draft Answer</div>
          <div>{item.draftAnswer}</div>
        </div>
      ) : null}
      {item.userFeedbackText ? <div className="mb-2 text-sm text-slate-600">{item.userFeedbackText}</div> : null}
      {item.routeReason ? <div className="mb-2 text-xs text-slate-500">Router note: {item.routeReason}</div> : null}
      <label>Approved correction</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Confirm or edit the correction that should be applied."
        style={{ minHeight: 110 }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={onApprove} disabled={busy}>{busy ? 'Saving...' : 'Approve Correction'}</Button>
        <Button variant="outline" onClick={onReject} disabled={busy}>Reject</Button>
      </div>
    </div>
  );
}

function getTopicDepth(topicPath) {
  const segments = String(topicPath || '')
    .split('>')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return Math.max(segments.length - 1, 0);
}

function getCoverageTone(status) {
  if (status === 'ready') return 'ok';
  if (status === 'partial') return 'warn';
  return '';
}

function getRiskTone(riskLevel) {
  if (riskLevel === 'critical' || riskLevel === 'high') return 'warn';
  return 'ok';
}

export default function KnowledgePage() {
  const [knowledgeEntries, setKnowledgeEntries] = useState([]);
  const [siteTopics, setSiteTopics] = useState([]);
  const [coverageChecklist, setCoverageChecklist] = useState([]);
  const [guardrailQuestionTests, setGuardrailQuestionTests] = useState([]);
  const [runtimeCounts, setRuntimeCounts] = useState({ runtimeCardCount: 0, runtimeFactCount: 0 });
  const [feedbackEvents, setFeedbackEvents] = useState([]);
  const [status, setStatus] = useState({ message: 'Loading knowledge...', tone: 'warn' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [applyingFeedback, setApplyingFeedback] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewingEventId, setReviewingEventId] = useState(null);
  const [questionText, setQuestionText] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [previewAnswer, setPreviewAnswer] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');

  const loadKnowledge = async ({ silent = false } = {}) => {
    setLoading(true);
    if (!silent) {
      setStatus({ message: 'Loading knowledge...', tone: 'warn' });
    }
    try {
      const resp = await fetch('/api/v1/knowledge');
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Could not load knowledge.', tone: 'bad' });
        return null;
      }
      setKnowledgeEntries(Array.isArray(data.knowledgeEntries) ? data.knowledgeEntries : []);
      setSiteTopics(Array.isArray(data.siteTopics) ? data.siteTopics : []);
      setCoverageChecklist(Array.isArray(data.coverageChecklist) ? data.coverageChecklist : []);
      setGuardrailQuestionTests(Array.isArray(data.guardrailQuestionTests) ? data.guardrailQuestionTests : []);
      setRuntimeCounts(data.runtimeCounts || { runtimeCardCount: 0, runtimeFactCount: 0 });
      setFeedbackEvents(Array.isArray(data.feedbackEvents) ? data.feedbackEvents : []);
      if (!silent) {
        setStatus({ message: 'Knowledge loaded.', tone: 'ok' });
      }
      return data;
    } catch {
      setStatus({ message: 'Could not load knowledge.', tone: 'bad' });
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  useEffect(() => {
    setReviewDrafts((current) => {
      const next = {};
      feedbackEvents.forEach((item) => {
        if (item.status !== 'pending_review' || item.routeDecision !== 'fact_correction_proposal') {
          return;
        }
        next[item.id] = current[item.id] ?? item.editedAnswer ?? '';
      });
      return next;
    });
  }, [feedbackEvents]);

  const saveKnowledge = async () => {
    setSaving(true);
    setStatus({ message: 'Saving knowledge...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeEntries, siteTopics, guardrailQuestionTests })
      });
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
        return;
      }
      setKnowledgeEntries(Array.isArray(data.knowledgeEntries) ? data.knowledgeEntries : []);
      setSiteTopics(Array.isArray(data.siteTopics) ? data.siteTopics : []);
      setCoverageChecklist(Array.isArray(data.coverageChecklist) ? data.coverageChecklist : []);
      setGuardrailQuestionTests(Array.isArray(data.guardrailQuestionTests) ? data.guardrailQuestionTests : []);
      setRuntimeCounts(data.runtimeCounts || { runtimeCardCount: 0, runtimeFactCount: 0 });
      setFeedbackEvents(Array.isArray(data.feedbackEvents) ? data.feedbackEvents : []);
      setStatus({ message: 'Knowledge saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async ({ silent = false } = {}) => {
    const trimmedQuestion = String(questionText || '').trim();
    if (!trimmedQuestion) {
      setStatus({ message: 'Enter a question to preview an answer.', tone: 'warn' });
      return null;
    }

    setQuerying(true);
    if (!silent) {
      setStatus({ message: 'Running knowledge lookup...', tone: 'warn' });
    }

    try {
      const resp = await fetch('/api/v1/knowledge/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionText: trimmedQuestion })
      });
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Could not run the knowledge preview.', tone: 'bad' });
        return null;
      }
      setPreviewData(data);
      setPreviewAnswer(data.answerPreview?.text || '');
      setRuntimeCounts(data.runtimeCounts || { runtimeCardCount: 0, runtimeFactCount: 0 });
      setFeedbackEvents(Array.isArray(data.feedbackEvents) ? data.feedbackEvents : []);
      setFeedbackNote('');
      if (!silent) {
        setStatus({ message: 'Preview ready.', tone: 'ok' });
      }
      return data;
    } catch {
      setStatus({ message: 'Could not run the knowledge preview.', tone: 'bad' });
      return null;
    } finally {
      setQuerying(false);
    }
  };

  const applyFeedback = async () => {
    if (!previewData?.questionText) {
      setStatus({ message: 'Run a preview before applying feedback.', tone: 'warn' });
      return;
    }

    const editedAnswer = String(previewAnswer || '').trim();
    const draftAnswer = String(previewData.answerPreview?.text || '').trim();
    const note = String(feedbackNote || '').trim();
    if (!editedAnswer && !note) {
      setStatus({ message: 'Add an edited answer or a feedback note first.', tone: 'warn' });
      return;
    }

    setApplyingFeedback(true);
    setStatus({ message: 'Applying feedback...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/knowledge/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: previewData.questionText,
          draftAnswer,
          editedAnswer,
          userFeedbackText: note,
          topicHints: previewData.retrieval?.queryContext?.topicHints || [],
          serviceTags: previewData.retrieval?.queryContext?.serviceTags || []
        })
      });
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Could not apply feedback.', tone: 'bad' });
        return;
      }
      setFeedbackEvents(Array.isArray(data.feedbackEvents) ? data.feedbackEvents : []);
      setRuntimeCounts(data.runtimeCounts || { runtimeCardCount: 0, runtimeFactCount: 0 });
      await loadKnowledge({ silent: true });
      await runPreview({ silent: true });
      const routeDecision = String(data.applied?.decision?.routeDecision || 'feedback').replaceAll('_', ' ');
      const appliedMessage = data.applied?.decision?.routeDecision === 'fact_correction_proposal'
        ? 'Feedback saved for review.'
        : `Feedback applied as ${routeDecision}.`;
      setStatus({ message: appliedMessage, tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not apply feedback.', tone: 'bad' });
    } finally {
      setApplyingFeedback(false);
    }
  };

  const reviewPendingCorrection = async (eventId, action) => {
    setReviewingEventId(eventId);
    setStatus({ message: action === 'approve' ? 'Applying correction...' : 'Rejecting correction...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/knowledge/review-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          action,
          resolutionText: action === 'approve' ? String(reviewDrafts[eventId] || '').trim() : ''
        })
      });
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Could not review the correction.', tone: 'bad' });
        return;
      }
      setFeedbackEvents(Array.isArray(data.feedbackEvents) ? data.feedbackEvents : []);
      setRuntimeCounts(data.runtimeCounts || { runtimeCardCount: 0, runtimeFactCount: 0 });
      await loadKnowledge({ silent: true });
      if (previewData?.questionText) {
        await runPreview({ silent: true });
      }
      setStatus({ message: action === 'approve' ? 'Correction approved.' : 'Correction rejected.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not review the correction.', tone: 'bad' });
    } finally {
      setReviewingEventId(null);
    }
  };

  const counts = useMemo(() => {
    const populatedKnowledge = knowledgeEntries.filter((entry) => String(entry.contentText || '').trim()).length;
    const populatedSiteTopics = siteTopics.filter((topic) => String(topic.summaryObjective || '').trim()).length;
    const readyCoverageChecks = coverageChecklist.filter((item) => item.status === 'ready').length;
    const partialCoverageChecks = coverageChecklist.filter((item) => item.status === 'partial').length;
    const missingCoverageChecks = coverageChecklist.filter((item) => item.status === 'missing').length;
    const answeredGuardrails = guardrailQuestionTests.filter((item) => String(item.answer || '').trim()).length;
    const unansweredGuardrails = guardrailQuestionTests.length - answeredGuardrails;
    return {
      populatedKnowledge,
      totalKnowledge: knowledgeEntries.length,
      populatedSiteTopics,
      totalSiteTopics: siteTopics.length,
      readyCoverageChecks,
      totalCoverageChecks: coverageChecklist.length,
      partialCoverageChecks,
      missingCoverageChecks,
      answeredGuardrails,
      totalGuardrails: guardrailQuestionTests.length,
      unansweredGuardrails
    };
  }, [coverageChecklist, guardrailQuestionTests, knowledgeEntries, siteTopics]);

  const showSupplementalKnowledgeEntries = siteTopics.length === 0;

  const pendingCorrections = useMemo(
    () => feedbackEvents.filter((item) => item.status === 'pending_review' && item.routeDecision === 'fact_correction_proposal'),
    [feedbackEvents]
  );
  const resolvedFeedbackEvents = useMemo(
    () => feedbackEvents.filter((item) => !(item.status === 'pending_review' && item.routeDecision === 'fact_correction_proposal')),
    [feedbackEvents]
  );
  const retrieval = previewData?.retrieval || { cards: [], facts: [], overrides: [], guardrails: [], queryContext: {}, resultStrength: 'none' };

  return (
    <ClientPage
      title="Knowledge"
      subtitle="Review business information, test retrieval, and approve high-risk answers before enabling the assistant."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save Knowledge', brand: true, onClick: saveKnowledge, disabled: saving }}
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <SummaryCard label="Site Topics" value={`${counts.populatedSiteTopics}/${counts.totalSiteTopics}`} />
        <SummaryCard label="Checklist Ready" value={`${counts.readyCoverageChecks}/${counts.totalCoverageChecks}`} />
        <SummaryCard
          label="Checklist Gaps"
          value={counts.partialCoverageChecks + counts.missingCoverageChecks}
          tone={(counts.partialCoverageChecks + counts.missingCoverageChecks) > 0 ? 'text-amber-700' : 'text-emerald-700'}
        />
        <SummaryCard label="Answered Guardrails" value={`${counts.answeredGuardrails}/${counts.totalGuardrails}`} />
        <SummaryCard
          label="Needs Review"
          value={counts.unansweredGuardrails}
          tone={counts.unansweredGuardrails > 0 ? 'text-amber-700' : 'text-emerald-700'}
        />
        <SummaryCard label="Runtime Cards" value={runtimeCounts.runtimeCardCount || 0} />
        <SummaryCard label="Runtime Facts" value={runtimeCounts.runtimeFactCount || 0} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3">
            <h2 className="m-0 text-lg font-semibold">Discovered Site Topics</h2>
            <p className="mt-1 text-sm text-slate-500">The site defines the knowledge structure. Review the objective summaries here; runtime cards and facts compile from these topics.</p>
          </div>
          {siteTopics.length ? (
            <div className="grid gap-3">
              {siteTopics.map((topic, index) => {
                const depth = getTopicDepth(topic.topicPath);
                return (
                  <div
                    key={topic.id || topic.topicPath || index}
                    className="rounded-xl border border-slate-200 p-3"
                    style={{ marginLeft: `${Math.min(depth, 4) * 16}px` }}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">{topic.displayTitle || topic.topicPath}</div>
                      <span className="badge">{topic.topicType || 'topic'}</span>
                      <span className={`badge ${getRiskTone(topic.riskLevel)}`}>
                        {String(topic.riskLevel || 'normal').toUpperCase()}
                      </span>
                      {topic.sourceUrl ? (
                        <a className="text-xs text-slate-500 underline" href={topic.sourceUrl} target="_blank" rel="noreferrer">
                          Source
                        </a>
                      ) : null}
                    </div>
                    <div className="mb-2 text-xs text-slate-500">{topic.topicPath}</div>
                    <textarea
                      value={topic.summaryObjective || ''}
                      onChange={(event) => {
                        const next = [...siteTopics];
                        next[index] = { ...topic, summaryObjective: event.target.value };
                        setSiteTopics(next);
                      }}
                      placeholder="No objective summary compiled yet."
                      style={{ minHeight: topic.topicType === 'group' ? 84 : 120 }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No site topics have been compiled yet.</div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3">
            <h2 className="m-0 text-lg font-semibold">Coverage Checklist</h2>
            <p className="mt-1 text-sm text-slate-500">This checklist is a review overlay only. It helps you confirm broad customer-risk areas without constraining the stored topic tree.</p>
          </div>
          {coverageChecklist.length ? (
            <div className="grid gap-3">
              {coverageChecklist.map((item) => (
                <div key={item.id || item.checkKey} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <span className={`badge ${getCoverageTone(item.status)}`}>{String(item.status || 'missing').toUpperCase()}</span>
                    <span className="badge">{Number(item.coverageConfidence || 0).toFixed(2)}</span>
                  </div>
                  {item.notes ? <div className="mb-2 text-sm text-slate-700">{item.notes}</div> : null}
                  <div className="text-xs text-slate-500">
                    Matched topics: {item.matchedTopicPaths?.length ? item.matchedTopicPaths.join(' | ') : 'none yet'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No coverage checklist has been generated yet.</div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-lg font-semibold">Ask the Assistant</h2>
            <p className="mt-1 text-sm text-slate-500">Preview the grounded answer, inspect retrieved knowledge, then route your feedback back into the knowledge system.</p>
          </div>
          <Button variant="outline" onClick={() => runPreview()} disabled={querying || saving || applyingFeedback}>
            {querying ? 'Running...' : 'Run Preview'}
          </Button>
        </div>
        <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3">
            <div>
              <label>Question</label>
              <textarea
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                placeholder="How does your warranty work?"
                style={{ minHeight: 88 }}
              />
            </div>
            <div>
              <label>Answer Preview</label>
              <textarea
                value={previewAnswer}
                onChange={(event) => setPreviewAnswer(event.target.value)}
                placeholder="Run a preview to generate the grounded answer."
                style={{ minHeight: 140 }}
              />
              <div className="mt-1 text-xs text-slate-500">
                Source: {previewData?.answerPreview?.source || 'none'} | Strength: {retrieval.resultStrength || 'none'}
              </div>
            </div>
            <div>
              <label>Feedback Note</label>
              <textarea
                value={feedbackNote}
                onChange={(event) => setFeedbackNote(event.target.value)}
                placeholder="Example: Mention water heaters and repipes first. Do not imply every plumbing job is covered."
                style={{ minHeight: 110 }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={applyFeedback} disabled={applyingFeedback || querying || !previewData?.questionText}>
                {applyingFeedback ? 'Applying...' : 'Apply Feedback'}
              </Button>
              <Button variant="outline" onClick={() => loadKnowledge()} disabled={loading || saving || querying || applyingFeedback}>
                Reload Knowledge
              </Button>
            </div>
          </div>

          <div className="grid gap-3">
            <ArtifactList
              title="Query Context"
              items={[
                {
                  id: 'context',
                  topicHints: retrieval.queryContext?.topicHints || [],
                  serviceTags: retrieval.queryContext?.serviceTags || [],
                  tradeHint: retrieval.queryContext?.tradeHint || null,
                  conversationStage: retrieval.queryContext?.conversationStage || null
                }
              ]}
              emptyLabel="No preview yet."
              renderItem={(item) => (
                <div className="grid gap-1 text-sm text-slate-700">
                  <div>Topics: {item.topicHints.length ? item.topicHints.join(', ') : 'none detected'}</div>
                  <div>Service tags: {item.serviceTags.length ? item.serviceTags.join(', ') : 'none detected'}</div>
                  <div>Trade hint: {item.tradeHint || 'none'}</div>
                  <div>Conversation stage: {item.conversationStage || 'answering_question'}</div>
                </div>
              )}
            />
            <ArtifactList
              title="Top Cards"
              items={retrieval.cards || []}
              emptyLabel="No cards matched the current question."
              renderItem={(item) => (
                <div className="grid gap-1 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">{item.title}</div>
                  <div>{item.summary || 'No summary.'}</div>
                  {item.facts?.length ? <div className="text-xs text-slate-500">{item.facts.map((fact) => fact.claim).join(' | ')}</div> : null}
                  {item.sourceUrl ? <a className="text-xs text-slate-500 underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Source</a> : null}
                </div>
              )}
            />
            <ArtifactList
              title="Extra Facts"
              items={retrieval.facts || []}
              emptyLabel="No standalone facts matched the current question."
              renderItem={(item) => (
                <div className="grid gap-1 text-sm text-slate-700">
                  <div>{item.claim}</div>
                  {item.sourceUrl ? <a className="text-xs text-slate-500 underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Source</a> : null}
                </div>
              )}
            />
            <ArtifactList
              title="Overrides"
              items={retrieval.overrides || []}
              emptyLabel="No answer overrides matched the current question."
              renderItem={(item) => (
                <div className="grid gap-1 text-sm text-slate-700">
                  <div>{item.preferredAnswer}</div>
                  {item.triggerText ? <div className="text-xs text-slate-500">Trigger: {item.triggerText}</div> : null}
                  {item.matchedBy?.length ? <div className="text-xs text-slate-500">Matched by: {item.matchedBy.join(', ')}</div> : null}
                </div>
              )}
            />
            <ArtifactList
              title="Guardrails"
              items={retrieval.guardrails || []}
              emptyLabel="No guardrails matched the current question."
              renderItem={(item) => (
                <div className="grid gap-1 text-sm text-slate-700">
                  <div>{item.instruction}</div>
                  <div className="text-xs text-slate-500">{String(item.severity || 'high').toUpperCase()}</div>
                  {item.matchedBy?.length ? <div className="text-xs text-slate-500">Matched by: {item.matchedBy.join(', ')}</div> : null}
                </div>
              )}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="m-0 text-lg font-semibold">Supplemental Notes</h2>
              <p className="mt-1 text-sm text-slate-500">
                {showSupplementalKnowledgeEntries
                  ? 'Use these notes when you need to author knowledge directly instead of relying on site-derived topics.'
                  : 'Site topics are the primary runtime source right now, so the old fixed-section notes are hidden to avoid pulling the system back into predefined buckets.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => loadKnowledge()} disabled={loading || saving || querying || applyingFeedback}>Reload</Button>
          </div>
          {showSupplementalKnowledgeEntries ? (
            <div className="grid gap-3">
              {knowledgeEntries.map((entry, index) => (
                <div key={entry.id || entry.sectionType || index} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                    {entry.sourceType ? <span className="badge ok">{entry.sourceType}</span> : null}
                    {entry.sourceUrl ? (
                      <a className="text-xs text-slate-500 underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    ) : null}
                  </div>
                  <textarea
                    value={entry.contentText || ''}
                    onChange={(event) => {
                      const next = [...knowledgeEntries];
                      next[index] = { ...entry, contentText: event.target.value };
                      setKnowledgeEntries(next);
                    }}
                    placeholder={`Add ${String(entry.title || 'knowledge').toLowerCase()} details here.`}
                    style={{ minHeight: 120 }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">This tenant has site-derived topics, so review and edit those summaries above instead of maintaining fixed-section notes.</div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3">
            <h2 className="m-0 text-lg font-semibold">Guardrail Questions</h2>
            <p className="mt-1 text-sm text-slate-500">Approve the answer the assistant should be able to give for high-risk topics like warranty, pricing, and emergency service.</p>
          </div>
          <div className="grid gap-3">
            {guardrailQuestionTests.map((item, index) => {
              const answered = Boolean(String(item.answer || '').trim());
              return (
                <div key={item.id || item.questionText || index} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{item.questionText}</div>
                    <span className={`badge ${answered ? 'ok' : 'warn'}`}>{answered ? 'Approved' : 'Needs Review'}</span>
                    <span className="badge">{String(item.riskLevel || 'high').toUpperCase()}</span>
                  </div>
                  {item.sourceUrl ? (
                    <div className="mb-2 text-xs text-slate-500">
                      Source: <a className="underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a>
                    </div>
                  ) : null}
                  <textarea
                    value={item.answer || ''}
                    onChange={(event) => {
                      const next = [...guardrailQuestionTests];
                      next[index] = {
                        ...item,
                        answer: event.target.value,
                        approvedAnswer: event.target.value,
                        draftAnswer: event.target.value
                      };
                      setGuardrailQuestionTests(next);
                    }}
                    placeholder="Write the approved answer the assistant should use for this question."
                    style={{ minHeight: 130 }}
                  />
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-3">
          <h2 className="m-0 text-lg font-semibold">Pending Fact Corrections</h2>
          <p className="mt-1 text-sm text-slate-500">These flagged corrections need a human approve/reject decision before they affect tenant knowledge.</p>
        </div>
        {pendingCorrections.length ? (
          <div className="grid gap-3">
            {pendingCorrections.map((item) => (
              <PendingCorrectionCard
                key={item.id}
                item={item}
                value={reviewDrafts[item.id] || ''}
                onChange={(value) => setReviewDrafts((current) => ({ ...current, [item.id]: value }))}
                onApprove={() => reviewPendingCorrection(item.id, 'approve')}
                onReject={() => reviewPendingCorrection(item.id, 'reject')}
                busy={reviewingEventId === item.id}
              />
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No pending fact corrections.</div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-3">
          <h2 className="m-0 text-lg font-semibold">Recent Feedback</h2>
          <p className="mt-1 text-sm text-slate-500">Applied, approved, and rejected review events stay visible here so you can track what changed and how it was routed.</p>
        </div>
        {resolvedFeedbackEvents.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {resolvedFeedbackEvents.map((item) => (
              <FeedbackEventCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No reviewed feedback yet.</div>
        )}
      </section>
    </ClientPage>
  );
}

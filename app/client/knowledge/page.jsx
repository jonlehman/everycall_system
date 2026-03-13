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

export default function KnowledgePage() {
  const [knowledgeEntries, setKnowledgeEntries] = useState([]);
  const [guardrailQuestionTests, setGuardrailQuestionTests] = useState([]);
  const [status, setStatus] = useState({ message: 'Loading knowledge...', tone: 'warn' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadKnowledge = async () => {
    setLoading(true);
    setStatus({ message: 'Loading knowledge...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/knowledge');
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Could not load knowledge.', tone: 'bad' });
        return;
      }
      setKnowledgeEntries(Array.isArray(data.knowledgeEntries) ? data.knowledgeEntries : []);
      setGuardrailQuestionTests(Array.isArray(data.guardrailQuestionTests) ? data.guardrailQuestionTests : []);
      setStatus({ message: 'Knowledge loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not load knowledge.', tone: 'bad' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  const saveKnowledge = async () => {
    setSaving(true);
    setStatus({ message: 'Saving knowledge...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeEntries, guardrailQuestionTests })
      });
      const data = resp.ok ? await resp.json() : null;
      if (!data?.ok) {
        setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
        return;
      }
      setKnowledgeEntries(Array.isArray(data.knowledgeEntries) ? data.knowledgeEntries : []);
      setGuardrailQuestionTests(Array.isArray(data.guardrailQuestionTests) ? data.guardrailQuestionTests : []);
      setStatus({ message: 'Knowledge saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => {
    const populatedKnowledge = knowledgeEntries.filter((entry) => String(entry.contentText || '').trim()).length;
    const answeredGuardrails = guardrailQuestionTests.filter((item) => String(item.answer || '').trim()).length;
    const unansweredGuardrails = guardrailQuestionTests.length - answeredGuardrails;
    return {
      populatedKnowledge,
      totalKnowledge: knowledgeEntries.length,
      answeredGuardrails,
      totalGuardrails: guardrailQuestionTests.length,
      unansweredGuardrails
    };
  }, [guardrailQuestionTests, knowledgeEntries]);

  return (
    <ClientPage
      title="Knowledge"
      subtitle="Review business information and approve high-risk guardrail answers before enabling the assistant."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save Knowledge', brand: true, onClick: saveKnowledge, disabled: saving }}
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <SummaryCard label="Knowledge Sections" value={`${counts.populatedKnowledge}/${counts.totalKnowledge}`} />
        <SummaryCard label="Answered Guardrail Questions" value={`${counts.answeredGuardrails}/${counts.totalGuardrails}`} />
        <SummaryCard
          label="Needs Review"
          value={counts.unansweredGuardrails}
          tone={counts.unansweredGuardrails > 0 ? 'text-amber-700' : 'text-emerald-700'}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="m-0 text-lg font-semibold">Knowledge Entries</h2>
              <p className="mt-1 text-sm text-slate-500">These sections describe the business in human terms. Keep them specific and factual.</p>
            </div>
            <Button variant="outline" onClick={loadKnowledge} disabled={loading || saving}>Reload</Button>
          </div>
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
    </ClientPage>
  );
}

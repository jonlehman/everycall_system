'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBlankGuardrailQuestionTests, createBlankKnowledgeEntries } from '../../../lib/knowledgeTemplates.js';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function IndustryConfigPage() {
  const [industries, setIndustries] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [knowledgeEntries, setKnowledgeEntries] = useState(() => createBlankKnowledgeEntries());
  const [guardrailQuestionTests, setGuardrailQuestionTests] = useState(() => createBlankGuardrailQuestionTests());
  const [industryName, setIndustryName] = useState('');
  const [industryKey, setIndustryKey] = useState('');
  const [copyFromKey, setCopyFromKey] = useState('');
  const [status, setStatus] = useState('');

  const promptTemplates = [
    {
      id: 'service_default',
      label: 'Service Business Default',
      text: `# TONE & STYLE\n- Warm, professional, and efficient.\n- Use short sentences and plain language.\n- Ask one question at a time.\n\n# CALL FLOW\n- Confirm name, phone, and address.\n- Clarify the issue and urgency.\n- Offer a callback window and confirm.\n\n# DO NOT\n- Do not quote prices unless provided.\n- Do not promise exact arrival times.\n- Do not make up policies.`
    },
    {
      id: 'emergency_first',
      label: 'Emergency First',
      text: `# PRIORITY\n- Treat safety-related issues as urgent.\n- If emergency language appears, escalate immediately.\n\n# QUESTIONS\n- Confirm caller name and best callback number.\n- Get address before asking additional details.\n\n# BEHAVIOR\n- Keep tone calm and reassuring.\n- Confirm next steps clearly.`
    },
    {
      id: 'premium_white_glove',
      label: 'Premium White-Glove',
      text: `# TONE\n- Polished, concierge-style service.\n- Use full sentences and courteous confirmations.\n\n# DETAILS\n- Confirm preferences, access notes, and time windows.\n- Summarize the request before closing.\n\n# CLOSING\n- Offer to help with anything else and thank the caller.`
    }
  ];

  const loadIndustries = () => {
    fetch('/api/v1/admin/industries')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        const list = data?.industries || [];
        setIndustries(list);
        if (!selectedKey && list.length) {
          setSelectedKey(list[0].key);
        }
      })
      .catch(() => {});
  };

  const loadPrompt = (key) => {
    if (!key) return;
    fetch(`/api/v1/admin/industries?mode=prompt&industryKey=${encodeURIComponent(key)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setPrompt(data?.prompt?.prompt || ''))
      .catch(() => {});
  };

  const loadKnowledge = (key) => {
    if (!key) return;
    fetch(`/api/v1/admin/industries?mode=knowledge&industryKey=${encodeURIComponent(key)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        setKnowledgeEntries(Array.isArray(data?.knowledgeEntries) ? data.knowledgeEntries : createBlankKnowledgeEntries());
        setGuardrailQuestionTests(Array.isArray(data?.guardrailQuestionTests) ? data.guardrailQuestionTests : createBlankGuardrailQuestionTests());
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadIndustries();
  }, []);

  useEffect(() => {
    if (!selectedKey) return;
    loadPrompt(selectedKey);
    loadKnowledge(selectedKey);
  }, [selectedKey]);

  const savePrompt = async () => {
    if (!selectedKey || !prompt.trim()) {
      setStatus('Prompt is required.');
      return;
    }
    const resp = await fetch(`/api/v1/admin/industries?mode=prompt&industryKey=${encodeURIComponent(selectedKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    setStatus(resp.ok ? 'Prompt saved.' : 'Save failed.');
  };

  const saveKnowledge = async () => {
    if (!selectedKey) return;
    const resp = await fetch(`/api/v1/admin/industries?mode=knowledge&industryKey=${encodeURIComponent(selectedKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knowledgeEntries, guardrailQuestionTests })
    });
    setStatus(resp.ok ? 'Knowledge defaults saved.' : 'Save failed.');
  };

  const applyPromptToTenants = async () => {
    if (!selectedKey) return;
    const resp = await fetch(`/api/v1/admin/industries?mode=applyPrompt&industryKey=${encodeURIComponent(selectedKey)}`, {
      method: 'POST'
    });
    if (!resp.ok) {
      setStatus('Apply failed.');
      return;
    }
    const data = await resp.json();
    setStatus(`Applied prompt to ${data.updated || 0} tenants.`);
  };

  const applyKnowledgeToTenants = async () => {
    if (!selectedKey) return;
    const resp = await fetch(`/api/v1/admin/industries?mode=applyKnowledge&industryKey=${encodeURIComponent(selectedKey)}`, {
      method: 'POST'
    });
    if (!resp.ok) {
      setStatus('Apply failed.');
      return;
    }
    const data = await resp.json();
    setStatus(`Applied knowledge to ${data.updated || 0} tenants.`);
  };

  const createIndustry = async () => {
    const key = industryKey.trim();
    const name = industryName.trim();
    if (!key || !name) {
      setStatus('Industry key and name are required.');
      return;
    }
    const resp = await fetch('/api/v1/admin/industries?mode=industry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, name, active: true })
    });
    if (!resp.ok) {
      setStatus('Industry save failed.');
      return;
    }
    setIndustryKey('');
    setIndustryName('');
    loadIndustries();
    setStatus('Industry saved.');
  };

  const copyFromIndustry = async () => {
    if (!copyFromKey || !selectedKey) {
      setStatus('Select a source and target industry.');
      return;
    }
    const resp = await fetch('/api/v1/admin/industries?mode=clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKey: copyFromKey, targetKey: selectedKey, replace: true })
    });
    if (!resp.ok) {
      setStatus('Copy failed.');
      return;
    }
    loadPrompt(selectedKey);
    loadKnowledge(selectedKey);
    setStatus('Copied prompt and knowledge defaults.');
  };

  const seedDefaults = async () => {
    if (!selectedKey) return;
    const resp = await fetch('/api/v1/admin/industries?mode=seedDefaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industryKey: selectedKey })
    });
    if (!resp.ok) {
      setStatus('Seed defaults failed.');
      return;
    }
    const data = await resp.json();
    const knowledgeCount = data.inserted?.knowledgeEntries || 0;
    const guardrailCount = data.inserted?.guardrailQuestionTests || 0;
    const promptCount = data.inserted?.prompt ? 1 : 0;
    setStatus(`Seeded ${knowledgeCount} knowledge entries, ${guardrailCount} guardrail questions, and ${promptCount} prompt.`);
    loadKnowledge(selectedKey);
    loadPrompt(selectedKey);
  };

  const seedAllDefaults = async () => {
    const confirmed = window.confirm('Are you sure you want to reseed defaults for all industries?');
    if (!confirmed) return;
    const resp = await fetch('/api/v1/admin/industries?mode=seedAll', {
      method: 'POST'
    });
    if (!resp.ok) {
      setStatus('Seed all failed.');
      return;
    }
    setStatus('Seeded defaults for all industries.');
    loadIndustries();
    if (selectedKey) {
      loadPrompt(selectedKey);
      loadKnowledge(selectedKey);
    }
  };

  const industryOptions = useMemo(() => industries.map((item) => (
    <button
      key={item.key}
      className={cn(
        'block rounded-md border px-3 py-2 text-left text-sm hover:bg-slate-50',
        selectedKey === item.key ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white'
      )}
      onClick={() => setSelectedKey(item.key)}
    >
      {item.name}
    </button>
  )), [industries, selectedKey]);

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Industry Config</h1>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[320px_1fr]">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Industries</h2>
          <div className="grid gap-1.5 pb-1">
            {industryOptions}
          </div>
          <div className="my-3 h-px bg-slate-200"></div>
          <h3 className="m-0 mb-2 text-base font-semibold">Add Industry</h3>
          <label>Name</label>
          <input
            value={industryName}
            onChange={(event) => {
              const nextName = event.target.value;
              setIndustryName(nextName);
              if (!industryKey) {
                setIndustryKey(slugify(nextName));
              }
            }}
            placeholder="Plumbing"
          />
          <label className="mt-2.5">Key</label>
          <input value={industryKey} onChange={(event) => setIndustryKey(event.target.value)} placeholder="plumbing" />
          <div className="mt-3 flex gap-2">
            <Button onClick={createIndustry}>Save Industry</Button>
            <Button variant="outline" onClick={seedAllDefaults}>Seed All Defaults</Button>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Agent Prompt &amp; Behavior</h2>
            <p className="text-sm text-slate-500">This prompt is applied to every tenant in the selected industry.</p>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} style={{ minHeight: 180 }} />
            <div className="mt-2 flex flex-wrap gap-2">
              {promptTemplates.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  type="button"
                  onClick={() => setPrompt(template.text)}
                >
                  {template.label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={savePrompt}>Save Prompt</Button>
              <Button variant="outline" onClick={applyPromptToTenants}>Apply to All Tenants</Button>
              <span className="text-sm text-slate-500">{status}</span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Industry Knowledge Defaults</h2>
                <p className="mt-1 text-sm text-slate-500">These are the structured defaults that seed onboarding and runtime knowledge for this industry.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={seedDefaults}>Seed Default Knowledge</Button>
                <Button variant="outline" onClick={applyKnowledgeToTenants}>Apply to Tenants</Button>
                <Button onClick={saveKnowledge}>Save Knowledge</Button>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
              <section className="rounded-xl border border-slate-200 p-3">
                <h3 className="m-0 mb-2 text-base font-semibold">Knowledge Entries</h3>
                <div className="grid gap-3">
                  {knowledgeEntries.map((entry, index) => (
                    <div key={entry.sectionType || index} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-2 text-sm font-semibold text-slate-900">{entry.title}</div>
                      <textarea
                        value={entry.contentText || ''}
                        onChange={(event) => {
                          const next = [...knowledgeEntries];
                          next[index] = { ...entry, contentText: event.target.value };
                          setKnowledgeEntries(next);
                        }}
                        placeholder={`Add ${String(entry.title || 'knowledge').toLowerCase()} guidance.`}
                        style={{ minHeight: 110 }}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 p-3">
                <h3 className="m-0 mb-2 text-base font-semibold">Guardrail Questions</h3>
                <div className="grid gap-3">
                  {guardrailQuestionTests.map((item, index) => (
                    <div key={item.questionText || index} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{item.questionText}</div>
                        <span className="badge">{String(item.riskLevel || 'high').toUpperCase()}</span>
                      </div>
                      <textarea
                        value={item.answer || ''}
                        onChange={(event) => {
                          const next = [...guardrailQuestionTests];
                          next[index] = { ...item, answer: event.target.value };
                          setGuardrailQuestionTests(next);
                        }}
                        placeholder="Add the approved answer for this guardrail question."
                        style={{ minHeight: 120 }}
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="my-3 h-px bg-slate-200"></div>
            <h3 className="m-0 mb-2 text-base font-semibold">Copy From Industry</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <label>Source Industry</label>
                <select value={copyFromKey} onChange={(event) => setCopyFromKey(event.target.value)}>
                  <option value="">Select industry</option>
                  {industries.map((item) => (
                    <option key={item.key} value={item.key}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={copyFromIndustry}>Copy Prompt + Knowledge</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
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
  const [faqs, setFaqs] = useState([]);
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [faqCategory, setFaqCategory] = useState('');
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

  const loadFaqs = (key) => {
    if (!key) return;
    fetch(`/api/v1/admin/industries?mode=faqs&industryKey=${encodeURIComponent(key)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setFaqs(data?.faqs || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadIndustries();
  }, []);

  useEffect(() => {
    if (!selectedKey) return;
    loadPrompt(selectedKey);
    loadFaqs(selectedKey);
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
    setStatus(`Applied to ${data.updated || 0} tenants.`);
  };

  const applyFaqsToTenants = async () => {
    if (!selectedKey) return;
    const resp = await fetch(`/api/v1/admin/industries?mode=applyFaqs&industryKey=${encodeURIComponent(selectedKey)}`, {
      method: 'POST'
    });
    if (!resp.ok) {
      setStatus('Apply FAQs failed.');
      return;
    }
    const data = await resp.json();
    setStatus(`Applied FAQs to ${data.updated || 0} tenants.`);
  };

  const addFaq = async () => {
    if (!faqQuestion.trim() || !faqAnswer.trim()) {
      setStatus('Question and answer are required.');
      return;
    }
    const resp = await fetch(`/api/v1/admin/industries?mode=faqs&industryKey=${encodeURIComponent(selectedKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: faqQuestion, answer: faqAnswer, category: faqCategory })
    });
    if (!resp.ok) {
      setStatus('FAQ save failed.');
      return;
    }
    setFaqQuestion('');
    setFaqAnswer('');
    setFaqCategory('');
    loadFaqs(selectedKey);
    setStatus('FAQ saved.');
  };

  const deleteFaq = async (id) => {
    const resp = await fetch(`/api/v1/admin/industries?mode=faqs&id=${id}`, { method: 'DELETE' });
    if (!resp.ok) return;
    loadFaqs(selectedKey);
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
    loadFaqs(selectedKey);
    setStatus('Copied configuration.');
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
    if (data.skipped) {
      setStatus('Defaults already exist for this industry.');
    } else {
      const faqCount = data.inserted?.faqs || 0;
      const promptCount = data.inserted?.prompt ? 1 : 0;
      setStatus(`Seeded ${faqCount} FAQs and ${promptCount} prompt.`);
      loadFaqs(selectedKey);
      loadPrompt(selectedKey);
    }
  };

  const seedAllDefaults = async () => {
    const confirmed = window.confirm('Are you sure you want to seed defaults for all industries?');
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
      loadFaqs(selectedKey);
      loadPrompt(selectedKey);
    }
  };

  const rows = faqs.map((faq) => ({
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    category: faq.category
  }));

  const columns = [
    { field: 'question', headerName: 'Question', flex: 1.2, minWidth: 180 },
    { field: 'answer', headerName: 'Answer', flex: 1.6, minWidth: 240 },
    { field: 'category', headerName: 'Category', flex: 0.6, minWidth: 120 },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 120,
      renderCell: (params) => (
        <Button variant="outline" size="sm" onClick={() => deleteFaq(params.row.id)}>Delete</Button>
      )
    }
  ];

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
        <div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Agent Prompt & Behavior</h2>
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
          <div className="mt-3 rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mb-2 mt-0 text-lg font-semibold">Industry FAQs</h2>
            <div style={{ height: rows.length ? 'auto' : 240 }}>
              <DataGrid
                rows={rows}
                columns={columns}
                autoHeight
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                localeText={{ noRowsLabel: 'No industry FAQs yet.' }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': { alignItems: 'flex-start', lineHeight: '1.4', whiteSpace: 'normal' },
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 },
                  '& .MuiDataGrid-row': { maxHeight: 'none' }
                }}
              />
            </div>
            <div className="my-3 h-px bg-slate-200"></div>
            <h3 className="m-0 mb-2 text-base font-semibold">Add FAQ</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <label>Question</label>
                <input value={faqQuestion} onChange={(event) => setFaqQuestion(event.target.value)} placeholder="Do you offer emergency service?" />
                <label className="mt-2.5">Category</label>
                <input value={faqCategory} onChange={(event) => setFaqCategory(event.target.value)} placeholder="Emergency" />
              </div>
              <div>
                <label>Answer</label>
                <textarea value={faqAnswer} onChange={(event) => setFaqAnswer(event.target.value)} style={{ minHeight: 120 }}></textarea>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={addFaq}>Save FAQ</Button>
              <Button variant="outline" onClick={applyFaqsToTenants}>Apply FAQs to Tenants</Button>
              <Button variant="outline" onClick={seedDefaults}>Seed Default FAQs</Button>
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
                <Button variant="outline" onClick={copyFromIndustry}>Copy Prompt + FAQs</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

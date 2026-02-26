'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';

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
  const [status, setStatus] = useState('Ready.');

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
        <button className="btn" onClick={() => deleteFaq(params.row.id)}>Delete</button>
      )
    }
  ];

  const industryOptions = useMemo(() => industries.map((item) => (
    <button
      key={item.key}
      className={`menu-link${selectedKey === item.key ? ' active' : ''}`}
      onClick={() => setSelectedKey(item.key)}
    >
      {item.name}
    </button>
  )), [industries, selectedKey]);

  return (
    <section className="screen active">
      <div className="topbar"><h1>Industry Config</h1></div>
      <div className="grid cols-2" style={{ '--grid-cols': '320px 1fr' }}>
        <div className="card">
          <h2>Industries</h2>
          <div className="menu-list" style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {industryOptions}
          </div>
          <div className="divider" style={{ borderTop: '1px solid #e2e8f0', margin: '12px 0' }}></div>
          <h3 style={{ margin: '0 0 8px' }}>Add Industry</h3>
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
          <label style={{ marginTop: 10 }}>Key</label>
          <input value={industryKey} onChange={(event) => setIndustryKey(event.target.value)} placeholder="plumbing" />
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn brand" onClick={createIndustry}>Save Industry</button>
          </div>
        </div>
        <div>
          <div className="card">
            <h2>Agent Prompt & Behavior</h2>
            <p className="muted">This prompt is applied to every tenant in the selected industry.</p>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} style={{ minHeight: 180 }} />
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn brand" onClick={savePrompt}>Save Prompt</button>
              <span className="muted">{status}</span>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="topbar" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Industry FAQs</h2>
            </div>
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
            <div className="divider" style={{ borderTop: '1px solid #e2e8f0', margin: '12px 0' }}></div>
            <h3 style={{ margin: '0 0 8px' }}>Add FAQ</h3>
            <div className="grid cols-2">
              <div>
                <label>Question</label>
                <input value={faqQuestion} onChange={(event) => setFaqQuestion(event.target.value)} placeholder="Do you offer emergency service?" />
                <label style={{ marginTop: 10 }}>Category</label>
                <input value={faqCategory} onChange={(event) => setFaqCategory(event.target.value)} placeholder="Emergency" />
              </div>
              <div>
                <label>Answer</label>
                <textarea value={faqAnswer} onChange={(event) => setFaqAnswer(event.target.value)} style={{ minHeight: 120 }}></textarea>
              </div>
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn brand" onClick={addFaq}>Save FAQ</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

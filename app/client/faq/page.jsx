'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../components/ui/button';
import ClientPage from '../_components/ClientPage';

export default function FaqPage() {
  const [faqs, setFaqs] = useState([]);
  const [status, setStatus] = useState({ message: 'Loading FAQs...', tone: 'warn' });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('We serve the greater metro area and nearby suburbs. Call with your address and we will confirm coverage.');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [filter, setFilter] = useState('all');

  const loadFaqs = async () => {
    setStatus({ message: 'Loading FAQs...', tone: 'warn' });
    fetch(`/api/v1/faq`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load FAQs.', tone: 'bad' });
          return;
        }
        setFaqs(data.faqs || []);
        setStatus({ message: `Loaded ${data.faqs?.length || 0} FAQ item(s).`, tone: 'ok' });
      })
      .catch(() => setStatus({ message: 'Could not load FAQs.', tone: 'bad' }));
  };

  useEffect(() => {
    loadFaqs();
  }, []);

  const deleteFaq = async (id) => {
    setDeletingId(id);
    const resp = await fetch(`/api/v1/faq?id=${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      setStatus({ message: 'Delete failed. This FAQ may be protected.', tone: 'bad' });
      setDeletingId(null);
      return;
    }
    await loadFaqs();
    setStatus({ message: 'FAQ deleted.', tone: 'ok' });
    setDeletingId(null);
  };

  const saveFaq = async () => {
    if (!question.trim() || !answer.trim()) {
      setStatus({ message: 'Question and answer are required.', tone: 'bad' });
      return;
    }
    setSaving(true);
    setStatus({ message: 'Saving FAQ...', tone: 'warn' });
    const resp = await fetch('/api/v1/faq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim(), answer: answer.trim(), category: category.trim() || 'General' })
    });
    if (!resp.ok) {
      setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
      setSaving(false);
      return;
    }
    setQuestion('');
    setCategory('');
    await loadFaqs();
    setStatus({ message: 'FAQ saved.', tone: 'ok' });
    setSaving(false);
  };

  const counts = useMemo(() => {
    const unresolved = faqs.filter((faq) => Boolean(faq.is_industry_default) && !String(faq.answer || '').trim()).length;
    const industry = faqs.filter((faq) => Boolean(faq.is_industry_default)).length;
    return {
      total: faqs.length,
      unresolved,
      industry
    };
  }, [faqs]);

  const filteredFaqs = useMemo(() => {
    if (filter === 'needs_answer') {
      return faqs.filter((faq) => Boolean(faq.is_industry_default) && !String(faq.answer || '').trim());
    }
    if (filter === 'industry_default') {
      return faqs.filter((faq) => Boolean(faq.is_industry_default));
    }
    return faqs;
  }, [faqs, filter]);

  const rows = filteredFaqs.map((faq) => {
    const needsAnswer = Boolean(faq.is_industry_default) && !String(faq.answer || '').trim();
    const sourceConfidence = Number.isFinite(Number(faq.source_confidence))
      ? `${Math.round(Number(faq.source_confidence) * 100)}%`
      : '-';
    return {
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      updatedAt: faq.updated_at ? new Date(faq.updated_at).toLocaleString() : '',
      deletable: Boolean(faq.deletable),
      isIndustryDefault: Boolean(faq.is_industry_default),
      needsAnswer,
      sourceType: faq.source_type || '-',
      sourceConfidence,
      actionLabel: needsAnswer ? 'Delete Blank' : 'Delete'
    };
  });

  const columns = [
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 140,
      flex: 0.6,
      renderCell: (params) => (
        <span className={`badge ${params.row.needsAnswer ? 'warn' : 'ok'}`}>
          {params.row.needsAnswer ? 'Needs Answer' : 'Ready'}
        </span>
      )
    },
    { field: 'question', headerName: 'Question', flex: 1.2, minWidth: 180 },
    { field: 'answer', headerName: 'Answer', flex: 1.6, minWidth: 240 },
    { field: 'category', headerName: 'Category', flex: 0.6, minWidth: 120 },
    {
      field: 'sourceType',
      headerName: 'Source',
      minWidth: 150,
      flex: 0.6,
      renderCell: (params) => (
        <span className="text-xs text-slate-600">{params.row.sourceType}</span>
      )
    },
    {
      field: 'sourceConfidence',
      headerName: 'Evidence',
      minWidth: 110,
      flex: 0.4,
      renderCell: (params) => (
        <span className="text-xs text-slate-600">{params.row.sourceConfidence}</span>
      )
    },
    { field: 'updatedAt', headerName: 'Last Updated', flex: 0.7, minWidth: 160 },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 140,
      renderCell: (params) => (
        <Button
          variant="outline"
          disabled={!params.row.deletable || deletingId === params.row.id}
          onClick={() => deleteFaq(params.row.id)}
        >
          {deletingId === params.row.id ? 'Deleting...' : params.row.actionLabel}
        </Button>
      )
    }
  ];

  return (
    <ClientPage
      title="FAQ Manager"
      subtitle="Resolve blank defaults first, then keep caller answers clear and current."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save FAQ', brand: true, onClick: saveFaq, disabled: saving }}
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total FAQs</div>
          <div className="text-2xl font-bold">{counts.total}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Industry Defaults</div>
          <div className="text-2xl font-bold">{counts.industry}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Needs Answer</div>
          <div className="text-2xl font-bold text-amber-700">{counts.unresolved}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>All</Button>
        <Button variant={filter === 'industry_default' ? 'default' : 'outline'} onClick={() => setFilter('industry_default')}>Industry Defaults</Button>
        <Button variant={filter === 'needs_answer' ? 'default' : 'outline'} onClick={() => setFilter('needs_answer')}>Needs Answer</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[7fr_3fr]">
        <div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Current FAQs</h2>
            <div style={{ height: rows.length ? 'auto' : 300 }}>
              <DataGrid
                rows={rows}
                columns={columns}
                autoHeight
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                localeText={{ noRowsLabel: 'No FAQs yet.' }}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-cell': { alignItems: 'flex-start', lineHeight: '1.4', whiteSpace: 'normal' },
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
                  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 },
                  '& .MuiDataGrid-row': { maxHeight: 'none' }
                }}
              />
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-border bg-card p-3 shadow-sm" id="new-faq">
            <h2 className="mt-0 text-lg font-semibold">New FAQ</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <label>Question</label>
                <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What areas do you serve?" />
                <label className="mt-2.5">Category</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Service Area" />
              </div>
              <div>
                <label>Answer</label>
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ minHeight: 120 }}></textarea>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={saveFaq} disabled={saving}>{saving ? 'Saving...' : 'Save FAQ'}</Button>
              <Button variant="outline" onClick={() => { setQuestion(''); setCategory(''); }}>Reset</Button>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h2 className="mt-0 text-lg font-semibold">Help</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-500">
            <li>Resolve all <code>Needs Answer</code> rows before enabling assistant.</li>
            <li>Blank industry defaults can be answered or deleted.</li>
            <li>These answers are used by the receptionist during live calls.</li>
            <li>Keep responses short, clear, and easy to say out loud.</li>
          </ul>
        </div>
      </div>
    </ClientPage>
  );
}

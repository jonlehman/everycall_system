'use client';

import { useEffect, useRef, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { useSearchParams } from 'next/navigation';

export default function FaqPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [faqs, setFaqs] = useState([]);
  const [status, setStatus] = useState('Ready.');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('We serve the greater metro area and nearby suburbs. Call with your address and we will confirm coverage.');
  const [category, setCategory] = useState('');
  const gridRef = useRef(null);

  const loadFaqs = () => {
    setStatus('Loading FAQs...');
    fetch(`/api/v1/faq?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data) return;
        setFaqs(data.faqs || []);
        setStatus('Loaded FAQs.');
      })
      .catch(() => setStatus('Failed to load FAQs.'));
  };

  useEffect(() => {
    loadFaqs();
  }, [tenantKey]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.style.gridTemplateColumns = '7fr 3fr';
    }
  }, []);

  const deleteFaq = async (id) => {
    const resp = await fetch(`/api/v1/faq?tenantKey=${encodeURIComponent(tenantKey)}&id=${id}`, { method: 'DELETE' });
    if (!resp.ok) return;
    loadFaqs();
    setStatus('Deleted FAQ.');
  };

  const saveFaq = async () => {
    if (!question.trim() || !answer.trim()) {
      setStatus('Question and answer are required.');
      return;
    }
    const resp = await fetch('/api/v1/faq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantKey, question: question.trim(), answer: answer.trim(), category: category.trim() || 'General' })
    });
    if (!resp.ok) {
      setStatus('Save failed.');
      return;
    }
    setQuestion('');
    setCategory('');
    loadFaqs();
    setStatus('FAQ saved.');
  };

  const rows = faqs.map((faq) => ({
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    category: faq.category,
    updatedAt: faq.updated_at ? new Date(faq.updated_at).toLocaleString() : '',
    deletable: Boolean(faq.deletable)
  }));

  const columns = [
    { field: 'question', headerName: 'Question', flex: 1.2, minWidth: 180 },
    { field: 'answer', headerName: 'Answer', flex: 1.6, minWidth: 240 },
    { field: 'category', headerName: 'Category', flex: 0.6, minWidth: 120 },
    { field: 'updatedAt', headerName: 'Last Updated', flex: 0.7, minWidth: 160 },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      minWidth: 120,
      renderCell: (params) => (
        <button
          className="btn delete-faq"
          disabled={!params.row.deletable}
          onClick={() => deleteFaq(params.row.id)}
        >
          Delete
        </button>
      )
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Customer Questions and Answers</h1>
        <div className="top-actions"></div>
      </div>
      <div ref={gridRef} className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div>
          <div className="card">
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
          <div className="card" style={{ marginTop: 12 }}>
            <div className="topbar" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>New FAQ</h2>
              <div className="top-actions"><span className="muted">{status}</span></div>
            </div>
            <div className="grid cols-2">
              <div>
                <label>Question</label>
                <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What areas do you serve?" />
                <label style={{ marginTop: 10 }}>Category</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Service Area" />
              </div>
              <div>
                <label>Answer</label>
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ minHeight: 120 }}></textarea>
              </div>
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn brand" onClick={saveFaq}>Save FAQ</button>
              <button className="btn" onClick={() => { setQuestion(''); setCategory(''); }}>Reset</button>
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Help</h2>
          <p className="muted">These answers are used by the receptionist to respond instantly. Keep them concise, accurate, and updated as your policies and coverage change.</p>
        </div>
      </div>
    </section>
  );
}

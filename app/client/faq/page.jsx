'use client';

import { useEffect, useState } from 'react';
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
        <Button
          variant="outline"
          disabled={!params.row.deletable || deletingId === params.row.id}
          onClick={() => deleteFaq(params.row.id)}
        >
          {deletingId === params.row.id ? 'Deleting...' : 'Delete'}
        </Button>
      )
    }
  ];

  return (
    <ClientPage
      title="FAQ Manager"
      subtitle="Keep caller answers clear and current. Save one change at a time."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save FAQ', brand: true, onClick: saveFaq, disabled: saving }}
    >
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
            <li>These answers are used by the receptionist during live calls.</li>
            <li>Keep responses short, clear, and easy to say out loud.</li>
            <li>Update items when service area, hours, or policies change.</li>
            <li>Use categories to group similar questions for faster edits.</li>
          </ul>
        </div>
      </div>
    </ClientPage>
  );
}

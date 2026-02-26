'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function FaqPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [faqs, setFaqs] = useState([]);
  const [status, setStatus] = useState('Ready.');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('We serve the greater metro area and nearby suburbs. Call with your address and we will confirm coverage.');
  const [category, setCategory] = useState('');

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

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Customer Questions and Answers</h1>
        <div className="top-actions"></div>
      </div>
      <div className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div>
          <div className="card">
            <table className="table">
              <thead><tr><th>Question</th><th>Answer</th><th>Category</th><th>Last Updated</th><th></th></tr></thead>
              <tbody>
                {faqs.length === 0 ? (
                  <tr><td colSpan="5" className="muted">No FAQs yet.</td></tr>
                ) : faqs.map((faq) => (
                  <tr key={faq.id} data-deletable={String(Boolean(faq.deletable))}>
                    <td>{faq.question}</td>
                    <td>{faq.answer}</td>
                    <td>{faq.category}</td>
                    <td>{faq.updated_at ? new Date(faq.updated_at).toLocaleString() : ''}</td>
                    <td>
                      <input type="hidden" value={faq.deletable ? '1' : '0'} />
                      <button className="btn delete-faq" disabled={!faq.deletable} onClick={() => deleteFaq(faq.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

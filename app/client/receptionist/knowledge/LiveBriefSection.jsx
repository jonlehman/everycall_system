'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';

const slots = [
  ['hours', 'Hours'], ['service_area', 'Service area'], ['services', 'Services'],
  ['estimate_policy', 'Estimate policy'], ['emergency_policy', 'Emergency policy'],
  ['approved_prices', 'Tenant-approved prices'], ['trade_faq', 'Trade FAQ']
];

export default function LiveBriefSection() {
  const [brief, setBrief] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [priceApproval, setPriceApproval] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const reload = async () => {
    const response = await fetch('/api/v1/knowledge/live-brief').catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data?.ok) { setMessage('Could not load the Live brief.'); return; }
    setBrief(data.brief);
    setDrafts(Object.fromEntries(slots.map(([key]) => [key, data.brief?.slots?.[key]?.text || ''])));
    setPriceApproval(false);
  };

  useEffect(() => { void reload(); }, []);

  const submit = async (slot, action) => {
    if (!brief) return;
    setBusy(slot);
    setMessage('Checking the wording and evidence...');
    const text = drafts[slot] || '';
    const response = await fetch('/api/v1/knowledge/live-brief', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, slot, text, expected_revision: brief.revision,
        ...(slot === 'approved_prices' && action === 'edit'
          ? { price_authorization: { confirmed: priceApproval, text } } : {}) })
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data?.ok) {
      setMessage(data?.error === 'live_brief_revision_conflict'
        ? 'This brief changed elsewhere. Reload before editing.'
        : 'The brief was not changed. Check its evidence, length, and wording.');
      setBusy('');
      return;
    }
    setBrief(data.brief);
    setDrafts(Object.fromEntries(slots.map(([key]) => [key, data.brief?.slots?.[key]?.text || ''])));
    setPriceApproval(false);
    setMessage('Live brief saved.');
    setBusy('');
  };

  if (!brief) return <p className="text-sm text-slate-600">No active curated Live brief yet. Publish a new knowledge build to prepare one.</p>;
  return <div className="grid gap-4">
    <p className="text-sm text-slate-600">Only these approved lines are given to Live by heart. Other business facts remain available through Luna. Your edits are preserved; a future crawl proposes changes for your review.</p>
    {slots.map(([key, label]) => {
      const current = brief.slots?.[key] || {};
      const proposal = brief.proposals?.[key];
      return <div key={key} className="rounded-lg border border-slate-200 p-3">
        <label htmlFor={`live-brief-${key}`} className="font-semibold">{label}</label>
        <textarea id={`live-brief-${key}`} value={drafts[key] || ''} maxLength={200}
          onChange={(event) => setDrafts((existing) => ({ ...existing, [key]: event.target.value }))}
          rows={key === 'trade_faq' ? 3 : 2} className="mt-2 w-full" />
        <p className="mt-1 text-xs text-slate-500">{current.tenant_edited ? 'Tenant-edited' : (current.source_refs || []).map((source) => `${source.url} · ${new Date(source.crawled_at).toLocaleDateString()}`).join('; ') || 'Empty'}</p>
        {key === 'approved_prices' && drafts[key]?.trim() ? <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={priceApproval} onChange={(event) => setPriceApproval(event.target.checked)} />
          I authorize this exact price wording and its conditions for callers.
        </label> : null}
        <div className="mt-2 flex gap-2">
          <Button type="button" variant="outline" disabled={Boolean(busy) || (key === 'approved_prices' && Boolean(drafts[key]?.trim()) && !priceApproval)} onClick={() => submit(key, 'edit')}>Save line</Button>
          {proposal ? <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => submit(key, 'accept_proposal')}>Accept proposed update</Button> : null}
        </div>
        {proposal ? <p className="mt-2 text-sm text-slate-600">Proposed: {proposal.text || '(remove this line)'}</p> : null}
      </div>;
    })}
    <p role="status" className="text-sm text-slate-600">{message}</p>
  </div>;
}

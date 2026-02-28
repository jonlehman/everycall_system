'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DataGrid } from '@mui/x-data-grid';

export default function TenantManagePage() {
  const params = useParams();
  const tenantKey = params.tenantKey;
  const voiceOptions = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
  const [tenant, setTenant] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [greetingText, setGreetingText] = useState('');
  const [voiceType, setVoiceType] = useState('alloy');
  const [status, setStatus] = useState('Idle');
  const [users, setUsers] = useState([]);
  const [composedPrompt, setComposedPrompt] = useState('');
  const [editing, setEditing] = useState({ status: '', plan: '', data_region: '', primary_number: '', industry: '' });
  const [industries, setIndustries] = useState([]);
  const [faqs, setFaqs] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/tenants?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted) return;
        setTenant(data?.tenant || null);
        if (data?.tenant) {
          setEditing({
            status: data.tenant.status || 'active',
            plan: data.tenant.plan || 'Growth',
            data_region: data.tenant.data_region || 'US',
            primary_number: data.tenant.primary_number || '',
            industry: data.tenant.industry || ''
          });
        }
      })
      .catch(() => {});

    fetch(`/api/v1/config/agent?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted) return;
        setPrompt(data?.tenantPromptOverride || data?.systemPrompt || '');
        setGreetingText(data?.greetingText || '');
        setVoiceType(data?.voiceType || 'alloy');
      })
      .catch(() => {});

    fetch(`/api/v1/config/agent?mode=preview&tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setComposedPrompt(data?.composedPrompt || ''); })
      .catch(() => {});

    fetch(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setUsers(data?.users || []); })
      .catch(() => {});

    fetch('/api/v1/admin/industries')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setIndustries(data?.industries || []); })
      .catch(() => {});

    fetch(`/api/v1/faq?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setFaqs(data?.faqs || []); })
      .catch(() => {});

    return () => { mounted = false; };
  }, [tenantKey]);

  const savePrompt = async () => {
    setStatus('Saving...');
    const resp = await fetch('/api/v1/config/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantKey, systemPrompt: prompt, greetingText, voiceType })
    });
    if (!resp.ok) {
      setStatus('Save failed.');
      return;
    }
    setStatus('Saved.');
    fetch(`/api/v1/config/agent?mode=preview&tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setComposedPrompt(data?.composedPrompt || ''))
      .catch(() => {});
  };

  const saveTenantDetails = async () => {
    setStatus('Saving tenant...');
    const resp = await fetch('/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey,
        name: tenant?.name || tenantKey,
        status: editing.status,
        plan: editing.plan,
        dataRegion: editing.data_region,
        primaryNumber: editing.primary_number
        ,industry: editing.industry || null
      })
    });
    setStatus(resp.ok ? 'Tenant saved.' : 'Save failed.');
  };

  const toggleTenantStatus = async () => {
    const nextStatus = (editing.status === 'active') ? 'paused' : 'active';
    setEditing({ ...editing, status: nextStatus });
    setStatus('Updating status...');
    const resp = await fetch('/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey,
        name: tenant?.name || tenantKey,
        status: nextStatus,
        plan: editing.plan,
        dataRegion: editing.data_region,
        primaryNumber: editing.primary_number,
        industry: editing.industry || null
      })
    });
    setStatus(resp.ok ? `Tenant ${nextStatus}.` : 'Update failed.');
  };

  const importIndustryPrompt = async () => {
    if (!editing.industry) {
      setStatus('Set an industry first.');
      return;
    }
    setStatus('Importing prompt...');
    const resp = await fetch(`/api/v1/admin/industries?mode=importPrompt&industryKey=${encodeURIComponent(editing.industry)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantKey })
    });
    if (!resp.ok) {
      setStatus('Import prompt failed.');
      return;
    }
    setStatus('Prompt imported.');
    fetch(`/api/v1/config/agent?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setPrompt(data?.tenantPromptOverride || data?.systemPrompt || ''))
      .catch(() => {});
    fetch(`/api/v1/config/agent?mode=preview&tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setComposedPrompt(data?.composedPrompt || ''))
      .catch(() => {});
  };

  const importIndustryFaqs = async () => {
    if (!editing.industry) {
      setStatus('Set an industry first.');
      return;
    }
    setStatus('Importing FAQs...');
    const resp = await fetch(`/api/v1/admin/industries?mode=importFaqs&industryKey=${encodeURIComponent(editing.industry)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantKey })
    });
    if (!resp.ok) {
      setStatus('Import FAQs failed.');
      return;
    }
    setStatus('FAQs imported.');
    fetch(`/api/v1/faq?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setFaqs(data?.faqs || []))
      .catch(() => {});
  };

  const rows = users.map((u, idx) => ({
    id: u.id || idx,
    name: u.name,
    email: u.email,
    phone: u.phone_number || '',
    role: u.role,
    status: u.status,
    smsOptIn: u.sms_opt_in_status || 'not_requested'
  }));

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 140 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
    { field: 'phone', headerName: 'Phone', flex: 0.8, minWidth: 140 },
    { field: 'role', headerName: 'Role', flex: 0.6, minWidth: 120 },
    {
      field: 'smsOptIn',
      headerName: 'SMS Opt-In',
      flex: 0.6,
      minWidth: 140,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'opted_in' ? 'ok' : params.value === 'pending' ? 'warn' : 'bad'}`}>
          {params.value}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.6,
      minWidth: 120,
      renderCell: (params) => (
        <span className={`badge ${params.value === 'active' ? 'ok' : 'warn'}`}>{params.value}</span>
      )
    }
  ];

  return (
    <section className="screen active">
      <div className="topbar">
        <div>
          <div className="eyebrow">Manage Tenant</div>
          <h1>{tenant?.name || tenantKey}</h1>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={toggleTenantStatus}>
            {editing.status === 'active' ? 'Pause Tenant' : 'Resume Tenant'}
          </button>
          <button className="btn brand" onClick={saveTenantDetails}>Save Tenant</button>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <label>Tenant Details</label>
          <div className="kv">
            <div>Status</div>
            <div>
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div>Data Region</div>
            <div>
              <select value={editing.data_region} onChange={(e) => setEditing({ ...editing, data_region: e.target.value })}>
                <option value="US">US</option>
                <option value="EU">EU</option>
              </select>
            </div>
            <div>Primary Number</div>
            <div>
              <input value={editing.primary_number} onChange={(e) => setEditing({ ...editing, primary_number: e.target.value })} />
            </div>
            <div>Plan</div>
            <div>
              <select value={editing.plan} onChange={(e) => setEditing({ ...editing, plan: e.target.value })}>
                <option value="Trial">Trial</option>
                <option value="Growth">Growth</option>
                <option value="Enterprise">Enterprise</option>
              </select>
            </div>
            <div>Industry</div>
            <div>
              <select value={editing.industry || ''} onChange={(e) => setEditing({ ...editing, industry: e.target.value })}>
                <option value="">Unassigned</option>
                {industries.map((item) => (
                  <option key={item.key} value={item.key}>{item.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn brand" onClick={saveTenantDetails}>Save Tenant Details</button>
            <span className="muted">{status}</span>
          </div>
        </div>
        <div className="card">
          <label>Agent Prompt &amp; Behavior</label>
          <p className="muted">This is the tenant override prompt. Final prompt is composed at runtime.</p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 180 }}></textarea>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn brand" onClick={savePrompt}>Save Prompt</button>
            <button className="btn" onClick={importIndustryPrompt}>Import Industry Prompt</button>
            <button className="btn" onClick={importIndustryFaqs}>Import Industry FAQs</button>
            <span className="muted">{status}</span>
          </div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <label>Agent Greeting</label>
          <textarea
            value={greetingText}
            onChange={(e) => setGreetingText(e.target.value)}
            placeholder="Hi, thanks for calling..."
            style={{ minHeight: 110 }}
          />
          <label style={{ marginTop: 10 }}>Voice Type</label>
          <select value={voiceType} onChange={(e) => setVoiceType(e.target.value)}>
            {voiceOptions.map((voice) => (
              <option key={voice} value={voice}>{voice}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <label>Final Prompt Preview</label>
        <textarea value={composedPrompt} readOnly style={{ minHeight: 220 }}></textarea>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <label>Client Users</label>
        <DataGrid
          rows={rows}
          columns={columns}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No users yet.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <label>Current FAQs</label>
        <DataGrid
          rows={faqs.map((faq) => ({
            id: faq.id,
            question: faq.question,
            answer: faq.answer,
            category: faq.category
          }))}
          columns={[
            { field: 'question', headerName: 'Question', flex: 1.2, minWidth: 200 },
            { field: 'answer', headerName: 'Answer', flex: 1.8, minWidth: 300 },
            { field: 'category', headerName: 'Category', flex: 0.6, minWidth: 140 }
          ]}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No FAQs yet.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>
    </section>
  );
}

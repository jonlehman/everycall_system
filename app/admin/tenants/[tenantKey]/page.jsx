'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DataGrid } from '@mui/x-data-grid';
import { Button } from '../../../../components/ui/button';

export default function TenantManagePage() {
  const params = useParams();
  const router = useRouter();
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
  const [provisioningJobs, setProvisioningJobs] = useState([]);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

    fetch(`/api/v1/admin/jobs?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => { if (mounted) setProvisioningJobs(data?.jobs || []); })
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

  const deleteTenant = async () => {
    const label = tenant?.name || tenantKey;
    const confirmed = window.confirm(`Delete tenant "${label}" and all associated data? This cannot be undone.`);
    if (!confirmed) return;

    setDeleteBusy(true);
    setStatus('Deleting tenant...');
    try {
      const resp = await fetch(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        setStatus(data?.message || data?.error || 'Delete failed.');
        setDeleteBusy(false);
        return;
      }
      setStatus('Tenant deleted. Redirecting...');
      setTimeout(() => {
        router.push('/admin/tenants');
      }, 500);
    } catch (err) {
      setStatus(err?.message || 'Delete failed.');
      setDeleteBusy(false);
    }
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
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Manage Tenant</div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{tenant?.name || tenantKey}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={deleteTenant} disabled={deleteBusy}>
            {deleteBusy ? 'Deleting...' : 'Delete Tenant'}
          </Button>
          <Button variant="outline" onClick={toggleTenantStatus}>
            {editing.status === 'active' ? 'Pause Tenant' : 'Resume Tenant'}
          </Button>
          <Button onClick={saveTenantDetails}>Save Tenant</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
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
            <div>Voice Status</div>
            <div>{tenant?.telnyx_voice_status || 'unknown'}</div>
            <div>Voice Number</div>
            <div>{tenant?.telnyx_voice_number || 'Not assigned'}</div>
            <div>Voice Order ID</div>
            <div>{tenant?.telnyx_voice_order_id || 'None'}</div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={saveTenantDetails}>Save Tenant Details</Button>
            <span className="text-sm text-slate-500">{status}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <label>Agent Prompt &amp; Behavior</label>
          <p className="text-sm text-slate-500">This is the tenant override prompt. Final prompt is composed at runtime.</p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 180 }}></textarea>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={savePrompt}>Save Prompt</Button>
            <Button variant="outline" onClick={importIndustryPrompt}>Import Industry Prompt</Button>
            <Button variant="outline" onClick={importIndustryFaqs}>Import Industry FAQs</Button>
            <span className="text-sm text-slate-500">{status}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
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

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <label>Final Prompt Preview</label>
        <textarea value={composedPrompt} readOnly style={{ minHeight: 220 }}></textarea>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
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

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <label>Provisioning Log</label>
        <DataGrid
          rows={provisioningJobs.map((job, idx) => ({
            id: job.id ?? `${job.stage || 'stage'}-${job.updated_at || idx}`,
            stage: job.stage,
            status: job.status,
            detail: job.status_detail || '',
            provider: job.provider || '',
            providerReference: job.provider_reference || '',
            errorCode: job.error_code || '',
            errorMessage: job.error_message || '',
            attempted: job.attempted_at ? new Date(job.attempted_at).toLocaleString() : '',
            completed: job.completed_at ? new Date(job.completed_at).toLocaleString() : '',
            updated: job.updated_at ? new Date(job.updated_at).toLocaleString() : ''
          }))}
          columns={[
            { field: 'stage', headerName: 'Stage', flex: 0.7, minWidth: 140 },
            {
              field: 'status',
              headerName: 'Status',
              flex: 0.5,
              minWidth: 120,
              renderCell: (params) => (
                <span className={`badge ${params.value === 'done' ? 'ok' : params.value === 'failed' ? 'bad' : 'warn'}`}>{params.value}</span>
              )
            },
            { field: 'detail', headerName: 'Detail', flex: 1.4, minWidth: 220 },
            { field: 'errorCode', headerName: 'Error Code', flex: 0.9, minWidth: 160 },
            { field: 'errorMessage', headerName: 'Error Message', flex: 1.6, minWidth: 260 },
            { field: 'provider', headerName: 'Provider', flex: 0.6, minWidth: 110 },
            { field: 'providerReference', headerName: 'Provider Ref', flex: 0.9, minWidth: 160 },
            { field: 'attempted', headerName: 'Attempted', flex: 0.9, minWidth: 180 },
            { field: 'completed', headerName: 'Completed', flex: 0.9, minWidth: 180 },
            { field: 'updated', headerName: 'Updated', flex: 0.9, minWidth: 180 }
          ]}
          autoHeight
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
          localeText={{ noRowsLabel: 'No provisioning log yet.' }}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell': { alignItems: 'center', lineHeight: '1.4' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 }
          }}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
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

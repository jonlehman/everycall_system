'use client';

import { useEffect, useMemo, useState } from 'react';
import './intake.css';

const INDUSTRIES = [
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'garage_door', label: 'Garage Door' },
  { value: 'general_contractor', label: 'General Contractor' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'locksmith', label: 'Locksmith' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'window_installers', label: 'Window Installers' }
];

function createInitialForm(qaMode = false) {
  return {
    businessName: qaMode ? 'Knowledge Receptionist QA Tenant' : '',
    industry: 'plumbing',
    ownerName: qaMode ? 'QA Owner' : '',
    ownerEmail: qaMode ? 'qa-owner@example.com' : '',
    password: qaMode ? 'Password123!' : '',
    confirmPassword: qaMode ? 'Password123!' : '',
    website: '',
    phone: '',
    serviceArea: '',
    address: '',
    timezone: 'America/Los_Angeles',
    businessHours: '',
    greetingText: '',
    bootstrapMode: 'website_first'
  };
}

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export function IntakePageClient({ qaMode = false } = {}) {
  const initialForm = useMemo(() => createInitialForm(Boolean(qaMode)), [qaMode]);
  const [form, setForm] = useState(initialForm);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState({ message: '', tone: 'normal' });
  const [busy, setBusy] = useState(false);
  const [activation, setActivation] = useState(null);
  const nextHref = '/client/knowledge';

  useEffect(() => {
    if (!activation?.ok) return undefined;
    const timer = window.setTimeout(() => {
      window.location.assign(nextHref);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activation]);

  const setFormValue = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const runPreview = async () => {
    setBusy(true);
    setStatus({ message: 'Previewing bootstrap path...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/tenants/enrichment/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website: form.website,
          industry: form.industry,
          bootstrapMode: form.bootstrapMode
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not preview bootstrap path.', tone: 'bad' });
        return;
      }
      setPreview(data.preview || null);
      setStatus({ message: 'Bootstrap preview ready.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not preview bootstrap path.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.businessName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim()) {
      setStatus({ message: 'Business name, owner name, and owner email are required.', tone: 'bad' });
      return;
    }
    if (!form.password || form.password.length < 8) {
      setStatus({ message: 'Password must be at least 8 characters.', tone: 'bad' });
      return;
    }
    if (form.password !== form.confirmPassword) {
      setStatus({ message: 'Passwords do not match.', tone: 'bad' });
      return;
    }

    setBusy(true);
    setStatus({ message: 'Creating tenant on the new subsystem...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/tenants/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName,
          industry: form.industry,
          ownerName: form.ownerName,
          ownerEmail: form.ownerEmail,
          password: form.password,
          website: form.website,
          phone: form.phone,
          serviceArea: form.serviceArea,
          address: form.address,
          timezone: form.timezone,
          businessHours: form.businessHours,
          greetingText: form.greetingText,
          bootstrapMode: form.bootstrapMode
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not create tenant.', tone: 'bad' });
        return;
      }
      setActivation(data);
      setStatus({ message: 'Tenant created. Redirecting to the Knowledge Workspace...', tone: 'ok' });
    } catch {
      setStatus({ message: 'Could not create tenant.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="intake-shell">
      <div className="intake-page">
        <section className="intake-hero">
          <p className="intake-eyebrow">EveryCall Intake</p>
          <h1>Bootstrap a tenant on the new knowledge/receptionist subsystem</h1>
          <p>No legacy prompt, FAQ, topic, or compatibility setup is created from this flow.</p>
        </section>

        <form className="intake-card" onSubmit={submit}>
          <div className={`intake-status ${status.tone || 'normal'}`}>{status.message || 'Enter tenant details to bootstrap the new subsystem.'}</div>

          <div className="intake-grid">
            <div>
              <label>Business Name</label>
              <input value={form.businessName} onChange={(event) => setFormValue('businessName', event.target.value)} />
            </div>
            <div>
              <label>Industry</label>
              <select value={form.industry} onChange={(event) => setFormValue('industry', event.target.value)}>
                {INDUSTRIES.map((industry) => (
                  <option key={industry.value} value={industry.value}>{industry.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Owner Name</label>
              <input value={form.ownerName} onChange={(event) => setFormValue('ownerName', event.target.value)} />
            </div>
            <div>
              <label>Owner Email</label>
              <input value={form.ownerEmail} onChange={(event) => setFormValue('ownerEmail', event.target.value)} />
            </div>
            <div>
              <label>Password</label>
              <input type="password" value={form.password} onChange={(event) => setFormValue('password', event.target.value)} />
            </div>
            <div>
              <label>Confirm Password</label>
              <input type="password" value={form.confirmPassword} onChange={(event) => setFormValue('confirmPassword', event.target.value)} />
            </div>
            <div>
              <label>Website</label>
              <input value={form.website} onChange={(event) => setFormValue('website', event.target.value)} placeholder="https://example.com" />
            </div>
            <div>
              <label>Bootstrap Mode</label>
              <select value={form.bootstrapMode} onChange={(event) => setFormValue('bootstrapMode', event.target.value)}>
                <option value="website_first">Website First</option>
                <option value="setup_interview">Setup Interview</option>
              </select>
            </div>
            <div>
              <label>Phone</label>
              <input value={form.phone} onChange={(event) => setFormValue('phone', event.target.value)} />
            </div>
            <div>
              <label>Service Area</label>
              <input value={form.serviceArea} onChange={(event) => setFormValue('serviceArea', event.target.value)} />
            </div>
            <div>
              <label>Timezone</label>
              <input value={form.timezone} onChange={(event) => setFormValue('timezone', event.target.value)} />
            </div>
            <div>
              <label>Greeting</label>
              <input value={form.greetingText} onChange={(event) => setFormValue('greetingText', event.target.value)} />
            </div>
          </div>

          <label className="mt-4">Address</label>
          <textarea value={form.address} onChange={(event) => setFormValue('address', event.target.value)} />
          <label className="mt-4">Business Hours</label>
          <textarea value={form.businessHours} onChange={(event) => setFormValue('businessHours', event.target.value)} />

          <div className="intake-actions">
            <button type="button" className="btn secondary" onClick={runPreview} disabled={busy}>Preview Bootstrap</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Working...' : 'Create Tenant'}</button>
          </div>
        </form>

        {preview ? (
          <section className="intake-card">
            <h2>Bootstrap Preview</h2>
            <p><strong>Canonical spec path:</strong> {preview.canonical_spec_path}</p>
            <p><strong>Bootstrap mode:</strong> {preview.bootstrap_mode}</p>
            <p><strong>Assignments:</strong> {(preview.assignments || []).map((item) => `${item.domainId}/${item.subdomainId}`).join(', ') || 'none'}</p>
            <p><strong>Source channels:</strong> {(preview.approved_source_channels || []).join(', ') || 'none'}</p>
            <p><strong>Blockers:</strong> {(preview.blockers || []).join(', ') || 'none'}</p>
          </section>
        ) : null}

        {activation ? (
          <section className="intake-card">
            <h2>Tenant Created</h2>
            <p><strong>Tenant key:</strong> {activation.tenantKey || 'created'}</p>
            <p><strong>Business Call Intent:</strong> {activation.businessCallIntent?.business_call_intent_id || 'created'}</p>
            <p><strong>Runtime profile:</strong> {activation.runtimeProfile?.greeting_text || 'created'}</p>
            <p><strong>Outcome schema:</strong> {activation.callOutcomeSchema?.call_outcome_schema_id || 'created'}</p>
            <p><strong>Next step:</strong> Create and publish the first knowledge build.</p>
            <div className="intake-actions">
              <a className="btn primary" href={nextHref}>Continue to Knowledge Workspace</a>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function IntakePage() {
  return <IntakePageClient />;
}

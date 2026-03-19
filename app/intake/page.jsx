'use client';

import { useEffect, useMemo, useState } from 'react';
import './intake.css';

const BUSINESS_CATEGORIES = [
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'service_business', label: 'Service Business' },
  { value: 'medical', label: 'Medical' },
  { value: 'dental', label: 'Dental' },
  { value: 'therapy_practice', label: 'Therapy Practice' },
  { value: 'legal', label: 'Legal' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'wellness_beauty', label: 'Wellness & Beauty' },
  { value: 'real_estate_property', label: 'Real Estate & Property' },
  { value: 'education_training', label: 'Education & Training' },
  { value: 'retail_showroom', label: 'Retail Showroom' }
];

function createInitialForm(qaMode = false) {
  return {
    businessName: qaMode ? 'Knowledge Receptionist QA Tenant' : '',
    businessCategory: 'professional_services',
    ownerName: qaMode ? 'QA Owner' : '',
    ownerEmail: qaMode ? 'qa-owner@example.com' : '',
    password: qaMode ? 'Password123!' : '',
    confirmPassword: qaMode ? 'Password123!' : '',
    website: '',
    companyDescription: qaMode
      ? 'We build custom software and automation systems for businesses.'
      : ''
  };
}

function fetchJson(url, options) {
  return fetch(url, options).then((resp) => (resp.ok ? resp.json() : resp.json().catch(() => null)));
}

export function IntakePageClient({ qaMode = false } = {}) {
  const initialForm = useMemo(() => createInitialForm(Boolean(qaMode)), [qaMode]);
  const [form, setForm] = useState(initialForm);
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

  const submit = async (event) => {
    event.preventDefault();
    if (!form.businessName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim()) {
      setStatus({ message: 'Business name, owner name, and owner email are required.', tone: 'bad' });
      return;
    }
    if (!form.companyDescription.trim()) {
      setStatus({ message: 'Add a short description of what the business does.', tone: 'bad' });
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
    setStatus({ message: 'Creating tenant...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/tenants/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName,
          businessCategory: form.businessCategory,
          ownerName: form.ownerName,
          ownerEmail: form.ownerEmail,
          password: form.password,
          website: form.website,
          companyDescription: form.companyDescription
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
          <h1>Set up a new tenant</h1>
          <p>Create the account, give Sarah the basic business context, and continue to the Knowledge Workspace.</p>
        </section>

        <form className="intake-card" onSubmit={submit}>
          <div className={`intake-status ${status.tone || 'normal'}`}>
            {status.message || 'Enter the minimum needed to create the tenant and seed the receptionist.'}
          </div>

          <div className="intake-stack">
            <h2 className="intake-section-title">Account</h2>
          </div>

          <div className="intake-grid">
            <div className="intake-stack">
              <label>Business Name</label>
              <input value={form.businessName} onChange={(event) => setFormValue('businessName', event.target.value)} />
            </div>
            <div className="intake-stack">
              <label>Business Category</label>
              <select value={form.businessCategory} onChange={(event) => setFormValue('businessCategory', event.target.value)}>
                {BUSINESS_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </div>
            <div className="intake-stack">
              <label>Owner Name</label>
              <input value={form.ownerName} onChange={(event) => setFormValue('ownerName', event.target.value)} />
            </div>
            <div className="intake-stack">
              <label>Owner Email</label>
              <input value={form.ownerEmail} onChange={(event) => setFormValue('ownerEmail', event.target.value)} />
            </div>
            <div className="intake-stack">
              <label>Password</label>
              <input type="password" value={form.password} onChange={(event) => setFormValue('password', event.target.value)} />
            </div>
            <div className="intake-stack">
              <label>Confirm Password</label>
              <input type="password" value={form.confirmPassword} onChange={(event) => setFormValue('confirmPassword', event.target.value)} />
            </div>
          </div>

          <div className="intake-stack" style={{ marginTop: 18 }}>
            <h2 className="intake-section-title">Business Context</h2>
          </div>

          <div className="intake-grid">
            <div className="intake-stack intake-full">
              <label>Website URL (Optional)</label>
              <input
                value={form.website}
                onChange={(event) => setFormValue('website', event.target.value)}
                placeholder="https://example.com"
              />
              <div className="intake-muted">If available, this will prefill the first website build in the Knowledge Workspace.</div>
            </div>
          </div>

          <div className="intake-stack" style={{ marginTop: 14 }}>
            <label>What does the business do?</label>
            <textarea
              value={form.companyDescription}
              onChange={(event) => setFormValue('companyDescription', event.target.value)}
              placeholder="Describe the business in one or two short sentences."
            />
            <div className="intake-muted">This becomes the initial business context for Sarah until a stronger website build is published.</div>
          </div>

          <div className="intake-actions" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creating...' : 'Create Tenant'}</button>
          </div>
        </form>

        {activation ? (
          <section className="intake-card">
            <h2>Tenant Created</h2>
            <p><strong>Tenant key:</strong> {activation.tenantKey || 'created'}</p>
            <p><strong>Prompt profile:</strong> {activation.promptProfile?.business_name || form.businessName}</p>
            <p><strong>Next step:</strong> Continue to the Knowledge Workspace and create the first build when you are ready.</p>
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

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

const INTAKE_STEPS = [
  {
    key: 'account',
    number: '01',
    title: 'Account Setup',
    navTitle: 'Account Setup',
    heroTitle: 'Initialize Your Account',
    heroCopy: 'Create the business record and owner login that will control the new EveryCall workspace.'
  },
  {
    key: 'context',
    number: '02',
    title: 'Business Context',
    navTitle: 'Business Context',
    heroTitle: 'Add Core Business Context',
    heroCopy: 'Capture the shortest useful description of the business so the receptionist starts with the right baseline.'
  },
  {
    key: 'knowledge',
    number: '03',
    title: 'Knowledge Workspace Setup',
    navTitle: 'Knowledge Workspace Setup',
    heroTitle: 'Confirm The Next Workspace',
    heroCopy: 'Review what happens after creation, then create the account and continue into the knowledge setup flow.'
  }
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

function normalizeWebsiteUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function defaultStatusForStep(stepIndex) {
  if (stepIndex === 0) {
    return { message: 'Set up the business owner login and core account record.', tone: 'normal' };
  }
  if (stepIndex === 1) {
    return { message: 'Add the business website if available, plus a short business description.', tone: 'normal' };
  }
  return { message: 'Create the account and continue directly into the Knowledge Workspace.', tone: 'normal' };
}

function validateAccountStep(form) {
  if (!form.businessName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim()) {
    return 'Business name, owner name, and owner email are required.';
  }
  if (!form.password || form.password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (form.password !== form.confirmPassword) {
    return 'Passwords do not match.';
  }
  return '';
}

function validateContextStep(form) {
  if (!form.companyDescription.trim()) {
    return 'Add a short description of what the business does.';
  }
  return '';
}

function renderSetupSummary(form) {
  return [
    { label: 'Business Name', value: form.businessName.trim() || 'Not entered yet' },
    {
      label: 'Category',
      value: BUSINESS_CATEGORIES.find((category) => category.value === form.businessCategory)?.label || 'Not selected'
    },
    { label: 'Owner Email', value: form.ownerEmail.trim() || 'Not entered yet' },
    { label: 'Website Source', value: form.website.trim() ? normalizeWebsiteUrl(form.website) : 'No website added yet' }
  ];
}

export function IntakePageClient({ qaMode = false } = {}) {
  const initialForm = useMemo(() => createInitialForm(Boolean(qaMode)), [qaMode]);
  const [form, setForm] = useState(initialForm);
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState(defaultStatusForStep(0));
  const [busy, setBusy] = useState(false);
  const [activation, setActivation] = useState(null);
  const nextHref = '/client/knowledge';
  const provisioningFailed = activation?.voiceProvisioning?.ok === false;
  const step = INTAKE_STEPS[currentStep];
  const setupSummary = renderSetupSummary(form);

  useEffect(() => {
    if (!activation?.ok || provisioningFailed) return undefined;
    const timer = window.setTimeout(() => {
      window.location.assign(nextHref);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activation, provisioningFailed]);

  const setFormValue = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const setStepAndResetStatus = (stepIndex) => {
    setCurrentStep(stepIndex);
    setStatus(defaultStatusForStep(stepIndex));
  };

  const moveToNextStep = () => {
    const accountError = validateAccountStep(form);
    if (currentStep === 0 && accountError) {
      setStatus({ message: accountError, tone: 'bad' });
      return;
    }
    const contextError = validateContextStep(form);
    if (currentStep === 1 && contextError) {
      setStatus({ message: contextError, tone: 'bad' });
      return;
    }
    if (currentStep < INTAKE_STEPS.length - 1) {
      setStepAndResetStatus(currentStep + 1);
    }
  };

  const moveToPreviousStep = () => {
    if (currentStep > 0) {
      setStepAndResetStatus(currentStep - 1);
    }
  };

  const submit = async (event) => {
    event.preventDefault();

    const confirmed = window.confirm(
      'Create this account and provision a Sales Receptionist Number? This will create the tenant and may incur provider charges.'
    );
    if (!confirmed) {
      return;
    }

    const accountError = validateAccountStep(form);
    if (accountError) {
      setCurrentStep(0);
      setStatus({ message: accountError, tone: 'bad' });
      return;
    }

    const contextError = validateContextStep(form);
    if (contextError) {
      setCurrentStep(1);
      setStatus({ message: contextError, tone: 'bad' });
      return;
    }

    setBusy(true);
    setStatus({ message: 'Creating account and provisioning phone number...', tone: 'warn' });
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
          website: normalizeWebsiteUrl(form.website),
          companyDescription: form.companyDescription
        })
      });
      if (!data?.ok) {
        setStatus({ message: data?.message || 'Could not create account.', tone: 'bad' });
        return;
      }
      setActivation(data);
      if (data?.voiceProvisioning?.ok === false) {
        setStatus({
          message: `Account created, but phone number provisioning needs follow-up: ${data.voiceProvisioning.errorMessage || 'unknown error'}`,
          tone: 'warn'
        });
      } else if (data?.voiceProvisioning?.phoneNumber) {
        setStatus({
          message: `Account created and ${data.voiceProvisioning.phoneNumber} was provisioned. Redirecting to the Knowledge Workspace...`,
          tone: 'ok'
        });
      } else {
        setStatus({ message: 'Account created. Redirecting to the Knowledge Workspace...', tone: 'ok' });
      }
    } catch {
      setStatus({ message: 'Could not create account.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="intake-shell">
      <header className="intake-topbar">
        <div className="intake-topbar-inner">
          <div className="intake-brand">EveryCall</div>
          <div className="intake-topbar-label">Onboarding</div>
        </div>
      </header>

      <aside className="intake-sidebar">
        <div className="intake-sidebar-head">
          <h2>Onboarding</h2>
          <p>Precision Setup</p>
        </div>
        <nav className="intake-step-list" aria-label="Onboarding steps">
          {INTAKE_STEPS.map((item, index) => {
            const active = index === currentStep;
            const complete = index < currentStep || Boolean(activation?.ok);
            return (
              <button
                key={item.key}
                type="button"
                className={`intake-step-link ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}
                onClick={() => setStepAndResetStatus(index)}
                aria-current={active ? 'step' : undefined}
              >
                <span className="intake-step-number">{item.number}</span>
                <span>{item.navTitle}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="intake-main">
        <div className="intake-canvas">
          <div className="intake-mobile-steps" aria-hidden="true">
            {INTAKE_STEPS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={`intake-mobile-step ${index === currentStep ? 'active' : ''} ${index < currentStep || Boolean(activation?.ok) ? 'complete' : ''}`}
                onClick={() => setStepAndResetStatus(index)}
              >
                {item.number}
              </button>
            ))}
          </div>

          <section className="intake-hero">
            <p className="intake-eyebrow">Step {step.number}</p>
            <h1>{step.heroTitle}</h1>
            <p>{step.heroCopy}</p>
          </section>

          <form className="intake-card" onSubmit={currentStep === INTAKE_STEPS.length - 1 ? submit : (event) => { event.preventDefault(); moveToNextStep(); }}>
            <div className={`intake-status ${status.tone || 'normal'}`}>
              {status.message}
            </div>

            {currentStep === 0 ? (
              <section className="intake-panel">
                <div className="intake-panel-header">
                  <span className="intake-panel-step">01</span>
                  <div>
                    <h2 className="intake-panel-title">Account Setup</h2>
                    <p className="intake-panel-copy">Create the business record and the first owner login.</p>
                  </div>
                </div>

                <div className="intake-grid">
                  <div className="intake-stack intake-full">
                    <label>Business Name</label>
                    <input value={form.businessName} onChange={(event) => setFormValue('businessName', event.target.value)} />
                  </div>
                  <div className="intake-stack intake-full">
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
                    <input type="email" value={form.ownerEmail} onChange={(event) => setFormValue('ownerEmail', event.target.value)} />
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
              </section>
            ) : null}

            {currentStep === 1 ? (
              <section className="intake-panel">
                <div className="intake-panel-header">
                  <span className="intake-panel-step">02</span>
                  <div>
                    <h2 className="intake-panel-title">Business Context</h2>
                    <p className="intake-panel-copy">Add the minimum context needed for the first knowledge build.</p>
                  </div>
                </div>

                <div className="intake-stack">
                  <label>Website URL (Optional)</label>
                  <input
                    value={form.website}
                    onChange={(event) => setFormValue('website', event.target.value)}
                    placeholder="https://example.com"
                  />
                  <div className="intake-muted">If available, this becomes the first website source in the Knowledge Workspace.</div>
                </div>

                <div className="intake-stack">
                  <label>What Does The Business Do?</label>
                  <textarea
                    value={form.companyDescription}
                    onChange={(event) => setFormValue('companyDescription', event.target.value)}
                    placeholder="Describe the business in one or two short sentences."
                  />
                  <div className="intake-muted">This becomes the initial business context until a stronger website build is published.</div>
                </div>
              </section>
            ) : null}

            {currentStep === 2 ? (
              <section className="intake-panel">
                <div className="intake-panel-header">
                  <span className="intake-panel-step">03</span>
                  <div>
                    <h2 className="intake-panel-title">Knowledge Workspace Setup</h2>
                    <p className="intake-panel-copy">Create the account, provision the number, and continue into the workspace where the first build is prepared.</p>
                  </div>
                </div>

                <div className="intake-summary-grid">
                  {setupSummary.map((item) => (
                    <div key={item.label} className="intake-summary-card">
                      <span className="intake-summary-label">{item.label}</span>
                      <div className="intake-summary-value">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="intake-note-card">
                  <h3>What happens next</h3>
                  <ul>
                    <li>The account and owner login are created.</li>
                    <li>A Sales Receptionist Number is provisioned during onboarding.</li>
                    <li>You land in the Knowledge Workspace to review sources and create the first live build.</li>
                  </ul>
                </div>
              </section>
            ) : null}

            <div className="intake-actions">
              {currentStep > 0 ? (
                <button type="button" className="btn secondary" onClick={moveToPreviousStep} disabled={busy}>
                  Back
                </button>
              ) : <span className="intake-actions-spacer" />}

              {currentStep < INTAKE_STEPS.length - 1 ? (
                <button type="button" className="btn primary" onClick={moveToNextStep} disabled={busy}>
                  Continue
                </button>
              ) : (
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Creating...' : 'Create Account'}
                </button>
              )}
            </div>
          </form>

          {activation ? (
            <section className="intake-card intake-success-card">
              <p className="intake-eyebrow">Account Created</p>
              <h2 className="intake-success-title">Workspace ready</h2>
              <div className="intake-success-grid">
                <div>
                  <span className="intake-success-label">Tenant Key</span>
                  <div>{activation.tenantKey || 'created'}</div>
                </div>
                <div>
                  <span className="intake-success-label">Prompt Profile</span>
                  <div>{activation.promptProfile?.business_name || form.businessName}</div>
                </div>
                <div>
                  <span className="intake-success-label">Sales Receptionist Number</span>
                  <div>{activation.voiceProvisioning?.phoneNumber || 'Provisioning pending'}</div>
                </div>
                <div>
                  <span className="intake-success-label">Provisioning</span>
                  <div>{activation.voiceProvisioning?.ok === false ? 'Needs follow-up' : 'Complete'}</div>
                </div>
              </div>
              <p className="intake-success-copy">
                {provisioningFailed
                  ? `The account was created, but number provisioning needs follow-up before the receptionist can go live. ${activation.voiceProvisioning?.errorMessage || ''}`.trim()
                  : 'Continue to the Knowledge Workspace and create the first build when you are ready.'}
              </p>
              <div className="intake-actions">
                <a className="btn primary" href={nextHref}>Continue to Knowledge Workspace</a>
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default function IntakePage() {
  return <IntakePageClient />;
}

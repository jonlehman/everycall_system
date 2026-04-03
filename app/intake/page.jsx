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
    heroTitle: 'Just moments away...',
    heroCopy: '... from capturing more leads than you thought possible.'
  },
  {
    key: 'context',
    number: '02',
    title: 'Business Context',
    navTitle: 'Business Context',
    heroTitle: 'Just moments away...',
    heroCopy: '... from capturing more leads than you thought possible.'
  },
  {
    key: 'knowledge',
    number: '03',
    title: 'Knowledge Base Setup',
    navTitle: 'Knowledge Base Setup',
    heroTitle: 'Just moments away...',
    heroCopy: '... from capturing more leads than you thought possible.'
  }
];

function createInitialForm(qaMode = false) {
  return {
    businessName: qaMode ? 'Knowledge Receptionist QA Tenant' : '',
    businessCategory: 'professional_services',
    ownerName: qaMode ? 'QA Owner' : '',
    ownerEmail: qaMode ? 'qa-owner@example.com' : '',
    ownerPhone: qaMode ? '4255550101' : '',
    businessPhone: qaMode ? '4255550100' : '',
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

function hasReasonablePhoneNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function defaultStatusForStep() {
  return { message: '', tone: 'normal' };
}

function validateAccountStep(form) {
  if (!form.businessName.trim() || !form.ownerName.trim() || !form.ownerEmail.trim() || !form.ownerPhone.trim() || !form.businessPhone.trim()) {
    return 'Business name, owner name, owner email, owner phone, and business phone are required.';
  }
  if (!form.password || form.password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (form.password !== form.confirmPassword) {
    return 'Passwords do not match.';
  }
  if (form.ownerPhone.trim() && !hasReasonablePhoneNumber(form.ownerPhone)) {
    return 'Enter a valid owner phone number.';
  }
  if (!hasReasonablePhoneNumber(form.businessPhone)) {
    return 'Enter a valid business phone number.';
  }
  return '';
}

function validateContextStep(form) {
  if (!form.website.trim()) {
    return 'Website URL is required.';
  }
  if (!form.companyDescription.trim()) {
    return 'Add a short description of what the business does.';
  }
  return '';
}

function validateStep(stepIndex, form) {
  if (stepIndex === 0) return validateAccountStep(form);
  if (stepIndex === 1) return validateContextStep(form);
  return '';
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

  const canDirectlyNavigateToStep = (targetStepIndex) => {
    if (targetStepIndex <= currentStep) return true;
    if (targetStepIndex !== currentStep + 1) return false;
    return !validateStep(currentStep, form);
  };

  const handleStepNavigation = (targetStepIndex) => {
    if (targetStepIndex <= currentStep) {
      setStepAndResetStatus(targetStepIndex);
      return;
    }
    if (targetStepIndex !== currentStep + 1) {
      return;
    }
    const error = validateStep(currentStep, form);
    if (error) {
      setStatus({ message: error, tone: 'bad' });
      return;
    }
    setStepAndResetStatus(targetStepIndex);
  };

  const moveToNextStep = () => {
    const error = validateStep(currentStep, form);
    if (error) {
      setStatus({ message: error, tone: 'bad' });
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

  const submit = async () => {
    const confirmed = window.confirm(
      'Create this account, provision a Sales Receptionist Number, and start the website knowledge build? This will create the tenant and may incur provider charges.'
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
    setStatus({ message: 'Creating account, provisioning phone number, and starting the website build...', tone: 'warn' });
    try {
      const data = await fetchJson('/api/v1/tenants/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName,
          businessCategory: form.businessCategory,
          ownerName: form.ownerName,
          ownerEmail: form.ownerEmail,
          ownerPhone: form.ownerPhone,
          businessPhone: form.businessPhone,
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
      } else {
        setStatus({ message: 'Account created. Setting things up and redirecting to the Knowledge Workspace...', tone: 'ok' });
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
        </div>
        <nav className="intake-step-list" aria-label="Onboarding steps">
          {INTAKE_STEPS.map((item, index) => {
            const active = index === currentStep;
            const complete = index < currentStep || Boolean(activation?.ok);
            const locked = index > currentStep && !canDirectlyNavigateToStep(index);
            return (
              <button
                key={item.key}
                type="button"
                className={`intake-step-link ${active ? 'active' : ''} ${complete ? 'complete' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => handleStepNavigation(index)}
                aria-current={active ? 'step' : undefined}
                disabled={locked}
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
            {INTAKE_STEPS.map((item, index) => {
              const locked = index > currentStep && !canDirectlyNavigateToStep(index);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`intake-mobile-step ${index === currentStep ? 'active' : ''} ${index < currentStep || Boolean(activation?.ok) ? 'complete' : ''} ${locked ? 'locked' : ''}`}
                  onClick={() => handleStepNavigation(index)}
                  disabled={locked}
                >
                  {item.number}
                </button>
              );
            })}
          </div>

          <section className="intake-hero">
            <p className="intake-eyebrow">Step {step.number}</p>
            <h1>{step.heroTitle}</h1>
            <p>{step.heroCopy}</p>
          </section>

          <form className="intake-card" onSubmit={(event) => event.preventDefault()}>
            {status.message ? (
              <div className={`intake-status ${status.tone || 'normal'}`}>
                {status.message}
              </div>
            ) : null}

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
                    <label>Owner Phone</label>
                    <input type="tel" value={form.ownerPhone} onChange={(event) => setFormValue('ownerPhone', event.target.value)} />
                  </div>
                  <div className="intake-stack">
                    <label>Business Phone</label>
                    <input type="tel" value={form.businessPhone} onChange={(event) => setFormValue('businessPhone', event.target.value)} />
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
                  <label>Website URL</label>
                  <input
                    type="url"
                    value={form.website}
                    onChange={(event) => setFormValue('website', event.target.value)}
                    placeholder="https://example.com"
                  />
                </div>

                <div className="intake-stack">
                  <label>What Does The Business Do?</label>
                  <textarea
                    value={form.companyDescription}
                    onChange={(event) => setFormValue('companyDescription', event.target.value)}
                    placeholder="Describe the business in one or two short sentences."
                  />
                </div>
              </section>
            ) : null}

            {currentStep === 2 ? (
              <section className="intake-panel">
                <div className="intake-panel-header">
                  <span className="intake-panel-step">03</span>
                  <div>
                    <h2 className="intake-panel-title">What Comes Next</h2>
                  </div>
                </div>

                <div className="intake-note-card">
                  <h3>Once your account is created, please visit:</h3>
                  <ul className="intake-followup-list">
                    <li><strong>Knowledge</strong> to upload documents if needed.</li>
                    <li><strong>Team</strong> to confirm who should receive completed call alerts.</li>
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
                <button type="button" className="btn primary" onClick={submit} disabled={busy}>
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
                  <div>Setting things up</div>
                </div>
                <div>
                  <span className="intake-success-label">Provisioning</span>
                  <div>{activation.voiceProvisioning?.ok === false ? 'Needs follow-up' : 'In progress'}</div>
                </div>
              </div>
              <p className="intake-success-copy">
                {provisioningFailed
                  ? `The account was created, but number provisioning needs follow-up before the receptionist can start handling calls. ${activation.voiceProvisioning?.errorMessage || ''}`.trim()
                  : 'Continue to the Knowledge Workspace to review the website build and upload documents if needed.'}
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

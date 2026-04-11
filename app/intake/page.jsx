'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY,
  isEmptyMarketingAttribution,
  normalizeMarketingAttribution
} from '../../lib/intakeMarketingAttribution';
import { formatPhoneDisplay } from '../../lib/phoneDisplay';
import BrandLogo from '../_components/BrandLogo';
import './intake.css';

const INTAKE_STEPS = [
  {
    key: 'website',
    number: '1',
    title: 'Website',
    heroTitle: 'Start with your website',
    heroCopy: 'If you have a public website, EveryCall can use it to start your first knowledge base automatically.'
  },
  {
    key: 'business',
    number: '2',
    title: 'Business Name',
    heroTitle: 'Tell us the business name',
    heroCopy: 'This becomes the name of the workspace and the business identity used across setup.'
  },
  {
    key: 'lead-destination',
    number: '3',
    title: 'Send Leads To',
    heroTitle: 'Choose where new leads should go',
    heroCopy: 'This is where EveryCall will send new lead alerts once calls start coming in.'
  },
  {
    key: 'login',
    number: '4',
    title: 'Create Login',
    heroTitle: 'Create your login',
    heroCopy: 'Use this login to open the EveryCall workspace and finish the rest of setup.'
  }
];

function FieldLabel({ htmlFor, badge = 'required', children }) {
  return (
    <label htmlFor={htmlFor} className="intake-label-row">
      <span className="intake-label-text">{children}</span>
      <span className={`intake-label-badge ${badge}`}>{badge === 'optional' ? 'Optional' : 'Required'}</span>
    </label>
  );
}

function createInitialForm(qaMode = false) {
  const qaLeadEmail = qaMode ? 'qa-owner@example.com' : '';
  return {
    businessName: qaMode ? 'Knowledge Receptionist QA Tenant' : '',
    leadEmail: qaLeadEmail,
    leadPhone: qaMode ? '+12065550199' : '',
    loginEmail: qaLeadEmail,
    password: qaMode ? 'Password123!' : '',
    website: qaMode ? 'https://example.com' : '',
    hasNoWebsite: false
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

function defaultStatusForStep() {
  return { message: '', tone: 'normal' };
}

function firstFieldErrorMessage(fieldErrors, fallbackMessage) {
  if (!fieldErrors || typeof fieldErrors !== 'object') {
    return fallbackMessage;
  }
  return Object.values(fieldErrors).find(Boolean) || fallbackMessage;
}

function validateWebsiteStep(form) {
  if (form.hasNoWebsite) return '';
  if (!form.website.trim()) {
    return 'Website URL is required unless you select "I don\'t have a website."';
  }
  return '';
}

function validateBusinessStep(form) {
  if (!form.businessName.trim()) {
    return 'Business name is required.';
  }
  return '';
}

function validateLeadDestinationStep(form) {
  if (!String(form.leadEmail || '').trim()) {
    return 'Lead email is required.';
  }
  const normalizedPhone = String(form.leadPhone || '').trim();
  if (normalizedPhone) {
    const digits = normalizedPhone.replace(/[^\d]/g, '');
    if (digits.length < 10 || digits.length > 15) {
      return 'Enter a valid mobile number for SMS alerts, or leave it blank.';
    }
  }
  return '';
}

function validateLoginStep(form) {
  if (!String(form.loginEmail || '').trim()) {
    return 'Login email is required.';
  }
  if (!form.password || form.password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return '';
}

function validateStep(stepIndex, form) {
  if (stepIndex === 0) return validateWebsiteStep(form);
  if (stepIndex === 1) return validateBusinessStep(form);
  if (stepIndex === 2) return validateLeadDestinationStep(form);
  if (stepIndex === 3) return validateLoginStep(form);
  return '';
}

function resolveStepForFieldErrors(fieldErrors) {
  if (fieldErrors?.website) return 0;
  if (fieldErrors?.businessName) return 1;
  if (fieldErrors?.leadEmail || fieldErrors?.leadPhone) return 2;
  if (fieldErrors?.loginEmail || fieldErrors?.password) return 3;
  return 3;
}

function buildSuccessMessage({ hasWebsite, smsOptInRequested }) {
  if (hasWebsite && smsOptInRequested) {
    return 'Account created. Your website build is starting now, and a confirmation text was sent for SMS alerts.';
  }
  if (hasWebsite) {
    return 'Account created. Your website build is starting now.';
  }
  if (smsOptInRequested) {
    return 'Account created. A confirmation text was sent for SMS alerts.';
  }
  return 'Account created.';
}

export function IntakePageClient({ qaMode = false } = {}) {
  const initialForm = useMemo(() => createInitialForm(Boolean(qaMode)), [qaMode]);
  const [form, setForm] = useState(initialForm);
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState(defaultStatusForStep(0));
  const [busy, setBusy] = useState(false);
  const [activation, setActivation] = useState(null);
  const [marketingAttribution, setMarketingAttribution] = useState({});
  const [showNoWebsiteSetupModal, setShowNoWebsiteSetupModal] = useState(false);
  const [loginEmailTouched, setLoginEmailTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const getStartedHref = '/client/get-started';
  const receptionistHref = '/client/receptionist/basics';
  const knowledgeHref = '/client/receptionist/knowledge';
  const sendLeadsHref = '/client/team';
  const noWebsiteSetupHref = 'https://calendly.com/jonlehman/everycall-setup';
  const provisioningFailed = activation?.voiceProvisioning?.ok === false;
  const step = INTAKE_STEPS[currentStep];
  const formattedReceptionistNumber = formatPhoneDisplay(activation?.voiceProvisioning?.phoneNumber)
    || String(activation?.voiceProvisioning?.phoneNumber || '').trim()
    || 'Setting things up';

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const searchParams = new URLSearchParams(window.location.search || '');
    const hasQueryParams = Array.from(searchParams.keys()).length > 0;

    if (hasQueryParams) {
      const normalized = normalizeMarketingAttribution(searchParams);
      setMarketingAttribution(normalized);
      try {
        if (isEmptyMarketingAttribution(normalized)) {
          window.sessionStorage.removeItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY);
        } else {
          window.sessionStorage.setItem(
            INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY,
            JSON.stringify(normalized)
          );
        }
      } catch {
        // Ignore session storage failures.
      }
      return undefined;
    }

    try {
      const stored = window.sessionStorage.getItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY);
      if (!stored) return undefined;
      const normalized = normalizeMarketingAttribution(JSON.parse(stored));
      if (isEmptyMarketingAttribution(normalized)) {
        window.sessionStorage.removeItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY);
        return undefined;
      }
      setMarketingAttribution(normalized);
    } catch {
      window.sessionStorage.removeItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY);
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (activation?.ok && form.hasNoWebsite) {
      setShowNoWebsiteSetupModal(true);
    }
  }, [activation, form.hasNoWebsite]);

  const setFormValue = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const setLeadEmail = (value) => {
    setForm((current) => ({
      ...current,
      leadEmail: value,
      loginEmail: loginEmailTouched ? current.loginEmail : value
    }));
  };

  const setStepAndResetStatus = (stepIndex) => {
    setCurrentStep(stepIndex);
    setStatus(defaultStatusForStep(stepIndex));
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
    for (let stepIndex = 0; stepIndex < INTAKE_STEPS.length; stepIndex += 1) {
      const error = validateStep(stepIndex, form);
      if (error) {
        setCurrentStep(stepIndex);
        setStatus({ message: error, tone: 'bad' });
        return;
      }
    }

    const hasWebsite = !form.hasNoWebsite && Boolean(form.website.trim());
    setBusy(true);
    setStatus({
      message: hasWebsite
        ? 'Creating your account and starting the website build...'
        : 'Creating your account and setting up your workspace...',
      tone: 'warn'
    });
    try {
      const requestBody = {
        businessName: form.businessName,
        leadEmail: form.leadEmail,
        leadPhone: form.leadPhone,
        loginEmail: form.loginEmail,
        password: form.password,
        website: form.hasNoWebsite ? '' : normalizeWebsiteUrl(form.website),
        noWebsite: form.hasNoWebsite,
        bootstrapMode: form.hasNoWebsite ? 'setup_interview' : 'website_first'
      };

      if (!isEmptyMarketingAttribution(marketingAttribution)) {
        requestBody.marketingAttribution = marketingAttribution;
      }

      const data = await fetchJson('/api/v1/tenants/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (!data?.ok) {
        if (data?.fieldErrors) {
          setCurrentStep(resolveStepForFieldErrors(data.fieldErrors));
        }
        setStatus({
          message: firstFieldErrorMessage(data?.fieldErrors, data?.message || 'Could not create account.'),
          tone: 'bad'
        });
        return;
      }
      const initialBuildId = String(data?.initialKnowledgeBuild?.build_id || '').trim();
      if (initialBuildId) {
        void fetch(`/api/v1/knowledge/builds/${encodeURIComponent(initialBuildId)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).catch(() => {});
      }
      setActivation(data);
      try {
        window.sessionStorage.removeItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY);
      } catch {
        // Ignore session storage failures.
      }
      setMarketingAttribution({});
      if (data?.voiceProvisioning?.ok === false) {
        setStatus({
          message: `Account created, but phone number provisioning needs follow-up: ${data.voiceProvisioning.errorMessage || 'unknown error'}`,
          tone: 'warn'
        });
      } else {
        setStatus({
          message: buildSuccessMessage({
            hasWebsite,
            smsOptInRequested: data?.smsOptInRequest?.ok === true
          }),
          tone: 'ok'
        });
      }
    } catch {
      setStatus({ message: 'Could not create account.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const heroEyebrow = activation ? 'Account Created' : `Step ${step.number} of ${INTAKE_STEPS.length}`;
  const heroTitle = activation ? 'Your workspace is ready' : step.heroTitle;
  const heroCopy = activation
    ? 'Use the guided setup below to finish the few things EveryCall needs before you start forwarding calls.'
    : step.heroCopy;

  return (
    <div className="intake-shell">
      <header className="intake-topbar">
        <div className="intake-topbar-inner">
          <div className="intake-brand">
            <BrandLogo
              className="h-10 w-[172px]"
              imageClassName="h-full w-full object-contain"
              priority
            />
          </div>
          <div className="intake-topbar-label">Onboarding</div>
        </div>
      </header>

      <main className="intake-main">
        <div className="intake-canvas">
          <section className="intake-hero">
            <p className="intake-eyebrow">{heroEyebrow}</p>
            <h1>{heroTitle}</h1>
            <p>{heroCopy}</p>
            {!activation ? (
              <div className="intake-progress">
                <span className="intake-progress-step">{step.title}</span>
                <span className="intake-progress-count">{`${currentStep + 1} of ${INTAKE_STEPS.length}`}</span>
              </div>
            ) : null}
          </section>

          {!activation ? (
            <form className="intake-card" onSubmit={(event) => event.preventDefault()}>
              {status.message ? (
                <div className={`intake-status ${status.tone || 'normal'}`}>
                  {status.message}
                </div>
              ) : null}

              {currentStep === 0 ? (
                <section className="intake-panel">
                  <div className="intake-panel-header">
                    <span className="intake-panel-step">Step 1</span>
                    <div>
                      <h2 className="intake-panel-title">Website</h2>
                    </div>
                  </div>

                  <div className="intake-stack">
                    <FieldLabel htmlFor="website" badge="required">What is your business website?</FieldLabel>
                    <input
                      id="website"
                      type="url"
                      value={form.website}
                      onChange={(event) => setFormValue('website', event.target.value)}
                      placeholder="https://example.com"
                      disabled={form.hasNoWebsite}
                      autoComplete="url"
                    />
                  </div>

                  <label className="intake-checkbox-card" htmlFor="has-no-website">
                    <input
                      id="has-no-website"
                      type="checkbox"
                      checked={form.hasNoWebsite}
                      onChange={(event) => setFormValue('hasNoWebsite', event.target.checked)}
                    />
                    <span>
                      <strong>I don&apos;t have a website</strong>
                    </span>
                  </label>
                </section>
              ) : null}

              {currentStep === 1 ? (
                <section className="intake-panel">
                  <div className="intake-panel-header">
                    <span className="intake-panel-step">Step 2</span>
                    <div>
                      <h2 className="intake-panel-title">Business Name</h2>
                      <p className="intake-panel-copy">This is the business name callers and team members will see throughout the workspace.</p>
                    </div>
                  </div>

                  <div className="intake-stack">
                    <FieldLabel htmlFor="business-name" badge="required">What is your business name?</FieldLabel>
                    <input
                      id="business-name"
                      value={form.businessName}
                      onChange={(event) => setFormValue('businessName', event.target.value)}
                      autoComplete="organization"
                    />
                  </div>
                </section>
              ) : null}

              {currentStep === 2 ? (
                <section className="intake-panel">
                  <div className="intake-panel-header">
                    <span className="intake-panel-step">Step 3</span>
                    <div>
                      <h2 className="intake-panel-title">Send Leads To</h2>
                    </div>
                  </div>

                  <div className="intake-form-stack">
                    <div className="intake-stack">
                      <FieldLabel htmlFor="lead-email" badge="required">What email should receive new leads?</FieldLabel>
                      <input
                        id="lead-email"
                        type="email"
                        value={form.leadEmail}
                        onChange={(event) => setLeadEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="you@company.com"
                      />
                    </div>

                    <div className="intake-stack">
                      <FieldLabel htmlFor="lead-phone" badge="optional">What mobile number should receive text alerts?</FieldLabel>
                      <input
                        id="lead-phone"
                        type="tel"
                        value={form.leadPhone}
                        onChange={(event) => setFormValue('leadPhone', event.target.value)}
                        autoComplete="tel"
                        placeholder="+1XXXXXXXXXX"
                      />
                      <div className="intake-muted">
                        If you add a mobile number, EveryCall will send a confirmation text before SMS alerts are turned on.
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {currentStep === 3 ? (
                <section className="intake-panel">
                  <div className="intake-panel-header">
                    <span className="intake-panel-step">Step 4</span>
                    <div>
                      <h2 className="intake-panel-title">Create Login</h2>
                      <p className="intake-panel-copy">Use this login to open the workspace after the account is created. You can keep it the same as the lead email or change it.</p>
                    </div>
                  </div>

                  <div className="intake-form-stack">
                    <div className="intake-stack">
                      <FieldLabel htmlFor="login-email" badge="required">What is your email address?</FieldLabel>
                      <input
                        id="login-email"
                        type="email"
                        value={form.loginEmail}
                        onChange={(event) => {
                          setLoginEmailTouched(true);
                          setFormValue('loginEmail', event.target.value);
                        }}
                        autoComplete="email"
                        placeholder="you@company.com"
                      />
                    </div>

                    <div className="intake-stack">
                      <FieldLabel htmlFor="password" badge="required">Password</FieldLabel>
                      <div className="intake-input-with-action">
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={form.password}
                          onChange={(event) => setFormValue('password', event.target.value)}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="intake-input-action"
                          onClick={() => setShowPassword((current) => !current)}
                          aria-pressed={showPassword}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
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
          ) : (
            <section className="intake-card intake-success-card">
              {status.message ? (
                <div className={`intake-status ${status.tone || 'normal'}`}>
                  {status.message}
                </div>
              ) : null}

              <div className="intake-success-grid">
                <div>
                  <span className="intake-success-label">Tenant Key</span>
                  <div>{activation.tenantKey || 'created'}</div>
                </div>
                <div>
                  <span className="intake-success-label">EveryCall Number</span>
                  <div>{formattedReceptionistNumber}</div>
                </div>
                <div>
                  <span className="intake-success-label">Knowledge Setup</span>
                  <div>
                    {form.hasNoWebsite
                      ? 'Support-assisted setup'
                      : (activation.initialKnowledgeBuild?.build_id ? 'Website build queued' : 'Website build pending')}
                  </div>
                </div>
                <div>
                  <span className="intake-success-label">Lead Alerts</span>
                  <div>{form.leadEmail}</div>
                  {form.leadPhone ? (
                    <div className="intake-success-subvalue">
                      {formatPhoneDisplay(form.leadPhone) || form.leadPhone}
                      {activation?.smsOptInRequest?.ok ? ' • confirmation text sent' : ''}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="intake-setup-list">
                <div className="intake-setup-item">
                  <div className="intake-setup-number">1</div>
                  <div>
                    <h3>Open Get Started</h3>
                    <p>Use the guided setup page to see what is ready, what still needs attention, and what to do next.</p>
                  </div>
                </div>
                <div className="intake-setup-item">
                  <div className="intake-setup-number">2</div>
                  <div>
                    <h3>Forward your calls</h3>
                    <p>
                      Forward desired calls from your business phone system to{' '}
                      <strong>{formattedReceptionistNumber}</strong>.
                    </p>
                  </div>
                </div>
                <div className="intake-setup-item">
                  <div className="intake-setup-number">3</div>
                  <div>
                    <h3>Review knowledge and lead destinations</h3>
                    <p>
                      {form.hasNoWebsite
                        ? 'Support will help create the first knowledge source. In the meantime, confirm where lead alerts should go.'
                        : 'Watch the website build, then confirm your receptionist details and where lead alerts should go.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="intake-actions intake-success-actions">
                <a className="btn primary" href={getStartedHref}>Open Get Started</a>
                <a className="btn secondary" href={knowledgeHref}>Open Knowledge</a>
                <a className="btn secondary" href={sendLeadsHref}>Open Send Leads To</a>
                <a className="btn secondary" href={receptionistHref}>Open Receptionist</a>
              </div>

              {provisioningFailed ? (
                <div className="intake-muted">
                  Phone number provisioning needs follow-up before calls can be forwarded.
                </div>
              ) : null}
            </section>
          )}
        </div>
      </main>

      {showNoWebsiteSetupModal ? (
        <div className="intake-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="no-website-setup-title">
          <div className="intake-modal">
            <div className="intake-modal-content">
              <h2 id="no-website-setup-title" className="intake-modal-title">No website? We&apos;ll help you get set up.</h2>
              <p className="intake-modal-copy">
                Since you do not have a website yet, the fastest path is a short setup call with support. Pick a time that works for you and we&apos;ll help configure your sales receptionist correctly.
              </p>
            </div>

            <div className="intake-actions intake-modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowNoWebsiteSetupModal(false)}
              >
                I&apos;ll do this later
              </button>
              <a
                className="btn primary"
                href={noWebsiteSetupHref}
                target="_blank"
                rel="noreferrer"
              >
                Schedule Setup Call
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function IntakePage() {
  return <IntakePageClient />;
}

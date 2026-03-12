'use client';

import { useEffect, useMemo, useState } from 'react';
import './intake.css';

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'msn.com',
  'live.com'
]);

const SERVICES_BY_INDUSTRY = {
  plumbing: ['Drain cleaning', 'Water heater repair', 'Leak detection', 'Sewer line repair', 'Fixture installation', 'Emergency plumbing'],
  window_installers: ['Window replacement', 'Glass repair', 'Energy-efficient upgrades', 'Custom windows', 'Installation estimates'],
  electrical: ['Panel upgrade', 'Outlet installation', 'Lighting', 'Wiring repair', 'EV charger install', 'Emergency electrical'],
  hvac: ['AC repair', 'Furnace repair', 'Maintenance', 'System replacement', 'Duct cleaning', 'Thermostat install'],
  roofing: ['Leak repair', 'Roof replacement', 'Inspection', 'Gutter install', 'Storm damage repair'],
  landscaping: ['Lawn care', 'Irrigation', 'Hardscaping', 'Tree trimming', 'Seasonal cleanup'],
  cleaning: ['Residential cleaning', 'Deep cleaning', 'Move-out cleaning', 'Commercial cleaning', 'Recurring service'],
  pest_control: ['Inspection', 'Extermination', 'Prevention plan', 'Rodent control', 'Termite treatment'],
  garage_door: ['Spring repair', 'Opener install', 'Door replacement', 'Sensor repair', 'Tune-up'],
  general_contractor: ['Remodeling', 'Additions', 'Kitchens', 'Bathrooms', 'Permits coordination'],
  locksmith: ['Lockout service', 'Rekeying', 'Lock installation', 'Key duplication', 'Emergency locksmith']
};

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

const FAQ_CATEGORY_ORDER = [
  'Emergency',
  'Technical Questions',
  'Services Offered',
  'Scheduling & Availability',
  'Pricing & Payment',
  'Service Area & Eligibility',
  'Policies & Process',
  'Warranties & Follow-Up'
];

function parseServiceMatches(industry, enrichment) {
  const options = SERVICES_BY_INDUSTRY[industry] || [];
  const text = [
    enrichment?.profile?.serviceText,
    ...(Array.isArray(enrichment?.faqs) ? enrichment.faqs.map((faq) => `${faq.question} ${faq.answer || ''}`) : [])
  ].join(' ').toLowerCase();

  return options.filter((service) => {
    const parts = service.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4);
    return parts.some((part) => text.includes(part));
  });
}

function websiteFromEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 0) return '';
  const domain = raw.slice(at + 1);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return '';
  return `https://${domain}`;
}

function normalizeDefaultAnswerMap(faqs) {
  const map = new Map();
  for (const faq of faqs || []) {
    const question = String(faq?.question || '').trim();
    const answer = String(faq?.defaultAnswer || '').trim();
    if (!question || !answer || map.has(question)) continue;
    map.set(question, answer);
  }
  return map;
}

function createInitialForm(qaMode = false) {
  if (qaMode) {
    return {
      ownerName: 'QA Operator',
      ownerEmail: 'intake.qa.smoke@example.test',
      website: 'https://example.com',
      industry: 'plumbing',
      businessName: 'Intake QA Smoke',
      phone: '+12065550123',
      address1: '123 Main St',
      address2: '',
      city: 'Seattle',
      state: 'WA',
      zip: '98101',
      serviceArea: 'Seattle Metro',
      password: 'qa-password-123',
      confirmPassword: 'qa-password-123',
      timezone: 'America/Los_Angeles',
      businessHours: 'Mon-Fri 8 AM - 6 PM',
      avgCalls: '10',
      emergencyServices: 'true'
    };
  }
  return {
    ownerName: '',
    ownerEmail: '',
    website: '',
    industry: '',
    businessName: '',
    phone: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    serviceArea: '',
    password: '',
    confirmPassword: '',
    timezone: 'America/Los_Angeles',
    businessHours: '',
    avgCalls: '',
    emergencyServices: 'false'
  };
}

export function IntakePageClient({ qaMode = false } = {}) {
  const isQaMode = Boolean(qaMode);
  const initialForm = useMemo(() => createInitialForm(isQaMode), [isQaMode]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState({ message: '', tone: 'normal' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [activation, setActivation] = useState(null);
  const [activationStatus, setActivationStatus] = useState({ message: '', tone: 'normal' });
  const [activationBusy, setActivationBusy] = useState(false);
  const [websiteEdited, setWebsiteEdited] = useState(isQaMode);
  const [qaResult, setQaResult] = useState(null);
  const [enrichmentReport, setEnrichmentReport] = useState(null);

  const [form, setForm] = useState(() => createInitialForm(isQaMode));

  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServices, setSelectedServices] = useState([]);
  const [faqDrafts, setFaqDrafts] = useState([]);
  const [openFaqIndex, setOpenFaqIndex] = useState(0);
  const [defaultFaqAnswers, setDefaultFaqAnswers] = useState(new Map());

  useEffect(() => {
    setSelectedServices([]);
    setServiceSearch('');
    setFaqDrafts([]);
    setDefaultFaqAnswers(new Map());
    setOpenFaqIndex(0);
  }, [form.industry]);

  useEffect(() => {
    if (faqDrafts.length === 0) {
      setOpenFaqIndex(0);
      return;
    }
    if (openFaqIndex >= faqDrafts.length) {
      setOpenFaqIndex(Math.max(0, faqDrafts.length - 1));
    }
  }, [faqDrafts, openFaqIndex]);

  const filteredServices = useMemo(() => {
    const list = SERVICES_BY_INDUSTRY[form.industry] || [];
    if (!serviceSearch.trim()) return list;
    return list.filter((item) => item.toLowerCase().includes(serviceSearch.trim().toLowerCase()));
  }, [form.industry, serviceSearch]);

  const groupedFaqDrafts = useMemo(() => {
    const groups = new Map();
    faqDrafts.forEach((faq, index) => {
      const category = String(faq?.category || 'Policies & Process').trim() || 'Policies & Process';
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category).push({ faq, index });
    });

    return FAQ_CATEGORY_ORDER
      .filter((category) => groups.has(category))
      .map((category) => ({
        category,
        items: groups.get(category)
      }));
  }, [faqDrafts]);

  const blankFaqsWithDefaultsCount = useMemo(() => (
    faqDrafts.reduce((count, faq) => {
      const question = String(faq?.question || '').trim();
      const hasDefault = Boolean(defaultFaqAnswers.get(question));
      const isBlank = !String(faq?.answer || '').trim();
      return count + (hasDefault && isBlank ? 1 : 0);
    }, 0)
  ), [defaultFaqAnswers, faqDrafts]);

  const qaReport = useMemo(() => {
    if (!isQaMode) return null;
    const provenance = enrichmentReport?.provenance || {};
    const fieldRows = [
      {
        field: 'Owner Name',
        currentValue: form.ownerName,
        currentSource: form.ownerName === initialForm.ownerName ? 'qa_default' : 'user_input',
        suggestedValue: null,
        suggestedSource: null
      },
      {
        field: 'Owner Email',
        currentValue: form.ownerEmail,
        currentSource: form.ownerEmail === initialForm.ownerEmail ? 'qa_default' : 'user_input',
        suggestedValue: null,
        suggestedSource: null
      },
      {
        field: 'Website',
        currentValue: form.website,
        currentSource: form.website === initialForm.website ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.website || null,
        suggestedSource: provenance?.website?.source || null
      },
      {
        field: 'Business Name',
        currentValue: form.businessName,
        currentSource: form.businessName === initialForm.businessName ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.businessName || null,
        suggestedSource: provenance?.businessName?.source || null
      },
      {
        field: 'Business Phone',
        currentValue: form.phone,
        currentSource: form.phone === initialForm.phone ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.phone || null,
        suggestedSource: provenance?.phone?.source || null
      },
      {
        field: 'Address Line 1',
        currentValue: form.address1,
        currentSource: form.address1 === initialForm.address1 ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.address1 || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'City',
        currentValue: form.city,
        currentSource: form.city === initialForm.city ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.city || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'State',
        currentValue: form.state,
        currentSource: form.state === initialForm.state ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.state || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'ZIP',
        currentValue: form.zip,
        currentSource: form.zip === initialForm.zip ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.zip || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'Service Area',
        currentValue: form.serviceArea,
        currentSource: form.serviceArea === initialForm.serviceArea ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.serviceArea || null,
        suggestedSource: provenance?.serviceArea?.source || null
      },
      {
        field: 'Business Hours',
        currentValue: form.businessHours,
        currentSource: form.businessHours === initialForm.businessHours ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.businessHours || null,
        suggestedSource: provenance?.businessHours?.source || null
      },
      {
        field: 'Emergency Services',
        currentValue: form.emergencyServices,
        currentSource: form.emergencyServices === initialForm.emergencyServices ? 'qa_default' : 'user_input',
        suggestedValue: enrichmentReport?.profile?.emergencyServices === null || enrichmentReport?.profile?.emergencyServices === undefined
          ? null
          : String(enrichmentReport.profile.emergencyServices),
        suggestedSource: provenance?.emergencyServices?.source || null
      },
      {
        field: 'Estimated Calls Per Day',
        currentValue: form.avgCalls,
        currentSource: form.avgCalls === initialForm.avgCalls ? 'qa_default' : 'user_input',
        suggestedValue: null,
        suggestedSource: null
      }
    ];
    const faqRows = (faqDrafts || []).map((faq) => ({
      question: faq.question,
      currentAnswer: String(faq.answer || '').trim(),
      currentSource: String(faq.answer || '').trim()
        ? (String(faq.answer || '').trim() === String(faq.defaultAnswer || '').trim() ? 'industry_default_applied' : 'website_or_manual')
        : 'blank',
      defaultAnswer: String(faq.defaultAnswer || '').trim(),
      sourceType: faq.sourceType || null,
      sourceUrl: faq.sourceUrl || null,
      sourceConfidence: Number.isFinite(Number(faq.sourceConfidence)) ? Number(faq.sourceConfidence) : null
    }));
    return {
      fieldRows,
      faqRows,
      raw: {
        currentForm: form,
        initialQaDefaults: initialForm,
        enrichment: enrichmentReport
      }
    };
  }, [enrichmentReport, faqDrafts, form, initialForm, isQaMode]);

  const setStatusMessage = (message, tone = 'normal') => setStatus({ message, tone });

  const clearFieldError = (field) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const setFormValue = (field, value) => {
    clearFieldError(field);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const inputClassName = (field) => (fieldErrors[field] ? 'intake-input-error' : '');
  const fieldErrorText = (field) => fieldErrors[field] ? <div className="intake-field-error">{fieldErrors[field]}</div> : null;

  const updateEmail = (value) => {
    clearFieldError('ownerEmail');
    setForm((prev) => {
      const next = { ...prev, ownerEmail: value };
      if (!websiteEdited) {
        const derived = websiteFromEmail(value);
        next.website = derived || prev.website;
      }
      return next;
    });
  };

  const addService = (service) => {
    if (!service) return;
    clearFieldError('servicesOffered');
    setSelectedServices((prev) => (prev.includes(service) ? prev : [...prev, service]));
  };

  const addCustomService = () => {
    const value = serviceSearch.trim();
    if (!value) return;
    addService(value);
    setServiceSearch('');
  };

  const removeService = (service) => {
    setSelectedServices((prev) => prev.filter((item) => item !== service));
  };

  const updateFaqAnswer = (index, answer) => {
    setFaqDrafts((prev) => prev.map((item, idx) => (idx === index ? { ...item, answer } : item)));
  };

  const removeFaq = (index) => {
    setFaqDrafts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const addDefaultFaqAnswer = (index) => {
    const question = String(faqDrafts[index]?.question || '').trim();
    const defaultAnswer = defaultFaqAnswers.get(question);
    if (!defaultAnswer) return;
    updateFaqAnswer(index, defaultAnswer);
    setStatusMessage('Default answer added. You can edit it before creating your workspace.', 'ok');
  };

  const fillBlankFaqAnswers = () => {
    if (blankFaqsWithDefaultsCount === 0) return;
    setFaqDrafts((prev) => prev.map((faq) => {
      if (String(faq?.answer || '').trim()) return faq;
      const question = String(faq?.question || '').trim();
      const defaultAnswer = defaultFaqAnswers.get(question);
      if (!defaultAnswer) return faq;
      return { ...faq, answer: defaultAnswer };
    }));
    setStatusMessage(`Filled ${blankFaqsWithDefaultsCount} blank FAQ entr${blankFaqsWithDefaultsCount === 1 ? 'y' : 'ies'} with industry defaults.`, 'ok');
  };

  const saveFaqDraft = () => {
    setStatusMessage('FAQ saved locally. It will be included when you create your workspace.', 'ok');
  };

  const handleContinueFromFastStart = async () => {
    const nextFieldErrors = {};
    if (!form.ownerName.trim()) nextFieldErrors.ownerName = 'Owner name is required.';
    if (!form.ownerEmail.trim()) nextFieldErrors.ownerEmail = 'Owner email is required.';
    if (!form.industry) nextFieldErrors.industry = 'Industry is required.';
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setStatusMessage('Name, email, and industry are required.', 'bad');
      return;
    }
    setFieldErrors({});

      if (!form.website.trim()) {
        const confirmed = window.confirm("You didn't add a website. Continue without analyzing your site?");
        if (!confirmed) return;
        setFaqDrafts([]);
        setDefaultFaqAnswers(new Map());
        setStatusMessage('No website provided. Continue with manual setup.', 'warn');
        setStep(2);
        return;
      }

    setEnrichmentBusy(true);
    setStatusMessage('Analyzing website and loading industry FAQ drafts...', 'warn');

    try {
      const resp = await fetch('/api/v1/tenants/enrichment/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerEmail: form.ownerEmail.trim(),
          website: form.website.trim(),
          industry: form.industry
        })
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setFaqDrafts([]);
        setDefaultFaqAnswers(new Map());
        if (isQaMode) setEnrichmentReport(null);
        setStatusMessage(data?.message || 'Could not load enrichment preview. Continue with manual setup.', 'bad');
      } else {
        const enrichment = data?.enrichment || {};
        const previewFaqs = Array.isArray(enrichment?.faqs) ? enrichment.faqs : [];
        const matchedServices = parseServiceMatches(form.industry, enrichment);
        setFaqDrafts(previewFaqs);
        setDefaultFaqAnswers(normalizeDefaultAnswerMap(previewFaqs));
        if (isQaMode) setEnrichmentReport(enrichment);
        setSelectedServices((prev) => {
          const next = new Set(prev);
          matchedServices.forEach((service) => next.add(service));
          return Array.from(next);
        });
        setForm((prev) => (
          !websiteEdited && enrichment?.website ? { ...prev, website: enrichment.website } : prev
        ));
        setStatusMessage(
          `Loaded ${previewFaqs.length} FAQ drafts and matched services from your site.`,
          'ok'
        );
      }
    } catch (err) {
      setFaqDrafts([]);
      setDefaultFaqAnswers(new Map());
      if (isQaMode) setEnrichmentReport(null);
      setStatusMessage(err?.message || 'Could not load enrichment preview. Continue with manual setup.', 'bad');
    } finally {
      setEnrichmentBusy(false);
      setStep(2);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextFieldErrors = {};
    if (!form.businessName.trim()) nextFieldErrors.businessName = 'Business name is required.';
    if (!form.password) nextFieldErrors.password = 'Password is required.';
    if (form.password && form.password.length < 8) nextFieldErrors.password = 'Password must be at least 8 characters.';
    if (form.password !== form.confirmPassword) nextFieldErrors.confirmPassword = 'Passwords do not match.';
    if (!form.serviceArea.trim()) nextFieldErrors.serviceArea = 'Service area is required.';
    if (selectedServices.length < 1) nextFieldErrors.servicesOffered = 'Please add at least one service offered.';
    if (form.avgCalls !== '' && (!Number.isFinite(Number(form.avgCalls)) || Number(form.avgCalls) < 0)) {
      nextFieldErrors.averageCallsPerDay = 'Average calls per day must be a non-negative number.';
    }
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setStatusMessage('Please correct the highlighted fields.', 'bad');
      return;
    }
    setFieldErrors({});
    setStatusMessage('Submitting...', 'warn');

    const payload = {
      businessName: form.businessName.trim(),
      industry: form.industry,
      ownerName: form.ownerName.trim(),
      ownerEmail: form.ownerEmail.trim().toLowerCase(),
      password: form.password,
      website: form.website.trim(),
      phone: form.phone.trim(),
      serviceArea: form.serviceArea.trim(),
      address: [
        form.address1.trim(),
        form.address2.trim(),
        form.city.trim(),
        form.state.trim(),
        form.zip.trim()
      ].filter(Boolean).join(', '),
      timezone: form.timezone.trim() || 'America/Los_Angeles',
      businessHours: form.businessHours.trim(),
      averageCallsPerDay: form.avgCalls === '' ? null : Number(form.avgCalls),
      emergencyServices: form.emergencyServices === 'true',
      servicesOffered: selectedServices,
      primaryGoals: ['Capture missed-call leads'],
      faqDrafts: faqDrafts.map((faq) => ({
        question: faq.question,
        answer: String(faq.answer || '').trim(),
        category: faq.category,
        sourceType: faq.sourceType || null,
        sourceUrl: faq.sourceUrl || null,
        sourceRetrievedAt: faq.sourceRetrievedAt || null,
        sourceConfidence: Number.isFinite(Number(faq.sourceConfidence)) ? Number(faq.sourceConfidence) : null
      })),
      qaMode: isQaMode
    };

    try {
      const resp = await fetch('/api/v1/tenants/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `${Date.now()}`
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        setFieldErrors(data?.fieldErrors || {});
        setStatusMessage(data?.message || data?.error || `Request failed (${resp.status})`, 'bad');
        return;
      }

      const data = await resp.json();
      setFieldErrors({});
      setStatusMessage(isQaMode ? 'QA tenant created.' : 'Trial created.', 'ok');
      if (isQaMode) {
        setQaResult({
          tenantKey: data?.tenantKey || '',
          voiceStatus: data?.provisioning?.voiceStatus || 'skipped'
        });
        return;
      }
      setActivation({
        tenantKey: data?.tenantKey || '',
        voiceNumber: data?.provisioning?.voiceNumber || '',
        voiceStatus: data?.provisioning?.voiceStatus || 'pending'
      });
    } catch (err) {
      setStatusMessage(err?.message || 'Request failed.', 'bad');
    }
  };

  const completeActivation = async (forwardingStatus) => {
    setActivationBusy(true);
    setActivationStatus({ message: 'Saving...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/tenants/forwarding-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: forwardingStatus })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        setActivationStatus({ message: data?.message || 'Could not save activation status.', tone: 'bad' });
        setActivationBusy(false);
        return;
      }
      setActivationStatus({ message: 'Saved. Redirecting to workspace...', tone: 'ok' });
      setTimeout(() => {
        window.location.href = '/client/overview';
      }, 900);
    } catch (err) {
      setActivationStatus({ message: err?.message || 'Could not save activation status.', tone: 'bad' });
      setActivationBusy(false);
    }
  };

  if (qaResult) {
    const voiceStatusLabel = String(qaResult.voiceStatus || 'skipped');
    return (
      <div className="intake-body">
        <div className="intake-shell">
          <div className="intake-hero">
            <div className="intake-brand">everycall</div>
            <h1 className="intake-headline">QA intake completed.</h1>
            <div className="intake-subhead">This flow recreated a deterministic QA tenant and skipped paid voice provisioning.</div>
          </div>
          <div className="card intake-card">
            <h1>QA Tenant Ready</h1>
            <p className="intake-muted">Tenant: {qaResult.tenantKey || '-'}</p>
            <p className="intake-muted">Voice provisioning: {voiceStatusLabel}</p>
            <div className="intake-actions">
              <a className="btn brand" href={`/admin/tenants/${qaResult.tenantKey}`}>Open tenant</a>
              <button className="btn" type="button" onClick={() => setQaResult(null)}>Run again</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activation) {
    const voiceStatus = String(activation.voiceStatus || 'pending');
    const voiceNumberReady = voiceStatus === 'active' && activation.voiceNumber;
    const activationTone = voiceStatus === 'active' ? 'ok' : voiceStatus === 'pending' ? 'warn' : 'bad';
    const activationStatusLabel = voiceStatus.charAt(0).toUpperCase() + voiceStatus.slice(1);
    const activationIntro = voiceStatus === 'active'
      ? 'Your workspace is ready. To activate call handling, route overflow or no-answer calls to your EveryCall number.'
      : voiceStatus === 'pending'
        ? 'Your workspace is ready. Your EveryCall number is still being provisioned, so hold off on forwarding until it is active.'
        : 'Your workspace is ready, but your EveryCall number was not provisioned successfully. Do not forward calls yet.';
    const activationHelpText = voiceStatus === 'active'
      ? 'Route overflow or no-answer calls from your main business line to this EveryCall number. This is required for EveryCall to answer your calls.'
      : voiceStatus === 'pending'
        ? 'Your EveryCall number is still being set up. Once it shows as active, you can forward overflow or no-answer calls to it.'
        : voiceStatus === 'unavailable'
          ? 'No EveryCall number was available to assign during setup. Please email support@everycall.io and include your tenant name so we can finish provisioning.'
          : 'There was a problem provisioning your EveryCall number. Please email support@everycall.io and include your tenant name so we can finish setup.';

    return (
      <div className="intake-body">
        <div className="intake-shell">
          <div className="intake-hero">
            <div className="intake-brand">everycall</div>
            <h1 className="intake-headline">One final activation step.</h1>
            <div className="intake-subhead">{activationIntro}</div>
          </div>
          <div className="card intake-card">
            <h1>Activate Call Routing</h1>
            <p className="intake-muted">Tenant: {activation.tenantKey || '-'}</p>
            <div className="intake-section-title">Your EveryCall Number</div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="stat">Voice Number</div>
              <div className="value" style={{ fontSize: 24 }}>
                {voiceNumberReady ? activation.voiceNumber : voiceStatus === 'pending' ? 'Provisioning in progress' : 'Not available yet'}
              </div>
              <p className={`intake-activation-status intake-activation-status-${activationTone}`} style={{ marginTop: 8 }}>
                Status: {activationStatusLabel}
              </p>
            </div>
            <div className="intake-section-title">Required Setup</div>
            <p className="intake-muted">
              {activationHelpText}
            </p>
            <div className="intake-actions">
              <button className="btn brand" type="button" disabled={activationBusy || !voiceNumberReady} onClick={() => completeActivation('configured')}>
                I Configured Forwarding
              </button>
              <button className="btn" type="button" disabled={activationBusy} onClick={() => completeActivation('acknowledged')}>
                I Will Do This Later
              </button>
              <span
                className="intake-muted"
                style={{
                  color: activationStatus.tone === 'bad' ? '#dc2626' : activationStatus.tone === 'ok' ? '#059669' : '#64748b'
                }}
              >
                {activationStatus.message}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="intake-body">
      <div className="intake-shell">
        <div className="intake-hero">
          <div className="intake-brand">everycall</div>
          <h1 className="intake-headline">
            You&apos;re 5 minutes away from
            <br />
            turning missed calls into new jobs
          </h1>
        </div>
        <div className="card intake-card">
          <h1>{isQaMode ? 'AI Assisted Setup (QA Mode)' : 'AI Assisted Setup'}</h1>
          {isQaMode && (
            <div className="intake-inline-note">
              QA mode recreates an <code>intake_qa_*</code> tenant from this form and skips paid voice provisioning. It requires an active admin session.
            </div>
          )}
          <div className="intake-progress" aria-hidden="true">
            <span className={step === 0 ? 'active' : ''}></span>
            <span className={step === 1 ? 'active' : ''}></span>
            <span className={step === 2 ? 'active' : ''}></span>
          </div>

          <form className="intake-stack" onSubmit={handleSubmit}>
            {step === 0 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 1 — What this gives you</div>
                <section className="intake-intro-panel">
                  <div className="intake-intro-grid">
                    <div className="intake-intro-card">
                      <div className="intake-section-title">Your own EveryCall forwarding number</div>
                      <p className="intake-muted">
                        You&apos;ll have a live EveryCall number that answers missed calls, captures customer details, and helps you respond faster.
                      </p>
                    </div>
                    <div className="intake-intro-card">
                      <div className="intake-section-title">Missed calls answered and sent back to you</div>
                      <p className="intake-muted">
                        When you can&apos;t pick up, EveryCall answers right away, talks to the customer, and sends the lead back to you with the details.
                      </p>
                    </div>
                    <div className="intake-intro-card intake-intro-card-accent">
                      <div className="intake-section-title">One simple step after setup</div>
                      <p className="intake-muted">
                        After setup, all you have to do is forward missed or no-answer calls from your cell phone or business phone system to your new EveryCall number.
                      </p>
                    </div>
                  </div>
                </section>
                <div className="intake-actions">
                  <button className="btn brand" type="button" onClick={() => setStep(1)}>{isQaMode ? 'Start QA intake' : 'Set up my number'}</button>
                  <span className="intake-muted" style={{ color: status.tone === 'bad' ? '#dc2626' : status.tone === 'ok' ? '#059669' : '#64748b' }}>{status.message}</span>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 2 — Business identity</div>
                <div className="intake-grid">
                  <div className="intake-stack">
                    <label>Owner Name</label>
                    <input required name="ownerName" autoComplete="name" className={inputClassName('ownerName')} aria-invalid={fieldErrors.ownerName ? 'true' : undefined} placeholder="Jane Smith" value={form.ownerName} onChange={(event) => setFormValue('ownerName', event.target.value)} />
                    {fieldErrorText('ownerName')}
                  </div>
                  <div className="intake-stack">
                    <label>Owner Email</label>
                    <input type="email" required name="ownerEmail" autoComplete="email" className={inputClassName('ownerEmail')} aria-invalid={fieldErrors.ownerEmail ? 'true' : undefined} placeholder="jane@acme.com" value={form.ownerEmail} onChange={(event) => updateEmail(event.target.value)} />
                    {fieldErrorText('ownerEmail')}
                  </div>
                  <div className="intake-stack">
                    <label>Website</label>
                    <input
                      type="url"
                      name="website"
                      autoComplete="url"
                      inputMode="url"
                      placeholder="https://acme.com"
                      value={form.website}
                      onChange={(event) => {
                        setWebsiteEdited(true);
                        setForm({ ...form, website: event.target.value });
                      }}
                    />
                  </div>
                  <div className="intake-stack">
                    <label>Industry</label>
                    <select required className={inputClassName('industry')} aria-invalid={fieldErrors.industry ? 'true' : undefined} value={form.industry} onChange={(event) => setFormValue('industry', event.target.value)}>
                      <option value="">Select industry</option>
                      {INDUSTRIES.map((industry) => (
                        <option key={industry.value} value={industry.value}>{industry.label}</option>
                      ))}
                    </select>
                    {fieldErrorText('industry')}
                  </div>
                </div>
                <div className="intake-actions">
                  <button className="btn" type="button" onClick={() => setStep(0)}>Back</button>
                  <button className="btn brand" type="button" onClick={handleContinueFromFastStart} disabled={enrichmentBusy}>
                    {enrichmentBusy ? 'Analyzing...' : 'Analyze your site'}
                  </button>
                  <span className="intake-muted" style={{ color: status.tone === 'bad' ? '#dc2626' : status.tone === 'ok' ? '#059669' : '#64748b' }}>{status.message}</span>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 3 — Review and finish setup</div>
                <div className="intake-page-hint">Confirm the key details below, then create your workspace.</div>
                {isQaMode && qaReport && (
                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">QA Data Provenance</div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '8px 6px' }}>Field</th>
                            <th style={{ padding: '8px 6px' }}>Current Value</th>
                            <th style={{ padding: '8px 6px' }}>Current Source</th>
                            <th style={{ padding: '8px 6px' }}>Enrichment Suggestion</th>
                            <th style={{ padding: '8px 6px' }}>Suggestion Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qaReport.fieldRows.map((row) => (
                            <tr key={row.field} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.field}</td>
                              <td style={{ padding: '8px 6px' }}>{row.currentValue || '—'}</td>
                              <td style={{ padding: '8px 6px' }}>{row.currentSource || '—'}</td>
                              <td style={{ padding: '8px 6px' }}>{row.suggestedValue || '—'}</td>
                              <td style={{ padding: '8px 6px' }}>{row.suggestedSource || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="intake-section-title" style={{ marginTop: 16 }}>FAQ Sources</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '8px 6px' }}>Question</th>
                            <th style={{ padding: '8px 6px' }}>Current Answer Source</th>
                            <th style={{ padding: '8px 6px' }}>Detected Source</th>
                            <th style={{ padding: '8px 6px' }}>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qaReport.faqRows.map((row) => (
                            <tr key={row.question} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.question}</td>
                              <td style={{ padding: '8px 6px' }}>{row.currentSource}</td>
                              <td style={{ padding: '8px 6px' }}>
                                {row.sourceType || row.sourceUrl
                                  ? [row.sourceType || null, row.sourceUrl || null].filter(Boolean).join(' | ')
                                  : '—'}
                              </td>
                              <td style={{ padding: '8px 6px' }}>{row.sourceConfidence ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="intake-section-title" style={{ marginTop: 16 }}>Raw Report</div>
                    <textarea readOnly value={JSON.stringify(qaReport.raw, null, 2)} style={{ minHeight: 280, fontFamily: 'monospace' }} />
                  </section>
                )}

                <div className="intake-review-grid">
                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Business Profile</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack">
                        <label>Business Name</label>
                        <input required name="businessName" autoComplete="organization" className={inputClassName('businessName')} aria-invalid={fieldErrors.businessName ? 'true' : undefined} placeholder="Acme Plumbing" value={form.businessName} onChange={(event) => setFormValue('businessName', event.target.value)} />
                        {fieldErrorText('businessName')}
                      </div>
                      <div className="intake-stack">
                        <label>Business Phone</label>
                        <input type="tel" name="businessPhone" autoComplete="tel" inputMode="tel" placeholder="+1 555 555 5555" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>Password</label>
                        <input type="password" required name="password" autoComplete="new-password" className={inputClassName('password')} aria-invalid={fieldErrors.password ? 'true' : undefined} placeholder="Create a password" value={form.password} onChange={(event) => setFormValue('password', event.target.value)} />
                        {fieldErrorText('password')}
                      </div>
                      <div className="intake-stack">
                        <label>Confirm Password</label>
                        <input type="password" required name="confirmPassword" autoComplete="new-password" className={inputClassName('confirmPassword')} aria-invalid={fieldErrors.confirmPassword ? 'true' : undefined} placeholder="Confirm password" value={form.confirmPassword} onChange={(event) => setFormValue('confirmPassword', event.target.value)} />
                        {fieldErrorText('confirmPassword')}
                      </div>
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Location & Coverage</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack intake-full">
                        <label>Address Line 1</label>
                        <input name="address1" autoComplete="address-line1" placeholder="123 Main St" value={form.address1} onChange={(event) => setForm({ ...form, address1: event.target.value })} />
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Address Line 2</label>
                        <input name="address2" autoComplete="address-line2" placeholder="Suite 200" value={form.address2} onChange={(event) => setForm({ ...form, address2: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>City</label>
                        <input name="city" autoComplete="address-level2" placeholder="Seattle" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>State</label>
                        <input name="state" autoComplete="address-level1" placeholder="WA" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>ZIP</label>
                        <input name="zip" autoComplete="postal-code" inputMode="numeric" placeholder="98101" value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} />
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Describe Your Service Area</label>
                        <input required className={inputClassName('serviceArea')} aria-invalid={fieldErrors.serviceArea ? 'true' : undefined} placeholder="Seattle + Eastside" value={form.serviceArea} onChange={(event) => setFormValue('serviceArea', event.target.value)} />
                        {fieldErrorText('serviceArea')}
                      </div>
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Operations</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack">
                        <label>Timezone</label>
                        <select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                          <option value="America/New_York">Eastern (ET)</option>
                          <option value="America/Chicago">Central (CT)</option>
                          <option value="America/Denver">Mountain (MT)</option>
                          <option value="America/Phoenix">Arizona (MST)</option>
                          <option value="America/Los_Angeles">Pacific (PT)</option>
                          <option value="America/Anchorage">Alaska (AK)</option>
                          <option value="Pacific/Honolulu">Hawaii (HST)</option>
                        </select>
                      </div>
                      <div className="intake-stack">
                        <label>Business Hours</label>
                        <input placeholder="Mon-Fri 8 AM - 6 PM" value={form.businessHours} onChange={(event) => setForm({ ...form, businessHours: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>Estimated Calls Per Day</label>
                        <input type="number" min="0" className={inputClassName('averageCallsPerDay')} aria-invalid={fieldErrors.averageCallsPerDay ? 'true' : undefined} placeholder="10" value={form.avgCalls} onChange={(event) => setFormValue('avgCalls', event.target.value)} />
                        {fieldErrorText('averageCallsPerDay')}
                      </div>
                      <div className="intake-stack">
                        <label>Do You Offer Emergency Service?</label>
                        <select value={form.emergencyServices} onChange={(event) => setForm({ ...form, emergencyServices: event.target.value })}>
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Services Offered</div>
                    </div>
                    <div className="intake-stack intake-service-picker">
                      <input
                        placeholder="Search services or type a custom one"
                        value={serviceSearch}
                        onChange={(event) => setServiceSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addCustomService();
                          }
                        }}
                      />
                      <div className="intake-service-results">
                        {filteredServices.length === 0 ? (
                          <div className="intake-muted">No matches found. Add a custom service.</div>
                        ) : (
                          filteredServices.map((service) => (
                            <button type="button" key={service} onClick={() => addService(service)}>{service}</button>
                          ))
                        )}
                      </div>
                      <div className="intake-actions">
                        <button className="btn" type="button" onClick={addCustomService}>Add Service</button>
                        <span className="intake-muted">Search above or type your own service and add it.</span>
                      </div>
                      <div className="intake-selected-services">
                        {selectedServices.length === 0 ? (
                          <div className="intake-inline-note">No services added yet.</div>
                        ) : (
                          selectedServices.map((service) => (
                            <button key={service} type="button" className="btn intake-tag-button" onClick={() => removeService(service)}>
                              {service} ✕
                            </button>
                          ))
                        )}
                      </div>
                      {fieldErrorText('servicesOffered')}
                    </div>
                  </section>

                </div>

                <section className="intake-panel">
                  <div className="intake-panel-header">
                    <div>
                      <div className="intake-faq-heading">FAQs</div>
                      <div className="intake-muted">How do you want your assistant to respond to customer questions?</div>
                      <div className="intake-muted">Note that wording of the question and answer doesn&apos;t have to be exact for it to be used.</div>
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={fillBlankFaqAnswers}
                      disabled={blankFaqsWithDefaultsCount === 0}
                    >
                      Fill blanks with industry defaults
                    </button>
                  </div>
                  <div className="intake-faq-list">
                  {faqDrafts.length === 0 ? (
                    <div className="intake-inline-note">No draft answers were found. You can add FAQs after setup in the FAQ Manager.</div>
                  ) : groupedFaqDrafts.map((group) => (
                    <div key={group.category} className="intake-faq-group">
                      <div className="intake-faq-group-title">{group.category}</div>
                      {group.items.map(({ faq, index }) => (
                        <div key={`${faq.question}-${index}`} className="intake-faq-item">
                          <button
                            className="intake-faq-trigger"
                            type="button"
                            aria-expanded={openFaqIndex === index}
                            onClick={() => setOpenFaqIndex((current) => (current === index ? -1 : index))}
                          >
                            <span className="intake-faq-question">{faq.question}</span>
                            <span className="intake-faq-chevron" aria-hidden="true">{openFaqIndex === index ? '−' : '+'}</span>
                          </button>
                          {openFaqIndex === index && (
                            <div className="intake-faq-content">
                              <div className="intake-stack">
                                <label>Answer</label>
                                <textarea
                                  placeholder="Add the answer you want your assistant to give."
                                  value={faq.answer || ''}
                                  onChange={(event) => updateFaqAnswer(index, event.target.value)}
                                />
                                <div className="intake-actions intake-faq-actions">
                                  <button
                                    className="btn"
                                    type="button"
                                    onClick={() => addDefaultFaqAnswer(index)}
                                    disabled={!defaultFaqAnswers.get(String(faq.question || '').trim())}
                                  >
                                    Add Default
                                  </button>
                                  <button className="btn" type="button" onClick={() => removeFaq(index)}>Remove</button>
                                  <button className="btn intake-save-btn" type="button" onClick={saveFaqDraft}>Save</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                  </div>
                  <div className="intake-muted intake-faq-footer">Need custom FAQ&apos;s? Add those in your workspace once we create it for you.</div>
                </section>

                <div className="intake-actions">
                  <button className="btn" type="button" onClick={() => setStep(1)}>Back</button>
                  <button className="btn brand" type="submit">{isQaMode ? 'Recreate QA tenant' : 'Create workspace'}</button>
                  <span className="intake-muted" style={{ color: status.tone === 'bad' ? '#dc2626' : status.tone === 'ok' ? '#059669' : '#64748b' }}>{status.message}</span>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default function IntakePage() {
  return <IntakePageClient />;
}

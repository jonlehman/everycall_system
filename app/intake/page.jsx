'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBlankGuardrailQuestionTests, createBlankKnowledgeEntries } from '../../lib/knowledgeTemplates.js';
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

const US_STATE_OPTIONS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

function parseServiceMatches(industry, enrichment) {
  const options = SERVICES_BY_INDUSTRY[industry] || [];
  const text = [
    enrichment?.profile?.serviceText,
    ...(Array.isArray(enrichment?.knowledgeEntries) ? enrichment.knowledgeEntries.map((entry) => `${entry.title || ''} ${entry.contentText || ''}`) : []),
    ...(Array.isArray(enrichment?.guardrailQuestionTests) ? enrichment.guardrailQuestionTests.map((item) => `${item.questionText || ''} ${item.answer || ''}`) : [])
  ].join(' ').toLowerCase();

  return options.filter((service) => {
    const parts = service.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4);
    return parts.some((part) => text.includes(part));
  });
}

function mergeEnrichmentProfileIntoForm(prev, enrichment, { includeBusinessName = true } = {}) {
  const profile = enrichment?.profile || {};
  return {
    ...prev,
    businessName: includeBusinessName ? (prev.businessName || profile.businessName || '') : prev.businessName,
    phone: prev.phone || profile.phone || '',
    address1: prev.address1 || profile.address1 || '',
    city: prev.city || profile.city || '',
    state: prev.state || profile.state || '',
    zip: prev.zip || profile.zip || '',
    serviceArea: prev.serviceArea || profile.serviceArea || '',
    businessHours: prev.businessHours || profile.businessHours || '',
    emergencyServices:
      prev.emergencyServices !== 'false'
        ? prev.emergencyServices
        : profile.emergencyServices === true
          ? 'true'
          : prev.emergencyServices
  };
}

function websiteFromEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 0) return '';
  const domain = raw.slice(at + 1);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return '';
  return `https://${domain}`;
}

function createInitialForm(qaMode = false) {
  const base = {
    ownerName: '',
    ownerEmail: '',
    website: '',
    industry: '',
    businessName: qaMode ? 'Intake QA Smoke' : '',
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
  return base;
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
  const [websiteEdited, setWebsiteEdited] = useState(false);
  const [qaResult, setQaResult] = useState(null);
  const [enrichmentReport, setEnrichmentReport] = useState(null);

  const [form, setForm] = useState(() => createInitialForm(isQaMode));

  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServices, setSelectedServices] = useState([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState(() => createBlankKnowledgeEntries());
  const [guardrailQuestionTests, setGuardrailQuestionTests] = useState(() => createBlankGuardrailQuestionTests());
  const [siteTopics, setSiteTopics] = useState([]);
  const [coverageChecklist, setCoverageChecklist] = useState([]);
  const [openGuardrailIndex, setOpenGuardrailIndex] = useState(0);

  useEffect(() => {
    setSelectedServices([]);
    setServiceSearch('');
    setKnowledgeEntries(createBlankKnowledgeEntries());
    setGuardrailQuestionTests(createBlankGuardrailQuestionTests());
    setSiteTopics([]);
    setCoverageChecklist([]);
    setOpenGuardrailIndex(0);
  }, [form.industry]);

  useEffect(() => {
    if (guardrailQuestionTests.length === 0) {
      setOpenGuardrailIndex(0);
      return;
    }
    if (openGuardrailIndex >= guardrailQuestionTests.length) {
      setOpenGuardrailIndex(Math.max(0, guardrailQuestionTests.length - 1));
    }
  }, [guardrailQuestionTests, openGuardrailIndex]);

  const filteredServices = useMemo(() => {
    const list = SERVICES_BY_INDUSTRY[form.industry] || [];
    if (!serviceSearch.trim()) return list;
    return list.filter((item) => item.toLowerCase().includes(serviceSearch.trim().toLowerCase()));
  }, [form.industry, serviceSearch]);

  const qaReport = useMemo(() => {
    if (!isQaMode) return null;
    const provenance = enrichmentReport?.provenance || {};
    const resolveCurrentSource = (currentValue, initialValue, suggestedValue, { fixed = false } = {}) => {
      if (fixed && currentValue === initialValue) return 'qa_fixed';
      if (currentValue && suggestedValue && String(currentValue).trim() === String(suggestedValue).trim()) {
        return 'enrichment_applied';
      }
      if (currentValue === initialValue) return 'qa_default';
      return 'user_input';
    };

    const fieldRows = [
      {
        field: 'Owner Name',
        currentValue: form.ownerName,
        currentSource: resolveCurrentSource(form.ownerName, initialForm.ownerName, null),
        suggestedValue: null,
        suggestedSource: null
      },
      {
        field: 'Owner Email',
        currentValue: form.ownerEmail,
        currentSource: resolveCurrentSource(form.ownerEmail, initialForm.ownerEmail, null),
        suggestedValue: null,
        suggestedSource: null
      },
      {
        field: 'Website',
        currentValue: form.website,
        currentSource: resolveCurrentSource(form.website, initialForm.website, enrichmentReport?.website || null),
        suggestedValue: enrichmentReport?.website || null,
        suggestedSource: provenance?.website?.source || null
      },
      {
        field: 'Business Name',
        currentValue: form.businessName,
        currentSource: resolveCurrentSource(form.businessName, initialForm.businessName, enrichmentReport?.profile?.businessName || null, { fixed: true }),
        suggestedValue: enrichmentReport?.profile?.businessName || null,
        suggestedSource: provenance?.businessName?.source || null
      },
      {
        field: 'Business Phone',
        currentValue: form.phone,
        currentSource: resolveCurrentSource(form.phone, initialForm.phone, enrichmentReport?.profile?.phone || null),
        suggestedValue: enrichmentReport?.profile?.phone || null,
        suggestedSource: provenance?.phone?.source || null
      },
      {
        field: 'Address Line 1',
        currentValue: form.address1,
        currentSource: resolveCurrentSource(form.address1, initialForm.address1, enrichmentReport?.profile?.address1 || null),
        suggestedValue: enrichmentReport?.profile?.address1 || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'City',
        currentValue: form.city,
        currentSource: resolveCurrentSource(form.city, initialForm.city, enrichmentReport?.profile?.city || null),
        suggestedValue: enrichmentReport?.profile?.city || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'State',
        currentValue: form.state,
        currentSource: resolveCurrentSource(form.state, initialForm.state, enrichmentReport?.profile?.state || null),
        suggestedValue: enrichmentReport?.profile?.state || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'ZIP',
        currentValue: form.zip,
        currentSource: resolveCurrentSource(form.zip, initialForm.zip, enrichmentReport?.profile?.zip || null),
        suggestedValue: enrichmentReport?.profile?.zip || null,
        suggestedSource: provenance?.address?.source || null
      },
      {
        field: 'Service Area',
        currentValue: form.serviceArea,
        currentSource: resolveCurrentSource(form.serviceArea, initialForm.serviceArea, enrichmentReport?.profile?.serviceArea || null),
        suggestedValue: enrichmentReport?.profile?.serviceArea || null,
        suggestedSource: provenance?.serviceArea?.source || null
      },
      {
        field: 'Business Hours',
        currentValue: form.businessHours,
        currentSource: resolveCurrentSource(form.businessHours, initialForm.businessHours, enrichmentReport?.profile?.businessHours || null),
        suggestedValue: enrichmentReport?.profile?.businessHours || null,
        suggestedSource: provenance?.businessHours?.source || null
      },
      {
        field: 'Emergency Services',
        currentValue: form.emergencyServices,
        currentSource: resolveCurrentSource(
          form.emergencyServices,
          initialForm.emergencyServices,
          enrichmentReport?.profile?.emergencyServices === null || enrichmentReport?.profile?.emergencyServices === undefined
            ? null
            : String(enrichmentReport.profile.emergencyServices)
        ),
        suggestedValue: enrichmentReport?.profile?.emergencyServices === null || enrichmentReport?.profile?.emergencyServices === undefined
          ? null
          : String(enrichmentReport.profile.emergencyServices),
        suggestedSource: provenance?.emergencyServices?.source || null
      },
      {
        field: 'Estimated Calls Per Day',
        currentValue: form.avgCalls,
        currentSource: resolveCurrentSource(form.avgCalls, initialForm.avgCalls, null),
        suggestedValue: null,
        suggestedSource: null
      }
    ];
    const knowledgeEntryRows = (knowledgeEntries || []).map((entry) => ({
      title: entry.title,
      currentValue: String(entry.contentText || '').trim(),
      currentSource: String(entry.contentText || '').trim() ? (entry.sourceType || 'manual_or_reviewed') : 'blank',
      sourceUrl: entry.sourceUrl || null,
      sourceConfidence: Number.isFinite(Number(entry.sourceConfidence)) ? Number(entry.sourceConfidence) : null
    }));
    const guardrailRows = (guardrailQuestionTests || []).map((item) => ({
      question: item.questionText,
      currentAnswer: String(item.answer || '').trim(),
      currentSource: String(item.answer || '').trim() ? (item.sourceType || 'manual_or_reviewed') : 'blank',
      sourceUrl: item.sourceUrl || null,
      sourceConfidence: Number.isFinite(Number(item.sourceConfidence)) ? Number(item.sourceConfidence) : null
    }));
    const siteTopicRows = (siteTopics || []).map((topic) => ({
      topicPath: topic.topicPath,
      topicType: topic.topicType || 'page',
      riskLevel: topic.riskLevel || 'normal',
      sourceUrl: topic.sourceUrl || null,
      summaryObjective: String(topic.summaryObjective || '').trim()
    }));
    const coverageRows = (coverageChecklist || []).map((item) => ({
      title: item.title,
      status: item.status || 'missing',
      coverageConfidence: Number.isFinite(Number(item.coverageConfidence)) ? Number(item.coverageConfidence) : null,
      matchedTopicPaths: Array.isArray(item.matchedTopicPaths) ? item.matchedTopicPaths : []
    }));
    return {
      fieldRows,
      knowledgeEntryRows,
      guardrailRows,
      siteTopicRows,
      coverageRows,
      raw: {
        currentForm: form,
        initialQaDefaults: initialForm,
        enrichment: enrichmentReport,
        knowledgeEntries,
        guardrailQuestionTests,
        siteTopics,
        coverageChecklist
      }
    };
  }, [coverageChecklist, enrichmentReport, form, guardrailQuestionTests, initialForm, isQaMode, knowledgeEntries, siteTopics]);

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

  const updateKnowledgeEntry = (index, contentText) => {
    setKnowledgeEntries((prev) => prev.map((item, idx) => (idx === index ? { ...item, contentText } : item)));
  };

  const updateGuardrailQuestionAnswer = (index, answer) => {
    setGuardrailQuestionTests((prev) => prev.map((item, idx) => (idx === index ? { ...item, answer } : item)));
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
        setKnowledgeEntries(createBlankKnowledgeEntries());
        setGuardrailQuestionTests(createBlankGuardrailQuestionTests());
        setSiteTopics([]);
        setCoverageChecklist([]);
        setStatusMessage('No website provided. Continue with manual knowledge setup.', 'warn');
        setStep(2);
        return;
      }

    setEnrichmentBusy(true);
    setStatusMessage('Analyzing website and building knowledge drafts...', 'warn');

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
        setKnowledgeEntries(createBlankKnowledgeEntries());
        setGuardrailQuestionTests(createBlankGuardrailQuestionTests());
        setSiteTopics([]);
        setCoverageChecklist([]);
        if (isQaMode) setEnrichmentReport(null);
        setStatusMessage(data?.message || 'Could not load enrichment preview. Continue with manual setup.', 'bad');
      } else {
        const enrichment = data?.enrichment || {};
        const previewKnowledgeEntries = Array.isArray(enrichment?.knowledgeEntries) && enrichment.knowledgeEntries.length
          ? enrichment.knowledgeEntries
          : createBlankKnowledgeEntries();
        const previewGuardrailQuestions = Array.isArray(enrichment?.guardrailQuestionTests) && enrichment.guardrailQuestionTests.length
          ? enrichment.guardrailQuestionTests
          : createBlankGuardrailQuestionTests();
        const previewSiteTopics = Array.isArray(enrichment?.siteTopics) ? enrichment.siteTopics : [];
        const previewCoverageChecklist = Array.isArray(enrichment?.coverageChecklist) ? enrichment.coverageChecklist : [];
        const matchedServices = parseServiceMatches(form.industry, enrichment);
        setKnowledgeEntries(previewKnowledgeEntries);
        setGuardrailQuestionTests(previewGuardrailQuestions);
        setSiteTopics(previewSiteTopics);
        setCoverageChecklist(previewCoverageChecklist);
        if (isQaMode) setEnrichmentReport(enrichment);
        setSelectedServices((prev) => {
          const next = new Set(prev);
          matchedServices.forEach((service) => next.add(service));
          return Array.from(next);
        });
        setForm((prev) => {
          const next = !websiteEdited && enrichment?.website ? { ...prev, website: enrichment.website } : prev;
          return mergeEnrichmentProfileIntoForm(next, enrichment, { includeBusinessName: !isQaMode });
        });
        setStatusMessage(
          `Loaded ${previewKnowledgeEntries.length} knowledge drafts and ${previewGuardrailQuestions.length} guardrail question previews from your site.`,
          'ok'
        );
      }
    } catch (err) {
      setKnowledgeEntries(createBlankKnowledgeEntries());
      setGuardrailQuestionTests(createBlankGuardrailQuestionTests());
      setSiteTopics([]);
      setCoverageChecklist([]);
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
      knowledgeEntries: knowledgeEntries.map((entry) => ({
        sectionType: entry.sectionType,
        title: entry.title,
        contentText: String(entry.contentText || '').trim(),
        sourceType: entry.sourceType || null,
        sourceUrl: entry.sourceUrl || null,
        sourceConfidence: Number.isFinite(Number(entry.sourceConfidence)) ? Number(entry.sourceConfidence) : null
      })),
      guardrailQuestionTests: guardrailQuestionTests.map((item) => ({
        questionText: item.questionText,
        topic: item.topic,
        riskLevel: item.riskLevel,
        answer: String(item.answer || '').trim(),
        sourceType: item.sourceType || null,
        sourceUrl: item.sourceUrl || null,
        sourceConfidence: Number.isFinite(Number(item.sourceConfidence)) ? Number(item.sourceConfidence) : null
      })),
      siteTopics: siteTopics.map((topic) => ({
        topicKey: topic.topicKey,
        parentTopicKey: topic.parentTopicKey || null,
        topicPath: topic.topicPath,
        parentTopicPath: topic.parentTopicPath || null,
        displayTitle: topic.displayTitle,
        topicType: topic.topicType || 'page',
        summaryObjective: String(topic.summaryObjective || '').trim(),
        sourceUrl: topic.sourceUrl || null,
        sourceConfidence: Number.isFinite(Number(topic.sourceConfidence)) ? Number(topic.sourceConfidence) : null,
        riskLevel: topic.riskLevel || 'normal',
        metadata: topic.metadata || {}
      })),
      coverageChecklist: coverageChecklist.map((item) => ({
        checkKey: item.checkKey,
        title: item.title,
        status: item.status || 'missing',
        coverageConfidence: Number.isFinite(Number(item.coverageConfidence)) ? Number(item.coverageConfidence) : null,
        matchedTopicPaths: Array.isArray(item.matchedTopicPaths) ? item.matchedTopicPaths : [],
        notes: item.notes || '',
        metadata: item.metadata || {}
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
              QA mode reuses a fixed business name so the same <code>intake_qa_*</code> tenant is recreated on each run. All other fields are entered and enriched like the normal intake flow. It requires an active admin session.
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
                    <div className="intake-section-title" style={{ marginTop: 16 }}>Knowledge Entry Sources</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '8px 6px' }}>Entry</th>
                            <th style={{ padding: '8px 6px' }}>Current Source</th>
                            <th style={{ padding: '8px 6px' }}>Detected Source</th>
                            <th style={{ padding: '8px 6px' }}>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qaReport.knowledgeEntryRows.map((row) => (
                            <tr key={row.title} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.title}</td>
                              <td style={{ padding: '8px 6px' }}>{row.currentSource}</td>
                              <td style={{ padding: '8px 6px' }}>
                                {row.sourceUrl
                                  ? [row.currentSource || null, row.sourceUrl || null].filter(Boolean).join(' | ')
                                  : '—'}
                              </td>
                              <td style={{ padding: '8px 6px' }}>{row.sourceConfidence ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="intake-section-title" style={{ marginTop: 16 }}>Guardrail Question Sources</div>
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
                          {qaReport.guardrailRows.map((row) => (
                            <tr key={row.question} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.question}</td>
                              <td style={{ padding: '8px 6px' }}>{row.currentSource}</td>
                              <td style={{ padding: '8px 6px' }}>
                                {row.sourceUrl
                                  ? [row.currentSource || null, row.sourceUrl || null].filter(Boolean).join(' | ')
                                  : '—'}
                              </td>
                              <td style={{ padding: '8px 6px' }}>{row.sourceConfidence ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="intake-section-title" style={{ marginTop: 16 }}>Discovered Site Topics</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '8px 6px' }}>Topic Path</th>
                            <th style={{ padding: '8px 6px' }}>Type</th>
                            <th style={{ padding: '8px 6px' }}>Risk</th>
                            <th style={{ padding: '8px 6px' }}>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qaReport.siteTopicRows.map((row) => (
                            <tr key={row.topicPath} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.topicPath}</td>
                              <td style={{ padding: '8px 6px' }}>{row.topicType}</td>
                              <td style={{ padding: '8px 6px' }}>{row.riskLevel}</td>
                              <td style={{ padding: '8px 6px' }}>{row.sourceUrl || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="intake-section-title" style={{ marginTop: 16 }}>Coverage Checklist</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '8px 6px' }}>Topic</th>
                            <th style={{ padding: '8px 6px' }}>Status</th>
                            <th style={{ padding: '8px 6px' }}>Confidence</th>
                            <th style={{ padding: '8px 6px' }}>Matched Topic Paths</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qaReport.coverageRows.map((row) => (
                            <tr key={row.title} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.title}</td>
                              <td style={{ padding: '8px 6px' }}>{row.status}</td>
                              <td style={{ padding: '8px 6px' }}>{row.coverageConfidence ?? '—'}</td>
                              <td style={{ padding: '8px 6px' }}>{row.matchedTopicPaths.length ? row.matchedTopicPaths.join(' | ') : '—'}</td>
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
                      <div className="intake-stack intake-full">
                        <label>Business Name</label>
                        <input
                          required
                          name="businessName"
                          autoComplete="organization"
                          readOnly={isQaMode}
                          className={inputClassName('businessName')}
                          aria-invalid={fieldErrors.businessName ? 'true' : undefined}
                          placeholder="Acme Plumbing"
                          value={form.businessName}
                          onChange={(event) => setFormValue('businessName', event.target.value)}
                        />
                        {isQaMode && <div className="intake-muted">Fixed in QA mode so each run recreates the same tenant.</div>}
                        {fieldErrorText('businessName')}
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Business Phone</label>
                        <input type="tel" name="businessPhone" autoComplete="tel" inputMode="tel" placeholder="+1 555 555 5555" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                      </div>
                      <div className="intake-inline-row intake-full">
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
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Location & Coverage</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack intake-full">
                        <label>Address Line 1</label>
                        <input name="address1" autoComplete="address-line1" value={form.address1} onChange={(event) => setForm({ ...form, address1: event.target.value })} />
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Address Line 2</label>
                        <input name="address2" autoComplete="address-line2" value={form.address2} onChange={(event) => setForm({ ...form, address2: event.target.value })} />
                      </div>
                      <div className="intake-location-row intake-full">
                        <div className="intake-stack">
                          <label>City</label>
                          <input name="city" autoComplete="address-level2" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                        </div>
                        <div className="intake-stack">
                          <label>State</label>
                          <select name="state" autoComplete="address-level1" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>
                            <option value="">Select</option>
                            {US_STATE_OPTIONS.map((state) => (
                              <option key={state} value={state}>{state}</option>
                            ))}
                          </select>
                        </div>
                        <div className="intake-stack">
                          <label>ZIP</label>
                          <input name="zip" autoComplete="postal-code" inputMode="numeric" value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} />
                        </div>
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Describe Your Service Area</label>
                        <input required className={inputClassName('serviceArea')} aria-invalid={fieldErrors.serviceArea ? 'true' : undefined} value={form.serviceArea} onChange={(event) => setFormValue('serviceArea', event.target.value)} />
                        {fieldErrorText('serviceArea')}
                      </div>
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Operations</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack intake-full">
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
                      <div className="intake-stack intake-full">
                        <label>Business Hours</label>
                        <input placeholder="Mon-Fri 8 AM - 6 PM" value={form.businessHours} onChange={(event) => setForm({ ...form, businessHours: event.target.value })} />
                      </div>
                      <div className="intake-inline-row intake-full">
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
                      <div className="intake-review-heading">Knowledge</div>
                      <div className="intake-muted">Review and refine the business knowledge your assistant should pull from.</div>
                    </div>
                  </div>
                  <div className="intake-review-list">
                    {knowledgeEntries.length === 0 ? (
                      <div className="intake-inline-note">No knowledge drafts were found. Add the details you want your assistant to know.</div>
                    ) : (
                      knowledgeEntries.map((entry, index) => (
                        <div key={`${entry.sectionType}-${index}`} className="intake-review-group">
                          <div className="intake-review-group-title">{entry.title}</div>
                          <div className="intake-stack">
                            <label>{entry.title}</label>
                            <textarea
                              placeholder={`Add ${entry.title.toLowerCase()} details`}
                              value={entry.contentText || ''}
                              onChange={(event) => updateKnowledgeEntry(index, event.target.value)}
                            />
                            <div className="intake-muted">
                              {entry.sourceUrl
                                ? `Source: ${entry.sourceType || 'website'} | ${entry.sourceUrl}`
                                : 'No source detected. Add or refine this manually.'}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="intake-panel">
                  <div className="intake-panel-header">
                    <div>
                      <div className="intake-review-heading">Guardrail Questions</div>
                      <div className="intake-muted">Review high-risk questions and adjust the draft answers before launch.</div>
                    </div>
                  </div>
                  <div className="intake-review-list">
                    {guardrailQuestionTests.length === 0 ? (
                      <div className="intake-inline-note">No guardrail questions are available yet.</div>
                    ) : (
                      guardrailQuestionTests.map((item, index) => (
                        <div key={`${item.questionText}-${index}`} className="intake-review-item">
                          <button
                            className="intake-review-trigger"
                            type="button"
                            aria-expanded={openGuardrailIndex === index}
                            onClick={() => setOpenGuardrailIndex((current) => (current === index ? -1 : index))}
                          >
                            <span className="intake-review-question">{item.questionText}</span>
                            <span className="intake-review-chevron" aria-hidden="true">{openGuardrailIndex === index ? '−' : '+'}</span>
                          </button>
                          {openGuardrailIndex === index && (
                            <div className="intake-review-content">
                              <div className="intake-stack">
                                <label>Draft Answer</label>
                                <textarea
                                  placeholder="Add the answer your assistant should use for this guardrail question."
                                  value={item.answer || ''}
                                  onChange={(event) => updateGuardrailQuestionAnswer(index, event.target.value)}
                                />
                                <div className="intake-muted">
                                  {item.sourceUrl
                                    ? `Source: ${item.sourceType || 'website'} | ${item.sourceUrl}`
                                    : 'No source detected. Add or refine this manually.'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="intake-muted intake-review-footer">Guardrail Questions are the review surface for risky topics like warranty, fees, guarantees, and emergency promises.</div>
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

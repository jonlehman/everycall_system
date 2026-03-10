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

const GOALS = [
  { value: 'reduce_missed_calls', label: 'Reduce missed calls' },
  { value: 'improve_response_time', label: 'Improve response time' },
  { value: 'book_more_jobs', label: 'Book more jobs' },
  { value: 'after_hours_coverage', label: 'After-hours coverage' },
  { value: 'better_dispatch', label: 'Better dispatching' },
  { value: 'call_quality', label: 'Improve call quality' }
];

function websiteFromEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 0) return '';
  const domain = raw.slice(at + 1);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return '';
  return `https://${domain}`;
}

export default function IntakePage() {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState({ message: 'Ready.', tone: 'normal' });
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [activation, setActivation] = useState(null);
  const [activationStatus, setActivationStatus] = useState({ message: '', tone: 'normal' });
  const [activationBusy, setActivationBusy] = useState(false);
  const [websiteEdited, setWebsiteEdited] = useState(false);

  const [form, setForm] = useState({
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
  });

  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServices, setSelectedServices] = useState([]);
  const [primaryGoals, setPrimaryGoals] = useState([]);
  const [faqDrafts, setFaqDrafts] = useState([]);
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  useEffect(() => {
    setSelectedServices([]);
    setServiceSearch('');
    setFaqDrafts([]);
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

  const setStatusMessage = (message, tone = 'normal') => setStatus({ message, tone });

  const updateEmail = (value) => {
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

  const toggleGoal = (goal) => {
    setPrimaryGoals((prev) => (prev.includes(goal) ? prev.filter((item) => item !== goal) : [...prev, goal]));
  };

  const updateFaqAnswer = (index, answer) => {
    setFaqDrafts((prev) => prev.map((item, idx) => (idx === index ? { ...item, answer } : item)));
  };

  const removeFaq = (index) => {
    setFaqDrafts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const saveFaqDraft = () => {
    setStatusMessage('FAQ saved locally. It will be included when you create your workspace.', 'ok');
  };

  const handleContinueFromFastStart = async () => {
    if (!form.ownerName.trim() || !form.ownerEmail.trim() || !form.industry) {
      setStatusMessage('Name, email, and industry are required.', 'bad');
      return;
    }

    if (!form.website.trim()) {
      const confirmed = window.confirm("You didn't add a website. Continue without analyzing your site?");
      if (!confirmed) return;
      setFaqDrafts([]);
      setStatusMessage('No website provided. Continue with manual setup.', 'warn');
      setStep(1);
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
        setStatusMessage(data?.message || 'Could not load enrichment preview. Continue with manual setup.', 'bad');
      } else {
        const previewFaqs = Array.isArray(data?.enrichment?.faqs) ? data.enrichment.faqs : [];
        setFaqDrafts(previewFaqs);
        if (!websiteEdited && data?.enrichment?.website) {
          setForm((prev) => ({ ...prev, website: data.enrichment.website }));
        }
        setStatusMessage(`Loaded ${previewFaqs.length} industry FAQ drafts. Unmatched items remain blank for review.`, 'ok');
      }
    } catch (err) {
      setFaqDrafts([]);
      setStatusMessage(err?.message || 'Could not load enrichment preview. Continue with manual setup.', 'bad');
    } finally {
      setEnrichmentBusy(false);
      setStep(1);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.businessName.trim()) {
      setStatusMessage('Business name is required.', 'bad');
      return;
    }
    if (!form.password || form.password.length < 8) {
      setStatusMessage('Password must be at least 8 characters.', 'bad');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setStatusMessage('Passwords do not match.', 'bad');
      return;
    }
    if (!form.serviceArea.trim()) {
      setStatusMessage('Service area is required.', 'bad');
      return;
    }
    if (selectedServices.length < 1) {
      setStatusMessage('Please add at least one service offered.', 'bad');
      return;
    }
    if (primaryGoals.length < 1) {
      setStatusMessage('Please select at least one primary goal.', 'bad');
      return;
    }

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
      primaryGoals,
      faqDrafts: faqDrafts.map((faq) => ({
        question: faq.question,
        answer: String(faq.answer || '').trim(),
        category: faq.category,
        sourceType: faq.sourceType || null,
        sourceUrl: faq.sourceUrl || null,
        sourceRetrievedAt: faq.sourceRetrievedAt || null,
        sourceConfidence: Number.isFinite(Number(faq.sourceConfidence)) ? Number(faq.sourceConfidence) : null
      }))
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
        setStatusMessage(data?.message || data?.error || `Request failed (${resp.status})`, 'bad');
        return;
      }

      const data = await resp.json();
      setStatusMessage('Trial created.', 'ok');
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

  if (activation) {
    return (
      <div className="intake-body">
        <div className="intake-shell">
          <div className="intake-hero">
            <div className="intake-brand">everycall</div>
            <h1 className="intake-headline">One final activation step.</h1>
            <div className="intake-subhead">Your workspace is ready. To activate call handling, route overflow/no-answer calls to your EveryCall number.</div>
          </div>
          <div className="card intake-card">
            <h1>Activate Call Routing</h1>
            <p className="intake-muted">Tenant: {activation.tenantKey || '-'}</p>
            <div className="intake-section-title">Your EveryCall Number</div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="stat">Voice Number</div>
              <div className="value" style={{ fontSize: 24 }}>
                {activation.voiceNumber || 'Provisioning in progress'}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Status: {activation.voiceStatus}
              </p>
            </div>
            <div className="intake-section-title">Required Setup</div>
            <p className="intake-muted">
              Route overflow or no-answer calls from your main business line to this EveryCall number. This is required for EveryCall to answer your calls.
            </p>
            <div className="intake-actions">
              <button className="btn brand" type="button" disabled={activationBusy} onClick={() => completeActivation('configured')}>
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
          <h1 className="intake-headline">Let&apos;s get this set up</h1>
          <div className="intake-subhead">Should take about 5 minutes.</div>
        </div>
        <div className="card intake-card">
          <h1>AI Assisted Setup</h1>
          <div className="intake-progress" aria-hidden="true">
            <span className={step === 0 ? 'active' : ''}></span>
            <span className={step === 1 ? 'active' : ''}></span>
          </div>

          <form className="intake-stack" onSubmit={handleSubmit}>
            {step === 0 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 1 — Business identity</div>
                <div className="intake-grid">
                  <div className="intake-stack">
                    <label>Owner Name</label>
                    <input required placeholder="Jane Smith" value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />
                  </div>
                  <div className="intake-stack">
                    <label>Owner Email</label>
                    <input type="email" required placeholder="jane@acme.com" value={form.ownerEmail} onChange={(event) => updateEmail(event.target.value)} />
                  </div>
                  <div className="intake-stack">
                    <label>Website</label>
                    <input
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
                    <select required value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })}>
                      <option value="">Select industry</option>
                      {INDUSTRIES.map((industry) => (
                        <option key={industry.value} value={industry.value}>{industry.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="intake-actions">
                  <button className="btn brand" type="button" onClick={handleContinueFromFastStart} disabled={enrichmentBusy}>
                    {enrichmentBusy ? 'Analyzing...' : 'Analyze your site'}
                  </button>
                  <span className="intake-muted" style={{ color: status.tone === 'bad' ? '#dc2626' : status.tone === 'ok' ? '#059669' : '#64748b' }}>{status.message}</span>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 2 — Review and finish setup</div>
                <div className="intake-page-hint">Confirm the key details below, then create your workspace.</div>

                <div className="intake-review-grid">
                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Business Profile</div>
                      <div className="intake-muted">Add the main business details and login credentials.</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack">
                        <label>Business Name</label>
                        <input required placeholder="Acme Plumbing" value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>Business Phone</label>
                        <input placeholder="+1 555 555 5555" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>Password</label>
                        <input type="password" required placeholder="Create a password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>Confirm Password</label>
                        <input type="password" required placeholder="Confirm password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
                      </div>
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Location & Coverage</div>
                      <div className="intake-muted">Set your business address and the areas you serve.</div>
                    </div>
                    <div className="intake-grid">
                      <div className="intake-stack intake-full">
                        <label>Address Line 1</label>
                        <input placeholder="123 Main St" value={form.address1} onChange={(event) => setForm({ ...form, address1: event.target.value })} />
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Address Line 2</label>
                        <input placeholder="Suite 200" value={form.address2} onChange={(event) => setForm({ ...form, address2: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>City</label>
                        <input placeholder="Seattle" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>State</label>
                        <input placeholder="WA" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
                      </div>
                      <div className="intake-stack">
                        <label>ZIP</label>
                        <input placeholder="98101" value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} />
                      </div>
                      <div className="intake-stack intake-full">
                        <label>Service Area</label>
                        <input required placeholder="Seattle + Eastside" value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })} />
                      </div>
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Operations</div>
                      <div className="intake-muted">Set the defaults the assistant should use when handling calls.</div>
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
                        <input type="number" min="0" placeholder="10" value={form.avgCalls} onChange={(event) => setForm({ ...form, avgCalls: event.target.value })} />
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
                      <div className="intake-muted">Choose the services callers are most likely to mention first.</div>
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
                    </div>
                  </section>

                  <section className="intake-panel">
                    <div className="intake-panel-header">
                      <div className="intake-section-title">Primary Goals</div>
                      <div className="intake-muted">Choose the outcomes you want EveryCall to improve first.</div>
                    </div>
                    <div className="intake-goal-panel">
                      <div className="intake-goal-list">
                        {GOALS.map((goal) => (
                          <label key={goal.value}>
                            <input
                              type="checkbox"
                              value={goal.value}
                              checked={primaryGoals.includes(goal.value)}
                              onChange={() => toggleGoal(goal.value)}
                            />
                            {goal.label}
                          </label>
                        ))}
                      </div>
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
                    <div className="intake-faq-count">{faqDrafts.length} draft{faqDrafts.length === 1 ? '' : 's'}</div>
                  </div>
                  <div className="intake-faq-list">
                  {faqDrafts.length === 0 ? (
                    <div className="intake-inline-note">No draft answers were found. You can add FAQs after setup in the FAQ Manager.</div>
                  ) : faqDrafts.map((faq, index) => (
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
                              placeholder="No explicit source evidence found yet. Leave blank or add an answer."
                              value={faq.answer || ''}
                              onChange={(event) => updateFaqAnswer(index, event.target.value)}
                            />
                            <div className="intake-actions intake-faq-actions">
                              <button className="btn" type="button" onClick={() => removeFaq(index)}>Remove</button>
                              <button className="btn intake-save-btn" type="button" onClick={saveFaqDraft}>Save</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                </section>

                <div className="intake-actions">
                  <button className="btn" type="button" onClick={() => setStep(0)}>Back</button>
                  <button className="btn brand" type="submit">Create workspace</button>
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

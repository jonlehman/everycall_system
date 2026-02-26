'use client';

import { useEffect, useMemo, useState } from 'react';
import './intake.css';

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

export default function IntakePage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState({ message: 'Ready.', tone: 'normal' });
  const [form, setForm] = useState({
    businessName: '',
    industry: '',
    phone: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    serviceArea: '',
    ownerName: '',
    ownerEmail: '',
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

  useEffect(() => {
    setSelectedServices([]);
    setServiceSearch('');
  }, [form.industry]);

  const filteredServices = useMemo(() => {
    const list = SERVICES_BY_INDUSTRY[form.industry] || [];
    if (!serviceSearch.trim()) return list;
    return list.filter((item) => item.toLowerCase().includes(serviceSearch.trim().toLowerCase()));
  }, [form.industry, serviceSearch]);

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

  const setStatusMessage = (message, tone = 'normal') => {
    setStatus({ message, tone });
  };

  const handleNext = () => {
    if (!form.businessName.trim() || !form.industry || !form.ownerName.trim() || !form.ownerEmail.trim()) {
      setStatusMessage('Please complete required fields before continuing.', 'bad');
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
    setPage(2);
    setStatusMessage('Ready.', 'normal');
  };

  const handleBack = () => {
    setPage(1);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatusMessage('Submitting...', 'warn');

    const payload = {
      businessName: form.businessName.trim(),
      industry: form.industry,
      ownerName: form.ownerName.trim(),
      ownerEmail: form.ownerEmail.trim(),
      password: form.password,
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
      averageCallsPerDay: Number(form.avgCalls || 0),
      emergencyServices: form.emergencyServices === 'true',
      servicesOffered: selectedServices,
      primaryGoal: primaryGoals
    };

    try {
      const resp = await fetch('/api/v1/tenants/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const msg = await resp.text();
        setStatusMessage(msg || `Request failed (${resp.status})`, 'bad');
        return;
      }

      const data = await resp.json();
      setStatusMessage('Trial created. Redirecting to workspace...', 'ok');
      const tenantKey = data.tenantKey || '';
      setTimeout(() => {
        window.location.href = `/client/overview?tenantKey=${encodeURIComponent(tenantKey)}`;
      }, 1200);
    } catch (err) {
      setStatusMessage(err.message || 'Request failed.', 'bad');
    }
  };

  return (
    <div className="intake-body">
      <div className="intake-shell">
        <div className="intake-hero">
          <div className="intake-brand">everycall <span>intake</span></div>
          <h1 className="intake-headline">Launch your 24/7 call assistant in minutes.</h1>
          <div className="intake-subhead">This short intake configures your AI receptionist, FAQs, routing, and onboarding defaults so you can start your free trial right away.</div>
        </div>
        <div className="card intake-card">
          <h1>Free Trial Intake</h1>
          <p className="intake-muted">Tell us about your service business so we can configure EveryCall for you.</p>
          <div className="intake-progress" aria-hidden="true">
            <span className={page === 1 ? 'active' : ''}></span>
            <span className={page === 2 ? 'active' : ''}></span>
          </div>
          <form className="intake-stack" onSubmit={handleSubmit}>
            {page === 1 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 1 — Business basics</div>
                <div className="intake-page-hint">We use this to set your workspace defaults and onboarding profile.</div>
                <div className="intake-section-title">Business Basics</div>
                <div className="intake-grid">
                  <div className="intake-stack">
                    <label>Business Name</label>
                    <input required placeholder="Acme Plumbing" value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} />
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
                  <div className="intake-stack">
                    <label>Phone</label>
                    <input placeholder="+1 555 555 5555" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                  </div>
                </div>
                <div className="intake-section-title">Business Address</div>
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
                    <input placeholder="Seattle + Eastside" value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })} />
                  </div>
                </div>
                <div className="intake-section-title">Owner & Ops</div>
                <div className="intake-grid">
                  <div className="intake-stack">
                    <label>Owner Name</label>
                    <input required placeholder="Jane Smith" value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />
                  </div>
                  <div className="intake-stack">
                    <label>Owner Email (Username)</label>
                    <input type="email" required placeholder="jane@acme.com" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} />
                  </div>
                  <div className="intake-stack">
                    <label>Password</label>
                    <input type="password" required placeholder="Create a password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
                  </div>
                  <div className="intake-stack">
                    <label>Confirm Password</label>
                    <input type="password" required placeholder="Confirm password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
                  </div>
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
                </div>
                <div className="intake-actions">
                  <button className="btn brand" type="button" onClick={handleNext}>Continue</button>
                </div>
              </div>
            )}

            {page === 2 && (
              <div className="intake-stack">
                <div className="intake-page-title">Step 2 — Call handling preferences</div>
                <div className="intake-page-hint">These settings help EveryCall build the right FAQ and intake prompts.</div>
                <div className="intake-section-title">Call Volume</div>
                <div className="intake-grid">
                  <div className="intake-stack">
                    <label>Average Calls Per Day</label>
                    <input type="number" min="0" placeholder="10" value={form.avgCalls} onChange={(event) => setForm({ ...form, avgCalls: event.target.value })} />
                  </div>
                  <div className="intake-stack">
                    <label>Emergency Services?</label>
                    <select value={form.emergencyServices} onChange={(event) => setForm({ ...form, emergencyServices: event.target.value })}>
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                </div>
                <div className="intake-section-title">Services Offered</div>
                <div className="intake-grid">
                  <div className="intake-stack intake-full">
                    <label>Services Offered</label>
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
                          <div className="intake-muted">No matches. Add a custom service.</div>
                        ) : (
                          filteredServices.map((service) => (
                            <button type="button" key={service} onClick={() => addService(service)}>{service}</button>
                          ))
                        )}
                      </div>
                      <div className="intake-actions">
                        <button className="btn" type="button" onClick={addCustomService}>Add Custom Service</button>
                        <span className="intake-muted">Search above, or type your own and add it.</span>
                      </div>
                      <div className="intake-actions" style={{ gap: 6 }}>
                        {selectedServices.map((service) => (
                          <button key={service} type="button" className="btn intake-tag-button" onClick={() => removeService(service)}>
                            {service} ✕
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="intake-section-title">Primary Goals</div>
                <div className="intake-goal-panel">
                  <div className="intake-page-hint" style={{ margin: '0 0 8px' }}>Select one or more goals.</div>
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
                <div className="intake-actions">
                  <button className="btn" type="button" onClick={handleBack}>Back</button>
                  <button className="btn brand" type="submit">Create Free Trial</button>
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

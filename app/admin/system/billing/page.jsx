'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { buildPlanDrafts, toneClass } from '../_components/systemShared';

function emptyConfig() {
  return {
    global_emergency_phrase: '',
    default_trial_days: 30,
    billing_plans_json: [],
    telnyx_sms_number: '',
    telnyx_sms_number_id: '',
    telnyx_sms_messaging_profile_id: ''
  };
}

export default function AdminSystemBillingPage() {
  const [config, setConfig] = useState(emptyConfig());
  const [defaultTrialDays, setDefaultTrialDays] = useState('30');
  const [billingPlans, setBillingPlans] = useState([]);
  const [status, setStatus] = useState({ message: 'Loading billing settings...', tone: 'warn' });

  const loadConfig = async () => {
    setStatus({ message: 'Loading billing settings...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config');
      const data = resp.ok ? await resp.json() : null;
      if (!data?.config) {
        setStatus({ message: 'Failed to load billing settings.', tone: 'bad' });
        return;
      }
      setConfig(data.config);
      setDefaultTrialDays(String(data.config.default_trial_days || 30));
      setBillingPlans(buildPlanDrafts(data.config.billing_plans_json || []));
      setStatus({ message: 'Billing settings loaded.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Failed to load billing settings.', tone: 'bad' });
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const updateBillingPlanField = (index, key, value) => {
    setBillingPlans((current) => current.map((plan, planIndex) => (
      planIndex === index ? { ...plan, [key]: value } : plan
    )));
  };

  const saveConfig = async () => {
    const normalizedTrialDays = Number(defaultTrialDays || 0);
    if (!Number.isInteger(normalizedTrialDays) || normalizedTrialDays < 1 || normalizedTrialDays > 365) {
      setStatus({ message: 'Default free trial days must be between 1 and 365.', tone: 'bad' });
      return;
    }

    const normalizedPlans = billingPlans.map((plan) => ({
        code: plan.code,
        stripeProductId: String(plan.stripeProductId || '').trim(),
        stripePriceId: String(plan.stripePriceId || '').trim(),
        stripeAnnualPriceId: String(plan.stripeAnnualPriceId || '').trim()
      }));

    setStatus({ message: 'Saving Stripe billing bindings...', tone: 'warn' });
    try {
      const resp = await fetch('/api/v1/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalEmergencyPhrase: config.global_emergency_phrase || '',
          defaultTrialDays: normalizedTrialDays,
          billingPlans: normalizedPlans,
          telnyxSmsNumber: config.telnyx_sms_number || '',
          telnyxSmsNumberId: config.telnyx_sms_number_id || '',
          telnyxSmsMessagingProfileId: config.telnyx_sms_messaging_profile_id || ''
        })
      });
      if (!resp.ok) {
        setStatus({ message: 'Save failed.', tone: 'bad' });
        return;
      }
      await loadConfig();
      setStatus({ message: 'Stripe billing bindings saved.', tone: 'ok' });
    } catch {
      setStatus({ message: 'Save failed.', tone: 'bad' });
    }
  };

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="m-0 text-xl font-semibold text-slate-900">Billing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Trial length and Stripe catalog bindings for the standard plans defined in code.
        </p>
      </div>

      <div className={toneClass(status.tone)}>{status.message}</div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Standard plan pricing, included call counts, and overage rates are code-owned. Change those in the app code first, then update the website separately.
        </div>

        <div className="max-w-xs">
          <label className="block">Global Free Trial Days</label>
          <input
            type="number"
            min="1"
            max="365"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={defaultTrialDays}
            onChange={(event) => setDefaultTrialDays(event.target.value)}
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {billingPlans.map((plan, index) => (
            <div key={plan.code || index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-700">{plan.label || plan.code || `Plan ${index + 1}`}</div>
              <div className="mt-3 grid gap-3">
                <div>
                  <label className="block">Label</label>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                    value={plan.label}
                    readOnly
                  />
                </div>
                <div>
                  <label className="block">Monthly Amount</label>
                  <div className="mt-2 flex items-center rounded-lg border border-slate-300 bg-slate-100 px-3">
                    <span className="text-sm text-slate-500">$</span>
                    <input
                      inputMode="decimal"
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm text-slate-600 focus:outline-none"
                      value={plan.monthlyAmount}
                      readOnly
                    />
                  </div>
                </div>
                <div>
                  <label className="block">Annual Amount</label>
                  <div className="mt-2 flex items-center rounded-lg border border-slate-300 bg-slate-100 px-3">
                    <span className="text-sm text-slate-500">$</span>
                    <input
                      inputMode="decimal"
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm text-slate-600 focus:outline-none"
                      value={plan.annualAmount}
                      readOnly
                    />
                  </div>
                </div>
                <div>
                  <label className="block">Included Calls</label>
                  <input
                    inputMode="numeric"
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                    value={plan.includedCalls}
                    readOnly
                  />
                </div>
                <div>
                  <label className="block">Overage Per Call</label>
                  <div className="mt-2 flex items-center rounded-lg border border-slate-300 bg-slate-100 px-3">
                    <span className="text-sm text-slate-500">$</span>
                    <input
                      inputMode="decimal"
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm text-slate-600 focus:outline-none"
                      value={plan.callOverageRate}
                      readOnly
                    />
                  </div>
                </div>
                <div>
                  <label className="block">Stripe Product ID</label>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={plan.stripeProductId}
                    onChange={(event) => updateBillingPlanField(index, 'stripeProductId', event.target.value)}
                    placeholder="prod_..."
                  />
                </div>
                <div>
                  <label className="block">Stripe Price ID</label>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={plan.stripePriceId}
                    onChange={(event) => updateBillingPlanField(index, 'stripePriceId', event.target.value)}
                    placeholder="price_..."
                  />
                </div>
                <div>
                  <label className="block">Stripe Annual Price ID</label>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={plan.stripeAnnualPriceId}
                    onChange={(event) => updateBillingPlanField(index, 'stripeAnnualPriceId', event.target.value)}
                    placeholder="price_..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveConfig}>Save Stripe Bindings</Button>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import BrandLogo from '../_components/BrandLogo';
import { INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY, normalizeMarketingAttribution } from '../../lib/intakeMarketingAttribution';
import './intake.css';

const PLANS = {
  starter: { name: 'Starter', calls: 25, overage: '$3.00', monthly: '$74.50', annual: '$759.90' },
  growth: { name: 'Growth', calls: 60, overage: '$2.00', monthly: '$124.50', annual: '$1,269.90' },
  pro: { name: 'Pro', calls: 100, overage: '$1.75', monthly: '$174.50', annual: '$1,779.90' }
};
const EMPTY = { businessName: '', website: '', businessCategory: '', loginEmail: '', leadPhone: '', companyDescription: '', planCode: '', billingInterval: '' };
const purchaseNeedsReview = (purchase) => String(purchase?.provisioningStatus || '').endsWith('_review');
const REVIEW_MESSAGE = 'Contact customerservice@everycall.io to review your existing signup. Do not make another payment while we check it.';
async function request(url, body) {
  const response = await fetch(url, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const messages = { existing_owner_login_required: 'Sign in to your existing owner account before continuing.', intake_owner_mismatch: 'This verification belongs to another owner. Sign in with the intended owner account.', verification_expired: 'This verification link has expired. Request another owner verification email.', paid_intake_release_pending: 'Paid signup is being prepared. Please contact customerservice@everycall.io for help; no payment has been collected.', verification_recently_sent: 'A verification email was sent recently. Check your inbox before requesting another link.' };
    const error = new Error(data.message || messages[data.error] || 'We could not complete this request. Please try again.');
    error.code = data.error;
    throw error;
  }
  return data;
}

export function IntakePageClient() {
  const [form, setForm] = useState(EMPTY);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Loading secure setup…');
  const [error, setError] = useState(false);
  const [attribution, setAttribution] = useState({});
  const [salesSignupToken, setSalesSignupToken] = useState('');
  const [salesRef, setSalesRef] = useState('');
  const [purchase, setPurchase] = useState(null);
  const [quote, setQuote] = useState(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);
  const [loginHref, setLoginHref] = useState('/login?next=%2Fintake');
  const plan = PLANS[form.planCode];
  const paymentVerified = purchase?.paymentStatus === 'paid';
  const paid = paymentVerified && Boolean(quote && !quote.requiresRecurringConsent);
  const needsReview = purchaseNeedsReview(purchase);
  const setupProgress = {
    queued: 'Your account is waiting for setup.',
    processing: 'We are preparing your account.',
    failed: 'Setup needs attention. Your verified payment is saved.',
    awaiting_knowledge_review: 'Your business knowledge is ready for review.',
    complete: 'Your account setup is complete.'
  }[purchase?.provisioningStatus] || 'Your payment is saved while setup is checked.';
  const dueNow = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((verified ? Number(quote?.amountDueNowCents || 0) : 10000) / 100);
  const update = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setConsentAccepted(false); if (verified) setQuote(null); };

  useEffect(() => {
    let canceled = false;
    const params = new URLSearchParams(window.location.search);
    const marketingParams = new URLSearchParams(params);
    for (const key of ['verify', 'salesRef', 'salesInvite', 'payment_status', 'session_id', 'website', 'business_name']) marketingParams.delete(key);
    const incomingAttribution = normalizeMarketingAttribution(marketingParams);
    try {
      const stored = normalizeMarketingAttribution(JSON.parse(window.sessionStorage.getItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY) || '{}'));
      const merged = normalizeMarketingAttribution({ ...stored, ...incomingAttribution, utm: { ...stored.utm, ...incomingAttribution.utm }, clickIds: { ...stored.clickIds, ...incomingAttribution.clickIds } });
      setAttribution(merged);
      window.sessionStorage.setItem(INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
    } catch { setAttribution(incomingAttribution); }
    const token = params.get('salesInvite') || '';
    const reference = params.get('salesRef') || '';
    setSalesRef(reference);
    setSalesSignupToken(token);
    const planCode = params.get('plan_interest') || params.get('plan') || '';
    const cycle = params.get('billing_cycle') || '';
    setForm((current) => ({ ...current, website: params.get('website') || '', businessName: params.get('business_name') || '', planCode: PLANS[planCode] ? planCode : '', billingInterval: cycle === 'annual' ? 'year' : cycle === 'monthly' ? 'month' : '' }));
    const apply = (data) => {
      if (canceled) return;
      if (data.intake) setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(data.intake).filter(([key]) => key in EMPTY)) }));
      if (data.intake?.marketingAttribution) setAttribution(normalizeMarketingAttribution(data.intake.marketingAttribution));
      setVerified(Boolean(data.verified));
      setPurchase(data.purchase || null);
      setQuote(data.quote || null);
      setMessage(purchaseNeedsReview(data.purchase) ? REVIEW_MESSAGE : data.verified ? 'Owner email verified. Refresh your payment summary, then review and accept recurring billing before Go.' : 'Choose your plan and verify your owner email to continue.');
      if (data.redirectUrl && data.purchase?.paymentStatus === 'paid') window.location.assign(data.redirectUrl);
    };
    async function load() {
      try {
        if (params.get('verify')) {
          const verificationToken = params.get('verify');
          setLoginHref(`/login?next=${encodeURIComponent(`/intake?verify=${encodeURIComponent(verificationToken)}`)}`);
          const clean = new URL(window.location.href);
          clean.searchParams.delete('verify');
          window.history.replaceState(null, '', clean.pathname + clean.search);
          apply(await request('/api/v1/intake/verify', { token: verificationToken }));
        } else {
          try { apply(await request('/api/v1/intake/status')); }
          catch (err) { if (err.code !== 'owner_verification_required') throw err; apply({ verified: false }); }
          if (reference || token) {
            const data = reference ? await request(`/api/v1/intake?salesRef=${encodeURIComponent(reference)}`) : await request('/api/v1/sales/signup-prefill/open', { token });
            if (!canceled && data.prefill) setForm((current) => ({ ...current, businessName: data.prefill.businessName || current.businessName, website: data.prefill.website || current.website, loginEmail: data.prefill.loginEmail || data.prefill.leadEmail || current.loginEmail, businessCategory: data.prefill.businessCategory || current.businessCategory, leadPhone: data.prefill.leadPhone || current.leadPhone }));
          }
        }
      } catch (err) {
        if (!canceled) { setError(true); setMessage(err.message); setLoginRequired(err.code === 'existing_owner_login_required'); }
      } finally { if (!canceled) setBusy(false); }
    }
    void load();
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!verified || !purchase || purchase.tenantKey) return undefined;
    let active = true;
    const timer = window.setInterval(() => {
      void request('/api/v1/intake/status').then((data) => {
        if (!active) return;
        setPurchase(data.purchase || null);
        if (purchaseNeedsReview(data.purchase)) setMessage(REVIEW_MESSAGE);
        if (data.redirectUrl && data.purchase?.paymentStatus === 'paid') window.location.assign(data.redirectUrl);
      }).catch(() => {});
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [verified, Boolean(purchase), purchase?.tenantKey]);

  async function refreshPaymentSummary() {
    setBusy(true); setError(false);
    try {
      const data = await request('/api/v1/intake/quote', form);
      setQuote(data.quote || null); setConsentAccepted(false);
      setMessage('Payment summary updated. Review the terms and accept recurring billing before Go.');
    } catch (failure) { setError(true); setMessage(failure.message); }
    finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (needsReview) { setError(true); setMessage(REVIEW_MESSAGE); return; }
    if (!plan || !['month', 'year'].includes(form.billingInterval)) { setError(true); setMessage('Select a plan and billing interval.'); return; }
    if (verified && (!quote?.token || quote.ready === false || !consentAccepted)) { setError(true); setMessage('Review your payment and accept the recurring billing terms before Go.'); return; }
    setBusy(true); setError(false); setMessage(verified ? 'Checking your purchase securely…' : 'Sending your owner verification link…');
    try {
      const body = { ...form, consentAccepted, quoteToken: quote?.token, marketingAttribution: attribution, ...(salesSignupToken ? { salesSignupToken } : {}), ...(salesRef ? { salesRef } : {}) };
      const data = await request(verified ? '/api/v1/intake/checkout' : '/api/v1/intake', body);
      if (data.url) { window.location.assign(data.url); return; }
      if (data.status === 'paid' && data.redirectUrl) { window.location.assign(data.redirectUrl); return; }
      setMessage(data.message || 'Check your owner email for a secure verification link. Your account starts after verified payment.');
    } catch (err) {
      setError(true); setMessage(err.message); setLoginRequired(err.code === 'existing_owner_login_required');
    } finally { setBusy(false); }
  }

  return (
    <div className="intake-shell">
      <header className="intake-topbar"><div className="intake-topbar-inner"><BrandLogo className="h-10 w-[172px]" imageClassName="h-full w-full object-contain" priority /><a href="/login">Sign in</a></div></header>
      <main className="intake-main"><div className="intake-canvas">
        <section className="intake-hero"><p className="intake-eyebrow">Secure paid setup</p><h1>Get started with EveryCall</h1><p>{verified && quote && quote.amountDueNowCents !== 10000 ? 'Your saved purchase is checked before payment. Review the verified amount below.' : '$100 includes setup and your first calendar month with your selected plan’s full call allowance.'}</p></section>
        <form className="intake-card" onSubmit={submit}>
          <div role={error ? 'alert' : 'status'} aria-live="polite" className={`intake-status ${error ? 'bad' : 'normal'}`}>{message}</div>
          {loginRequired ? <p><a href={loginHref}>Sign in to verify your existing owner account</a></p> : null}
          {needsReview ? <section aria-label="Signup review"><h2>{paymentVerified ? 'Payment verified — review needed' : 'Signup needs review'}</h2><p>Contact <a href="mailto:customerservice@everycall.io">customerservice@everycall.io</a> to review your existing signup. Do not make another payment while we check it.</p>{purchase.tenantKey ? <a href="/client/account/billing">Open Billing and setup progress</a> : null}</section> : paid ? <section><h2>Payment verified — setup in progress</h2><p>{setupProgress} Production calls begin after knowledge and phone setup are ready.</p>{purchase.tenantKey ? <a href="/client/account/billing">Open Billing and setup progress</a> : <p>You can keep this page open or contact customerservice@everycall.io for help. Your verified purchase is retained.</p>}</section> : null}
          <div className="intake-form-stack">
            <div className="intake-stack"><label htmlFor="business-name">Business name</label><input id="business-name" required autoComplete="organization" value={form.businessName} onChange={(e) => update('businessName', e.target.value)} /></div>
            <div className="intake-stack"><label htmlFor="website">Business website (optional)</label><input id="website" autoComplete="url" placeholder="https://example.com" value={form.website} onChange={(e) => update('website', e.target.value)} /><p className="intake-muted">No website? We can help with setup after payment.</p></div>
            <div className="intake-stack"><label htmlFor="owner-email">Owner email</label><input id="owner-email" required type="email" autoComplete="email" readOnly={verified} value={form.loginEmail} onChange={(e) => update('loginEmail', e.target.value)} /></div>
            <div className="intake-stack"><label htmlFor="lead-phone">Mobile number for lead alerts (optional)</label><input id="lead-phone" type="tel" autoComplete="tel" value={form.leadPhone} onChange={(e) => update('leadPhone', e.target.value)} /><p className="intake-muted">Text alerts require confirmation. Reply STOP to opt out.</p></div>
            <fieldset className="intake-plan-options"><legend>Choose your plan</legend>{Object.entries(PLANS).map(([code, item]) => <label key={code} className="intake-checkbox-card"><input type="radio" name="plan" required checked={form.planCode === code} onChange={() => update('planCode', code)} /><span><strong>{item.name}</strong> — {item.calls} calls each month; {item.overage} per additional billable call, billed monthly.<br />Later base: {item.monthly}/month or {item.annual}/year.</span></label>)}</fieldset>
            <fieldset className="intake-plan-options"><legend>Choose your later base billing interval</legend><label className="intake-checkbox-card"><input type="radio" name="interval" required checked={form.billingInterval === 'month'} onChange={() => update('billingInterval', 'month')} />Monthly</label><label className="intake-checkbox-card"><input type="radio" name="interval" required checked={form.billingInterval === 'year'} onChange={() => update('billingInterval', 'year')} />Annual — save 15% on base service</label></fieldset>
            {plan && form.billingInterval && !needsReview ? <section className="intake-purchase-review" aria-label="Purchase summary"><h2>Review before Go</h2><p><strong>{plan.name} · {form.billingInterval === 'year' ? 'Annual' : 'Monthly'} · {verified ? quote ? `${dueNow} due now` : 'Checking your purchase…' : '$100 due now'}</strong></p>{verified && quote?.isLiveTest ? <p><strong>Authorized $1 live test — this is a real charge.</strong></p> : null}{verified && quote?.kind === 'consent' ? <p>Your verified setup payment is retained. Complete payment-method and recurring consent setup without another setup charge.</p> : null}<p>Your first calendar month starts on successful payment and includes {plan.calls} calls. Additional billable calls cost {plan.overage} each, billed monthly, including the first month and every month on annual billing.</p><p>At the end of that first calendar month, {form.billingInterval === 'year' ? `${plan.annual} is due for the following 12 months, renewing yearly` : `${plan.monthly} is due, renewing monthly`}. Your call allowance resets monthly with no carryover.</p><p>Plan changes and cancellation take effect at the paid term’s end. Refund or dispute assistance: <a href="mailto:customerservice@everycall.io">customerservice@everycall.io</a>.</p></section> : null}
          </div>
          {verified && !paid && !needsReview ? <button type="button" disabled={busy || !plan || !form.billingInterval} onClick={refreshPaymentSummary}>Refresh payment summary</button> : null}
          {verified && quote?.ready === false ? <p role="status">An earlier payment link is still being checked. Contact customerservice@everycall.io for secure recovery before making another payment.</p> : null}
          {verified && plan && quote && !needsReview ? <label className="intake-checkbox-card" htmlFor="recurring-consent"><input id="recurring-consent" type="checkbox" required checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} disabled={busy || paid} /><span>I agree to {form.billingInterval === 'year' ? `${plan.annual} per year` : `${plan.monthly} per month`} after the included first calendar month, with {plan.calls} included calls each month and {plan.overage} per additional billable call, billed monthly. My subscription renews until canceled at its term end.</span></label> : null}
          <div className="intake-actions"><button className="btn primary" type="submit" disabled={busy || paid || needsReview || (verified && (!quote?.token || quote.ready === false || !consentAccepted))}>{busy ? 'Please wait…' : verified ? 'Go' : 'Verify owner email'}</button></div>
          <p className="intake-muted">{needsReview ? "You can return to this page to check review status. Contact support before making another payment." : "Go opens secure payment and recurring subscription consent. A payment return link does not confirm payment. Existing verified purchases are checked before collecting setup again."}</p>
        </form>
      </div></main>
    </div>
  );
}
export default function IntakePage() { return <IntakePageClient />; }

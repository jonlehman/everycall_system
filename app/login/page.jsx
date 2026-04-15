'use client';

import { useState } from 'react';
import Link from 'next/link';
import BrandLogo from '../_components/BrandLogo';

function resolveClientRedirect(nextPath, tenantKey) {
  const fallback = `/client/get-started?tenantKey=${encodeURIComponent(tenantKey || 'default')}`;
  const normalized = String(nextPath || '').trim();
  if (!normalized.startsWith('/client')) return fallback;
  if (normalized.startsWith('//')) return fallback;
  return normalized;
}

function getStatusTone(message) {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('signed in')) return 'ok';
  if (normalized.includes('signing in')) return 'neutral';
  return 'bad';
}

export default function LoginPage() {
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [clientStatus, setClientStatus] = useState('');
  const currentYear = new Date().getFullYear();

  const login = async ({ email, password, role, setStatus, onSuccess }) => {
    setStatus('Signing in...');
    const resp = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setStatus(data?.error || 'Login failed.');
      return;
    }
    const data = await resp.json();
    setStatus('Signed in.');
    onSuccess(data);
  };

  const submitClientLogin = async (event) => {
    event.preventDefault();
    await login({
      email: clientEmail,
      password: clientPassword,
      role: 'tenant',
      setStatus: setClientStatus,
      onSuccess: (data) => {
        const tenantKey = data?.tenantKey || 'default';
        const nextPath = new URLSearchParams(window.location.search).get('next');
        window.location.href = resolveClientRedirect(nextPath, tenantKey);
      }
    });
  };

  const statusTone = getStatusTone(clientStatus);

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#121c2a] selection:bg-[#dbe1ff] selection:text-[#00174b]">
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-20">
        <div className="relative w-full max-w-[408px] py-12">
          <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[#eff4ff] opacity-60 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-[#d6e0f3] opacity-40 blur-3xl" />

          <div className="relative z-20 overflow-hidden rounded-xl bg-white px-8 py-10 shadow-[0_40px_80px_-15px_rgba(18,28,42,0.04)]">
            <div className="flex justify-center pb-[0.75in] pt-[0.25in]">
              <BrandLogo
                href="/"
                className="h-11 w-[190px]"
                imageClassName="h-full w-full object-contain"
                priority
              />
            </div>

            <div className="mb-10 text-center">
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-[#121c2a]">Login to Your Workspace</h1>
              <p className="text-sm leading-relaxed text-[#434655]">
                By logging in, you agree to the EveryCall{' '}
                <Link className="font-semibold text-[#004ac6] transition-colors hover:underline" href="/terms">
                  terms and conditions
                </Link>{' '}
                and{' '}
                <Link className="font-semibold text-[#004ac6] transition-colors hover:underline" href="/privacy">
                  privacy policy
                </Link>.
              </p>
            </div>

            <form className="space-y-6" onSubmit={submitClientLogin}>
              <div className="space-y-2">
                <label className="block text-[0.75rem] font-semibold tracking-wide text-[#434655]" htmlFor="email">
                  Email Address
                </label>
                <div className="group relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-[#737686] transition-colors group-focus-within:text-[#004ac6]">
                    mail
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="architect@everycall.com"
                    value={clientEmail}
                    onChange={(event) => setClientEmail(event.target.value)}
                    className="w-full rounded-lg border-0 bg-white py-3 pl-[5.25rem] pr-4 text-[#121c2a] ring-1 ring-[#c3c6d7]/40 transition-all placeholder:text-[#737686]/60 focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-end justify-between gap-4">
                  <label className="block text-[0.75rem] font-semibold tracking-wide text-[#434655]" htmlFor="password">
                    Password
                  </label>
                  <Link className="text-[0.75rem] font-semibold text-[#004ac6] transition-colors hover:text-[#2563eb]" href="/forgot-password">
                    Forgot Password?
                  </Link>
                </div>
                <div className="group relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-[#737686] transition-colors group-focus-within:text-[#004ac6]">
                    lock
                  </span>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={clientPassword}
                    onChange={(event) => setClientPassword(event.target.value)}
                    className="w-full rounded-lg border-0 bg-white py-3 pl-[5.25rem] pr-4 text-[#121c2a] ring-1 ring-[#c3c6d7]/40 transition-all placeholder:text-[#737686]/60 focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20"
                  />
                </div>
              </div>

              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563eb] py-4 font-semibold text-[#eeefff] shadow-lg shadow-[#004ac6]/10 transition-all hover:bg-[#004ac6] active:scale-[0.98]"
                type="submit"
              >
                <span>Sign In</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>

              {clientStatus ? (
                <div
                  className={`rounded-lg px-4 py-3 text-sm ${
                    statusTone === 'ok'
                      ? 'bg-emerald-50 text-emerald-800'
                      : statusTone === 'bad'
                        ? 'bg-rose-50 text-rose-800'
                        : 'bg-[#eff4ff] text-[#434655]'
                  }`}
                >
                  {clientStatus}
                </div>
              ) : null}
            </form>

            <div className="mt-10 border-t border-[#c3c6d7]/20 pt-10 text-center">
              <p className="text-sm text-[#434655]">
                New to the system?
                <Link className="ml-1 font-semibold text-[#004ac6] transition-all hover:underline hover:decoration-2 hover:underline-offset-4" href="/intake">
                  Create an Account
                </Link>
              </p>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-3 gap-6 opacity-40 grayscale transition-all hover:opacity-80 hover:grayscale-0">
            <div className="flex items-center justify-center">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAHUUITHzW0-NysgWBUgB_YWrG1EP4HO3SV6RV2Pl52GzOm4yluSsf9i3vjz3il8F48cWc23LnAFLTZC4PNP2FZel7B0pgADwI-Y_DW697hm4-8FEkRPek0YeQkMCUspcXit4Hjls6aIc-xx1oPj0WZpgCe0W0UArQpeKne6kwmLSStLbYJFMoGb05o2TsxKpQCrMK2TjSat5FawfHzOEqfjtNoc-DJWhxc3faFXRmWkZEFUYSlGfE6H7raV23sgk3TCDK-alg0uZ7k"
                alt="ISO 27001 Certification"
                className="h-8 object-contain"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAq7CeHrjOSgJnf4u4Mh6hk_7nkTz4V74gGJKCNtGPjPgNMuvZD8drpJuRzaMz3qehxTc7kfKCSrzxDKibQeMAXHXwsW1ERoK5_Lm4S7ffCnxEWr1R_57hRrmhugIQkEXAxXLQsv0SakV7bmcQVbaHndEJN4lChMjSKUtPVcaIQ3JwpA5JHE79unCFvQ8dDJgThMAmkCAPOjblVeP0oBqjP_n55Du9ypKkryeRbHlgojNzAM2PHpfwM8eW978uHwiNzXzc6a_GMLEdT"
                alt="SOC2 Compliance"
                className="h-8 object-contain"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAlDcCzHQ8nTpyJwh5s5paMsOPmOoMWoKj-U2tIM2dkFsojdUHepxjA8kAhBCf-_NrkI7qeJMAro5nL01EQgHdXexP_j-Wa_CmHfS_pprBNUIiEwCzJQFiu5DlRIKgybx8znhXn93usrJOGqm1XSQBYxEAalMliBQEpIBVvKEGaNw0u848BHmzrEhZf4YV_ITe5VtgD2Nj7bh_tfkKV89llnbDFyyW8a96Bn7htcgNSMMn_XZPGyfX-M-QzhKg4cz_qR1dLtZyEoNoy"
                alt="GDPR Compliance"
                className="h-8 object-contain"
              />
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto flex w-full flex-col items-center justify-between gap-4 border-t border-slate-200/10 bg-slate-50 px-8 py-8 md:flex-row">
        <div className="text-sm font-semibold text-slate-900">EveryCall</div>
        <div className="flex gap-6">
          <Link className="text-xs tracking-widest text-slate-400 transition-colors hover:text-[#004ac6]" href="/privacy">
            Privacy
          </Link>
          <Link className="text-xs tracking-widest text-slate-400 transition-colors hover:text-[#004ac6]" href="/terms">
            Terms
          </Link>
          <a className="text-xs tracking-widest text-slate-400 transition-colors hover:text-[#004ac6]" href="mailto:support@everycall.io">
            Support
          </a>
        </div>
        <div className="text-xs tracking-widest text-slate-400 opacity-80">© {currentYear} EveryCall Precision Systems</div>
      </footer>
    </div>
  );
}

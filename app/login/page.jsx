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
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-8">
        <div className="relative -translate-y-[1.5in] w-full max-w-[408px] py-12">
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
                <div className="group flex items-center rounded-lg bg-white ring-1 ring-[#c3c6d7]/40 transition-all focus-within:ring-2 focus-within:ring-[#004ac6]/20">
                  <span className="pointer-events-none flex h-full w-16 shrink-0 items-center justify-center">
                    <span className="material-symbols-outlined text-[20px] text-[#737686] transition-colors group-focus-within:text-[#004ac6]">
                      mail
                    </span>
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="architect@everycall.com"
                    value={clientEmail}
                    onChange={(event) => setClientEmail(event.target.value)}
                    className="min-w-0 flex-1 border-0 bg-transparent py-3 pl-2 pr-4 text-[#121c2a] placeholder:text-[#737686]/60 focus:outline-none focus:ring-0"
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
                <div className="group flex items-center rounded-lg bg-white ring-1 ring-[#c3c6d7]/40 transition-all focus-within:ring-2 focus-within:ring-[#004ac6]/20">
                  <span className="pointer-events-none flex h-full w-16 shrink-0 items-center justify-center">
                    <span className="material-symbols-outlined text-[20px] text-[#737686] transition-colors group-focus-within:text-[#004ac6]">
                      lock
                    </span>
                  </span>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    value={clientPassword}
                    onChange={(event) => setClientPassword(event.target.value)}
                    className="min-w-0 flex-1 border-0 bg-transparent py-3 pl-2 pr-4 text-[#121c2a] placeholder:text-[#737686]/60 focus:outline-none focus:ring-0"
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

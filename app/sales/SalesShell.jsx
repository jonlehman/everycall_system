'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

export default function SalesShell({ children }) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const isLogin = pathname === '/sales/login';

  const signOut = async () => {
    setSigningOut(true);
    try {
      await Promise.all([
        fetch('/api/v1/sales/auth/logout', { method: 'POST' }),
        fetch('/api/v1/auth/logout', { method: 'POST' })
      ]);
    } finally {
      window.location.assign('/sales/login');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      {!isLogin ? (
        <header className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4">
            <span className="text-base font-semibold">EveryCall Sales</span>
            <button
              type="button"
              className="text-sm font-semibold text-blue-700 hover:underline disabled:opacity-50"
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
      ) : null}
      <main className={isLogin ? 'mx-auto max-w-md px-5 py-16' : 'mx-auto max-w-screen-2xl px-5 py-6'}>
        {children}
      </main>
    </div>
  );
}

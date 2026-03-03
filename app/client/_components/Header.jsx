'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function Header() {
  const [tenantName, setTenantName] = useState('Tenant');
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const openMenu = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, 500);
  };

  useEffect(() => {
    const handleClick = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/settings`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.tenant?.name) return;
        setTenantName(data.tenant.name);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <div className="mb-4 flex justify-end">
      <div
        className="relative flex cursor-pointer items-center gap-2"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onMouseEnter={openMenu}
        onMouseLeave={(e) => {
          if (!(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) {
            scheduleClose();
          }
        }}
      >
        <div className="flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-100 p-1.5 text-emerald-700">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="block">
            <circle cx="12" cy="8" r="4" fill="currentColor"></circle>
            <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
          </svg>
        </div>
        <div className="text-right">
          <div className="font-semibold">{tenantName || 'Tenant'}</div>
          <div className="text-xs text-slate-500">Account</div>
        </div>

        {open ? (
          <div
            className="absolute right-0 top-12 z-20 min-w-[220px] rounded-lg border border-border bg-card p-2 shadow-md"
            onMouseEnter={openMenu}
            onMouseLeave={(e) => {
              if (!(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) {
                scheduleClose();
              }
            }}
          >
            <div className="px-2 py-1 text-xs uppercase tracking-wide text-slate-500">Setup</div>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/faq">Questions and Answers</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/team">Team Users</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/routing">Call Routing</Link>
            <Link className="mb-1 block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100" href="/client/settings">Account Settings</Link>
            <div className="my-2 h-px bg-slate-200"></div>
            <button
              className="block w-full rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              type="button"
              onClick={async () => {
                await fetch('/api/v1/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

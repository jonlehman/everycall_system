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
    <div className="topbar" style={{ justifyContent: 'flex-end' }}>
      <div
        className="user-chip"
        style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative', cursor: 'pointer' }}
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
        <div className="badge ok" style={{ borderRadius: 999, padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
            <circle cx="12" cy="8" r="4" fill="currentColor"></circle>
            <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
          </svg>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>{tenantName || 'Tenant'}</div>
          <div className="muted" style={{ fontSize: 12 }}>Account</div>
        </div>

        {open ? (
          <div
            className="card"
            style={{ position: 'absolute', right: 0, top: 48, minWidth: 220, display: 'block', padding: 8 }}
            onMouseEnter={openMenu}
            onMouseLeave={(e) => {
              if (!(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) {
                scheduleClose();
              }
            }}
          >
            <div className="muted" style={{ fontSize: 12, padding: '6px 8px' }}>Setup</div>
            <Link className="menu-link" style={{ display: 'block', padding: 8, borderRadius: 8, color: 'inherit', textDecoration: 'none', marginBottom: 4 }} href="/client/faq">Questions and Answers</Link>
            <Link className="menu-link" style={{ display: 'block', padding: 8, borderRadius: 8, color: 'inherit', textDecoration: 'none', marginBottom: 4 }} href="/client/team">Team Users</Link>
            <Link className="menu-link" style={{ display: 'block', padding: 8, borderRadius: 8, color: 'inherit', textDecoration: 'none', marginBottom: 4 }} href="/client/routing">Call Routing</Link>
            <Link className="menu-link" style={{ display: 'block', padding: 8, borderRadius: 8, color: 'inherit', textDecoration: 'none', marginBottom: 4 }} href="/client/settings">Account Settings</Link>
            <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }}></div>
            <button
              className="menu-link"
              style={{ display: 'block', padding: 8, borderRadius: 8, color: 'inherit', textDecoration: 'none', border: 'none', background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer' }}
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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clientPrimaryNavItems, pathMatches } from './navigation';

function iconName(kind) {
  if (kind === 'dashboard') return 'dashboard';
  if (kind === 'reports') return 'query_stats';
  if (kind === 'calls') return 'phone_in_talk';
  if (kind === 'setup') return 'construction';
  if (kind === 'team') return 'groups';
  if (kind === 'account') return 'settings';
  if (kind === 'users') return 'manage_accounts';
  return 'person_4';
}

export default function Sidebar({ collapsed = false, onToggle }) {
  const pathname = usePathname();
  const [knowledgeReady, setKnowledgeReady] = useState(false);
  const [billingActivated, setBillingActivated] = useState(false);
  const supportActive = pathname === '/client/support' || pathname.startsWith('/client/support/');

  useEffect(() => {
    let mounted = true;
    const applyKnowledge = (payload) => {
      const builds = Array.isArray(payload?.builds) ? payload.builds : [];
      const hasPublishedBuild = builds.some((build) => String(build?.status || '').trim().toLowerCase() === 'published');
      setKnowledgeReady(hasPublishedBuild);
    };
    const loadKnowledge = () => {
      fetch('/api/v1/knowledge/builds', { cache: 'no-store' })
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((data) => {
          if (!mounted) return;
          applyKnowledge(data || null);
        })
        .catch(() => {
          if (!mounted) return;
          setKnowledgeReady(false);
        });
    };
    const loadBilling = () => {
      fetch('/api/v1/billing', { cache: 'no-store' })
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((data) => {
          if (!mounted) return;
          setBillingActivated(Boolean(data?.billing?.hasStripeSubscription));
        })
        .catch(() => {
          if (!mounted) return;
          setBillingActivated(false);
        });
    };
    const handleKnowledgeUpdated = (event) => {
      if (!mounted) return;
      applyKnowledge(event?.detail || null);
    };
    loadKnowledge();
    loadBilling();
    window.addEventListener('everycall:knowledge-updated', handleKnowledgeUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('everycall:knowledge-updated', handleKnowledgeUpdated);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <aside
      className={`hidden border-r border-slate-200/70 bg-[#eff4ff] px-4 py-6 md:fixed md:left-0 md:top-16 md:flex md:h-[calc(100vh-64px)] md:flex-col ${
        collapsed ? 'md:w-24' : 'md:w-64'
      }`}
    >
      <nav className="flex flex-1 flex-col gap-1">
        {clientPrimaryNavItems
          .filter((item) => !(item.hideWhenBillingActive && billingActivated))
          .map((item) => {
          const active = pathMatches(pathname, item);
          const showReceptionistDot = !collapsed && item.icon === 'setup';
          const receptionistReady = knowledgeReady;
          return (
            <div key={item.href} className="flex flex-col">
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all ${
                  active
                    ? 'border-l-4 border-[#004ac6] bg-white font-semibold text-[#004ac6] shadow-sm'
                    : 'font-medium text-slate-600 hover:translate-x-1 hover:bg-[#dfe9fc] hover:text-slate-900'
                } ${collapsed ? 'justify-center border-l-0 px-2' : ''}`}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={active ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
                >
                  {iconName(item.icon)}
                </span>
                {!collapsed ? (
                  <>
                    <span>{item.label}</span>
                    {showReceptionistDot ? (
                      <span
                        className={`ml-auto h-2 w-2 rounded-full ${receptionistReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </>
                ) : null}
              </Link>

              {!collapsed && active && Array.isArray(item.children) && item.children.length ? (
                <div className="mt-1 ml-10 flex flex-col gap-1">
                  {item.children.map((child) => {
                    const childActive = pathMatches(pathname, child);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-all ${
                          childActive
                            ? 'bg-white font-semibold text-[#004ac6] shadow-sm'
                            : 'font-medium text-slate-600 hover:bg-[#dfe9fc] hover:text-slate-900'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${childActive ? 'bg-[#004ac6]' : 'bg-slate-400'}`} aria-hidden="true" />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-slate-200/70 pt-5">
        {!collapsed ? (
          <button
            className="mb-4 w-full rounded-md border border-[#004ac6]/20 bg-[#004ac6]/5 py-2.5 text-sm font-bold text-[#004ac6] transition-colors hover:bg-[#004ac6]/10"
            type="button"
            onClick={onToggle}
          >
            Collapse Sidebar
          </button>
        ) : (
          <button
            className="mb-4 flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        )}

        {!collapsed ? (
          <>
            <Link
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                supportActive
                  ? 'border-l-4 border-[#004ac6] bg-white font-semibold text-[#004ac6] shadow-sm'
                  : 'text-slate-600 hover:bg-[#dfe9fc]'
              }`}
              href="/client/support"
            >
              <span className="material-symbols-outlined text-[20px]">contact_support</span>
              Support
            </Link>
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-[#dfe9fc]"
              type="button"
              onClick={handleLogout}
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
              Sign Out
            </button>
          </>
        ) : null}
      </div>
    </aside>
  );
}

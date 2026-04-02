'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clientPrimaryNavItems, pathMatches } from './navigation';

function iconName(kind) {
  if (kind === 'dashboard') return 'dashboard';
  if (kind === 'calls') return 'phone_in_talk';
  if (kind === 'team') return 'groups';
  if (kind === 'account') return 'settings';
  return 'person_4';
}

export default function Sidebar({ collapsed = false, onToggle }) {
  const pathname = usePathname();
  const [knowledgeReady, setKnowledgeReady] = useState(false);

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
    const handleKnowledgeUpdated = (event) => {
      if (!mounted) return;
      applyKnowledge(event?.detail || null);
    };
    loadKnowledge();
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
      <div className={`mb-6 ${collapsed ? 'px-0 text-center' : 'px-2'}`}>
        {collapsed ? (
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-white text-sm font-bold text-[#004ac6] shadow-sm">
            EC
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-slate-900">Client Workspace</h2>
          </>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {clientPrimaryNavItems.map((item) => {
          const active = pathMatches(pathname, item);
          const showReceptionistDot = !collapsed && item.icon === 'receptionist';
          const receptionistReady = knowledgeReady;
          return (
            <Link
              key={item.href}
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
            <Link className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-[#dfe9fc]" href="/client/account/support">
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

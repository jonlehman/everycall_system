'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppFooter from '../_components/AppFooter';
import Sidebar from './_components/Sidebar';
import Header from './_components/Header';
import { clientPrimaryNavItems, pathMatches } from './_components/navigation';

export default function ClientLayoutShell({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('everycall.sidebar.collapsed');
      if (saved === '1') setSidebarCollapsed(true);
    } catch {}
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('everycall.sidebar.collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9ff] text-[#121c2a]">
      <Header />
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <nav className="sticky top-16 z-40 mt-16 border-b border-slate-200/70 bg-[#eff4ff] px-4 py-2 md:hidden">
        <div className="flex gap-2 overflow-x-auto">
          {clientPrimaryNavItems.map((item) => {
            const active = pathMatches(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white text-[#004ac6] shadow-sm'
                    : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className={`flex flex-1 flex-col pt-0 transition-[padding-left] duration-200 ${sidebarCollapsed ? 'md:pl-24' : 'md:pl-64'} md:pt-16`}>
        <div className="flex flex-1 flex-col bg-[#f8f9ff]">
          <div className="flex-1">
            {children}
          </div>
          <AppFooter />
        </div>
      </main>
    </div>
  );
}

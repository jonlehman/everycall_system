 'use client';

import { useEffect, useState } from 'react';
import Sidebar from './_components/Sidebar';
import Header from './_components/Header';
import './client.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ClientLayout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
    <div className={`shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <main className="main">
        <Header />
        {children}
      </main>
    </div>
  );
}

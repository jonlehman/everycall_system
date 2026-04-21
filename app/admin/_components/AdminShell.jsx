'use client';

import AdminSupportNotifications from './AdminSupportNotifications';
import { usePathname } from 'next/navigation';
import AppFooter from '../../_components/AppFooter';
import AdminSidebar from './AdminSidebar';

export default function AdminShell({ children }) {
  const pathname = usePathname();
  if (pathname === '/admin/login') {
    return (
      <div className="flex min-h-screen flex-col">
        <main className="main flex-1">{children}</main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="shell">
      <AdminSidebar />
      <main className="main flex min-h-screen flex-col">
        <div className="sticky top-0 z-30 -mb-2 border-b border-slate-200/70 bg-white/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center justify-end">
            <AdminSupportNotifications />
          </div>
        </div>
        <div className="flex-1">
          {children}
        </div>
        <AppFooter />
      </main>
    </div>
  );
}

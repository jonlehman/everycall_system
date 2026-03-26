'use client';

import { usePathname } from 'next/navigation';
import AppFooter from '../../_components/AppFooter';
import AdminSidebar from './AdminSidebar';

export default function AdminShell({ children }) {
  const pathname = usePathname();
  if (pathname === '/admin/login') {
    return (
      <>
        <main className="main">{children}</main>
        <AppFooter />
      </>
    );
  }

  return (
    <div className="shell">
      <AdminSidebar />
      <main className="main">
        {children}
        <AppFooter />
      </main>
    </div>
  );
}

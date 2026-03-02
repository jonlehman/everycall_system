'use client';

import { usePathname } from 'next/navigation';
import AdminSidebar from './AdminSidebar';

export default function AdminShell({ children }) {
  const pathname = usePathname();
  if (pathname === '/admin/login') {
    return <main className="main">{children}</main>;
  }

  return (
    <div className="shell">
      <AdminSidebar />
      <main className="main">{children}</main>
    </div>
  );
}

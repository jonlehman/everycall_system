'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { label: 'Overview', href: '/admin/overview', group: 'Platform' },
  { label: 'Tenants', href: '/admin/tenants', group: 'Platform' },
  { label: 'Call Monitoring', href: '/admin/monitoring', group: 'Platform' },
  { label: 'Provisioning Jobs', href: '/admin/jobs', group: 'Platform' },
  { label: 'Industry Config', href: '/admin/industries', group: 'Controls' },
  { label: 'Admin Users', href: '/admin/users', group: 'Controls' },
  { label: 'System Config', href: '/admin/system', group: 'Controls' },
  { label: 'Audit Log', href: '/admin/audit', group: 'Controls' }
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const groups = ['Platform', 'Controls'];

  return (
    <aside className="sidebar">
      <div className="logo">every<span>call</span> admin</div>
      {groups.map((group) => (
        <div className="nav-group" key={group}>
          <div className="nav-label">{group}</div>
          {items.filter((i) => i.group === group).map((item) => (
            <Link
              key={item.href}
              className={`nav-btn${pathname.startsWith(item.href) ? ' active' : ''}`}
              href={item.href}
              style={{ display: 'block' }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 'auto', paddingTop: 12 }}>
        <button
          className="nav-btn"
          style={{ width: '100%', textAlign: 'left' }}
          type="button"
          onClick={async () => {
            await fetch('/api/v1/auth/logout', { method: 'POST' });
            window.location.href = '/login';
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

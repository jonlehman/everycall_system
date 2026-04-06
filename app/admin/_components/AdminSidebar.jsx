'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { label: 'Overview', href: '/admin/overview', group: 'Platform' },
  { label: 'Tenants', href: '/admin/tenants', group: 'Platform' },
  { label: 'Monitoring', href: '/admin/monitoring', group: 'Platform' },
  { label: 'Support', href: '/admin/support', group: 'Platform' },
  { label: 'Provisioning Jobs', href: '/admin/jobs', group: 'Platform' },
  { label: 'Phone Numbers', href: '/admin/phone-numbers', group: 'Platform' },
  { label: 'Costs', href: '/admin/usage', group: 'Platform' },
  { label: 'Admin Users', href: '/admin/users', group: 'Controls' },
  {
    label: 'System Config',
    href: '/admin/system',
    group: 'Controls',
    children: [
      { label: 'General', href: '/admin/system/general' },
      { label: 'Billing', href: '/admin/system/billing' },
      { label: 'Coupons', href: '/admin/system/coupons' },
      { label: 'SMS', href: '/admin/system/sms' },
      { label: 'Prompts', href: '/admin/system/prompts' }
    ]
  },
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
          {items.filter((item) => item.group === group).map((item) => (
            <div key={item.href}>
              <Link
                className={`nav-btn${pathname === item.href || pathname.startsWith(`${item.href}/`) ? ' active' : ''}`}
                href={item.href}
                style={{ display: 'block' }}
              >
                {item.label}
              </Link>
              {item.children && pathname.startsWith(`${item.href}/`) ? (
                <div className="sub-menu">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      className={`nav-btn${pathname === child.href ? ' active' : ''}`}
                      href={child.href}
                      style={{ display: 'block' }}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
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
            window.location.href = '/admin/login';
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

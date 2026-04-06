'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const items = [
  { label: 'Overview', href: '/admin/overview', group: 'Operations' },
  { label: 'Support', href: '/admin/support', group: 'Operations' },
  { label: 'Monitoring', href: '/admin/monitoring', group: 'Operations' },
  { label: 'Provisioning Jobs', href: '/admin/jobs', group: 'Operations' },
  { label: 'Phone Numbers', href: '/admin/phone-numbers', group: 'Operations' },
  { label: 'Tenants', href: '/admin/tenants', group: 'Tenants' },
  { label: 'Costs', href: '/admin/usage', group: 'Finance' },
  { label: 'Billing Report', href: '/admin/billing-report', group: 'Finance' },
  { label: 'Admin Users', href: '/admin/users', group: 'Platform' },
  {
    label: 'System Config',
    href: '/admin/system',
    group: 'Platform',
    children: [
      { label: 'General', href: '/admin/system/general' },
      { label: 'Billing', href: '/admin/system/billing' },
      { label: 'Coupons', href: '/admin/system/coupons' },
      { label: 'SMS', href: '/admin/system/sms' },
      { label: 'Prompts', href: '/admin/system/prompts' }
    ]
  },
  { label: 'Audit Log', href: '/admin/audit', group: 'Platform' }
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const groups = ['Operations', 'Tenants', 'Finance', 'Platform'];
  const [expandedItems, setExpandedItems] = useState({});

  useEffect(() => {
    setExpandedItems((current) => {
      const next = { ...current };
      for (const item of items) {
        if (!item.children) continue;
        if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
          next[item.href] = true;
        } else if (!(item.href in next)) {
          next[item.href] = false;
        }
      }
      return next;
    });
  }, [pathname]);

  const toggleExpanded = (href) => {
    setExpandedItems((current) => ({
      ...current,
      [href]: !current[href]
    }));
  };

  return (
    <aside className="sidebar">
      <div className="logo">every<span>call</span> admin</div>
      {groups.map((group) => (
        <div className="nav-group" key={group}>
          <div className="nav-label">{group}</div>
          {items.filter((item) => item.group === group).map((item) => (
            <div key={item.href}>
              {item.children ? (
                <div className={`nav-parent-row${pathname === item.href || pathname.startsWith(`${item.href}/`) ? ' active' : ''}`}>
                  <Link
                    className={`nav-btn${pathname === item.href || pathname.startsWith(`${item.href}/`) ? ' active' : ''}`}
                    href={item.href}
                    style={{ display: 'block' }}
                  >
                    {item.label}
                  </Link>
                  <button
                    type="button"
                    className="nav-toggle"
                    aria-label={expandedItems[item.href] ? `Collapse ${item.label}` : `Expand ${item.label}`}
                    aria-expanded={Boolean(expandedItems[item.href])}
                    onClick={() => toggleExpanded(item.href)}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {expandedItems[item.href] ? 'expand_more' : 'chevron_right'}
                    </span>
                  </button>
                </div>
              ) : (
                <Link
                  className={`nav-btn${pathname === item.href || pathname.startsWith(`${item.href}/`) ? ' active' : ''}`}
                  href={item.href}
                  style={{ display: 'block' }}
                >
                  {item.label}
                </Link>
              )}
              {item.children && expandedItems[item.href] ? (
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

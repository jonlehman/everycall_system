'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const sections = [
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { label: 'Overview', href: '/admin/overview' },
      { label: 'Support', href: '/admin/support' },
      { label: 'Monitoring', href: '/admin/monitoring' },
      { label: 'Provisioning Jobs', href: '/admin/jobs' },
      { label: 'Phone Numbers', href: '/admin/phone-numbers' }
    ]
  },
  {
    key: 'tenants',
    label: 'Tenants',
    items: [
      { label: 'Tenants', href: '/admin/tenants' }
    ]
  },
  {
    key: 'finance',
    label: 'Finance',
    items: [
      { label: 'Costs', href: '/admin/usage' },
      { label: 'Billing Report', href: '/admin/billing-report' }
    ]
  },
  {
    key: 'system',
    label: 'System Config',
    items: [
      { label: 'General', href: '/admin/system/general' },
      { label: 'Billing', href: '/admin/system/billing' },
      { label: 'Coupons', href: '/admin/system/coupons' },
      { label: 'SMS', href: '/admin/system/sms' },
      { label: 'Prompts', href: '/admin/system/prompts' },
      { label: 'Admin Users', href: '/admin/users' }
    ]
  }
];

const standaloneItems = [
  { label: 'Audit Log', href: '/admin/audit' }
];

function matchesPath(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function findSectionForPath(pathname) {
  const matched = sections.find((section) => section.items.some((item) => matchesPath(pathname, item.href)));
  return matched?.key || null;
}

export default function AdminSidebar() {
  const pathname = usePathname();
  const initialOpen = useMemo(() => findSectionForPath(pathname), [pathname]);
  const [openSection, setOpenSection] = useState(initialOpen);

  useEffect(() => {
    const matchedSection = findSectionForPath(pathname);
    if (matchedSection) {
      setOpenSection(matchedSection);
    }
  }, [pathname]);

  const toggleSection = (sectionKey) => {
    setOpenSection((current) => current === sectionKey ? null : sectionKey);
  };

  return (
    <aside className="sidebar">
      <div className="logo">every<span>call</span> admin</div>

      {sections.map((section) => {
        const expanded = openSection === section.key;
        const sectionActive = section.items.some((item) => matchesPath(pathname, item.href));
        return (
          <div className="nav-group" key={section.key}>
            <button
              type="button"
              className={`nav-group-toggle${sectionActive ? ' active' : ''}`}
              aria-expanded={expanded}
              onClick={() => toggleSection(section.key)}
            >
              <span className="nav-label">{section.label}</span>
              <span className="material-symbols-outlined text-[18px]">
                {expanded ? 'expand_more' : 'chevron_right'}
              </span>
            </button>
            {expanded ? (
              <div className="sub-menu">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    className={`nav-btn${matchesPath(pathname, item.href) ? ' active' : ''}`}
                    href={item.href}
                    style={{ display: 'block' }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="nav-group">
        {standaloneItems.map((item) => (
          <Link
            key={item.href}
            className={`nav-btn${matchesPath(pathname, item.href) ? ' active' : ''}`}
            href={item.href}
            style={{ display: 'block' }}
          >
            {item.label}
          </Link>
        ))}
      </div>

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

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const setupPaths = ['/client/setup', '/client/faq', '/client/team', '/client/routing', '/client/settings'];

const navItems = [
  { href: '/client/overview', label: 'Overview', icon: 'OV' },
  { href: '/client/calls', label: 'Calls', icon: 'CL' },
  { href: '/client/setup', label: 'Setup', icon: 'ST' }
];

const setupSubItems = [
  { href: '/client/faq', label: 'Questions and Answers', icon: 'QA' },
  { href: '/client/team', label: 'Team Users', icon: 'TM' },
  { href: '/client/routing', label: 'Call Routing', icon: 'RT' },
  { href: '/client/settings', label: 'Account Settings', icon: 'AC' }
];

export default function Sidebar({ collapsed = false, onToggle }) {
  const pathname = usePathname();
  const showSetup = setupPaths.some((p) => pathname.startsWith(p));

  const linkClass = (path) => `nav-btn${pathname.startsWith(path) ? ' active' : ''}`;

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="logo">{collapsed ? 'ec' : <>every<span>call</span></>}</div>
        <button className="nav-btn collapse-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '>>' : '<<'}
        </button>
      </div>

      <div className="nav-group">
        {!collapsed ? <div className="nav-label">Operations</div> : null}
        {navItems.map((item) => (
          <Link key={item.href} className={linkClass(item.href)} href={item.href} title={collapsed ? item.label : undefined}>
            <span className="nav-icon">{item.icon}</span>
            {!collapsed ? <span>{item.label}</span> : null}
          </Link>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '14px 0' }} />
      <div className="nav-group">
        {!collapsed && showSetup ? (
          <div className="sub-menu" style={{ marginLeft: 10, display: 'grid', gap: 6, marginTop: 8 }}>
            {setupSubItems.map((item) => (
              <Link key={item.href} className={linkClass(item.href)} style={{ fontSize: 12 }} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

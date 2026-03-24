'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clientPrimaryNavItems, pathMatches } from './navigation';

function NavIcon({ kind }) {
  if (kind === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19h16" />
        <rect x="5" y="11" width="3.5" height="6" rx="1" />
        <rect x="10.25" y="8" width="3.5" height="9" rx="1" />
        <rect x="15.5" y="5" width="3.5" height="12" rx="1" />
      </svg>
    );
  }
  if (kind === 'calls') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 4.5c.8-.8 2.1-.8 2.9 0l1.6 1.6c.8.8.8 2.1 0 2.9l-1.2 1.2a14.5 14.5 0 0 0 3 3 14.5 14.5 0 0 0 3 3l1.2-1.2c.8-.8 2.1-.8 2.9 0l1.6 1.6c.8.8.8 2.1 0 2.9l-.9.9c-1.1 1.1-2.7 1.6-4.2 1.2-2.9-.8-6-2.8-8.8-5.6S4.7 9.2 3.9 6.3C3.5 4.8 4 3.2 5.1 2.1z" />
      </svg>
    );
  }
  if (kind === 'team') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="9" r="3" />
        <circle cx="17" cy="10" r="2.4" />
        <path d="M4.5 19c.3-2.6 2.5-4.5 5.2-4.5h1.1c2.7 0 4.9 1.9 5.2 4.5" />
        <path d="M14.7 18.8c.3-1.8 1.8-3.1 3.7-3.1h.4c.5 0 1 .1 1.4.3" />
      </svg>
    );
  }
  if (kind === 'account') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 19c0-3.2 3.1-5.5 7-5.5s7 2.3 7 5.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.8 1.8 0 0 1-1.3 3.1h-.2a1 1 0 0 0-.9.6 1.8 1.8 0 0 1-3.4-.5 1 1 0 0 0-.9-.7h-2a1 1 0 0 0-.9.7 1.8 1.8 0 0 1-3.4.5 1 1 0 0 0-.9-.6h-.2a1.8 1.8 0 0 1-1.3-3.1l.1-.1A1 1 0 0 0 4.6 15a1 1 0 0 0-.8-.6h-.1a1.8 1.8 0 0 1 0-3.6h.1a1 1 0 0 0 .8-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.8 1.8 0 0 1 1.3-3.1h.2a1 1 0 0 0 .9-.6 1.8 1.8 0 0 1 3.4.5 1 1 0 0 0 .9.7h2a1 1 0 0 0 .9-.7 1.8 1.8 0 0 1 3.4-.5 1 1 0 0 0 .9.6h.2a1.8 1.8 0 0 1 1.3 3.1l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .8.6h.1a1.8 1.8 0 0 1 0 3.6h-.1a1 1 0 0 0-.8.6z" />
    </svg>
  );
}

export default function Sidebar({ collapsed = false, onToggle }) {
  const pathname = usePathname();
  const linkClass = (item) => `nav-btn${pathMatches(pathname, item) ? ' active' : ''}`;

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="logo">{collapsed ? 'ec' : <>every<span>call</span></>}</div>
        <button className="nav-btn collapse-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '>>' : '<<'}
        </button>
      </div>

      <div className="nav-group">
        {!collapsed ? <div className="nav-label">Workspace</div> : null}
        {clientPrimaryNavItems.map((item) => (
          <Link key={item.href} className={linkClass(item)} href={item.href} title={collapsed ? item.label : undefined}>
            <span className="nav-icon"><NavIcon kind={item.icon} /></span>
            {!collapsed ? <span>{item.label}</span> : null}
          </Link>
        ))}
      </div>
    </aside>
  );
}

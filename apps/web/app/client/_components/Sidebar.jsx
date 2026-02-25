'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const setupPaths = ['/client/setup', '/client/faq', '/client/team', '/client/routing', '/client/settings'];

function withTenant(path, tenantKey) {
  return tenantKey ? `${path}?tenantKey=${encodeURIComponent(tenantKey)}` : path;
}

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const showSetup = setupPaths.some((p) => pathname.startsWith(p));

  const linkClass = (path) => `nav-btn${pathname.startsWith(path) ? ' active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="logo">every<span>call</span></div>

      <div className="nav-group">
        <div className="nav-label">Operations</div>
        <Link className={linkClass('/client/overview')} href={withTenant('/client/overview', tenantKey)}>Overview</Link>
        <Link className={linkClass('/client/calls')} href={withTenant('/client/calls', tenantKey)}>Calls</Link>
        <Link className={linkClass('/client/dispatch')} href={withTenant('/client/dispatch', tenantKey)}>Dispatch Board</Link>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '14px 0' }} />
      <div className="nav-group">
        <Link className={linkClass('/client/setup')} href={withTenant('/client/setup', tenantKey)}>Setup</Link>
        {showSetup ? (
          <div className="sub-menu" style={{ marginLeft: 10, display: 'grid', gap: 6, marginTop: 8 }}>
            <Link className={linkClass('/client/faq')} style={{ fontSize: 12 }} href={withTenant('/client/faq', tenantKey)}>Questions and Answers</Link>
            <Link className={linkClass('/client/team')} style={{ fontSize: 12 }} href={withTenant('/client/team', tenantKey)}>Team Users</Link>
            <Link className={linkClass('/client/routing')} style={{ fontSize: 12 }} href={withTenant('/client/routing', tenantKey)}>Call Routing</Link>
            <Link className={linkClass('/client/settings')} style={{ fontSize: 12 }} href={withTenant('/client/settings', tenantKey)}>Account Settings</Link>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

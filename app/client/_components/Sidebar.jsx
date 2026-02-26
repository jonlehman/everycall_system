'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const setupPaths = ['/client/setup', '/client/faq', '/client/team', '/client/routing', '/client/settings'];

export default function Sidebar() {
  const pathname = usePathname();
  const showSetup = setupPaths.some((p) => pathname.startsWith(p));

  const linkClass = (path) => `nav-btn${pathname.startsWith(path) ? ' active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="logo">every<span>call</span></div>

      <div className="nav-group">
        <div className="nav-label">Operations</div>
        <Link className={linkClass('/client/overview')} style={{ display: 'block' }} href="/client/overview">Overview</Link>
        <Link className={linkClass('/client/calls')} style={{ display: 'block' }} href="/client/calls">Calls</Link>
        <Link className={linkClass('/client/dispatch')} style={{ display: 'block' }} href="/client/dispatch">Dispatch Board</Link>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '14px 0' }} />
      <div className="nav-group">
        <Link className={linkClass('/client/setup')} href="/client/setup">Setup</Link>
        {showSetup ? (
          <div className="sub-menu" style={{ marginLeft: 10, display: 'grid', gap: 6, marginTop: 8 }}>
            <Link className={linkClass('/client/faq')} style={{ fontSize: 12 }} href="/client/faq">Questions and Answers</Link>
            <Link className={linkClass('/client/team')} style={{ fontSize: 12 }} href="/client/team">Team Users</Link>
            <Link className={linkClass('/client/routing')} style={{ fontSize: 12 }} href="/client/routing">Call Routing</Link>
            <Link className={linkClass('/client/settings')} style={{ fontSize: 12 }} href="/client/settings">Account Settings</Link>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

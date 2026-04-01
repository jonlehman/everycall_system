'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '../../../lib/utils';

const POLL_INTERVAL_MS = 10000;

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function readNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission || 'default';
}

export default function AdminSupportNotifications() {
  const pathname = usePathname();
  const [permission, setPermission] = useState('default');
  const [counts, setCounts] = useState({ unread: 0, unassigned: 0 });
  const previousUnreadRef = useRef(null);
  const latestSeenKeyRef = useRef('');

  const loadSummary = async ({ silent = false } = {}) => {
    try {
      const data = await fetchJson('/api/v1/admin/support?summary=1');
      const nextCounts = data?.counts || { unread: 0, unassigned: 0 };
      const latestUnread = data?.latestUnreadConversation || null;
      const latestKey = latestUnread
        ? `${latestUnread.id}:${latestUnread.lastMessageAt || latestUnread.updatedAt || ''}:${latestUnread.adminUnreadCount || 0}`
        : '';

      setCounts({
        unread: Number(nextCounts.unread || 0),
        unassigned: Number(nextCounts.unassigned || 0)
      });

      const previousUnread = previousUnreadRef.current;
      const hasNewUnread =
        previousUnread !== null &&
        Number(nextCounts.unread || 0) > 0 &&
        latestKey &&
        latestKey !== latestSeenKeyRef.current;

      if (hasNewUnread && permission === 'granted' && latestUnread) {
        const shouldNotify = document.hidden || !pathname.startsWith('/admin/support');
        if (shouldNotify) {
          const notification = new window.Notification('New support request', {
            body: `${latestUnread.tenantKey || 'Tenant'}: ${latestUnread.subject || 'Support conversation'}`,
            tag: `support:${latestUnread.id}`,
            requireInteraction: false
          });
          notification.onclick = () => {
            window.focus();
            window.location.href = '/admin/support';
          };
        }
        latestSeenKeyRef.current = latestKey;
      } else if (latestKey) {
        latestSeenKeyRef.current = latestKey;
      }

      previousUnreadRef.current = Number(nextCounts.unread || 0);
    } catch (error) {
      if (!silent) {
        console.error('admin_support_notification_load_failed', error);
      }
    }
  };

  useEffect(() => {
    setPermission(readNotificationPermission());
    void loadSummary();
  }, [pathname]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPermission(readNotificationPermission());
      void loadSummary({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [permission, pathname]);

  const enableBrowserAlerts = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const nextPermission = await window.Notification.requestPermission();
    setPermission(nextPermission || 'default');
    if ((nextPermission || 'default') === 'granted') {
      latestSeenKeyRef.current = latestSeenKeyRef.current || '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      {permission !== 'granted' ? (
        <button
          type="button"
          onClick={enableBrowserAlerts}
          className="hidden rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 md:inline-flex"
        >
          {permission === 'denied' ? 'Browser Alerts Blocked' : 'Enable Browser Alerts'}
        </button>
      ) : (
        <span className="hidden text-xs font-medium text-emerald-700 md:inline-flex">
          Browser alerts on
        </span>
      )}

      <Link
        href="/admin/support"
        className={cn(
          'relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50',
          pathname.startsWith('/admin/support') ? 'border-[#004ac6]/20 bg-[#eff4ff] text-[#004ac6]' : ''
        )}
        aria-label="Open support inbox"
        title="Open support inbox"
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {counts.unread > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[#004ac6] px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {counts.unread > 99 ? '99+' : counts.unread}
          </span>
        ) : null}
        {counts.unassigned > 0 ? (
          <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
        ) : null}
      </Link>
    </div>
  );
}

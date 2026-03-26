'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../lib/utils';
import { pathMatches } from './navigation';

export default function SectionTabs({ items = [] }) {
  const pathname = usePathname();
  const [goLiveReady, setGoLiveReady] = useState(false);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const hasGoLiveTab = Array.isArray(items) && items.some((item) => item?.href === '/client/receptionist/go-live');
  const hasNotificationsTab = Array.isArray(items) && items.some((item) => item?.href === '/client/receptionist/notifications');

  useEffect(() => {
    if (!hasGoLiveTab && !hasNotificationsTab) return undefined;
    let mounted = true;
    const applyReadiness = (payload) => {
      const status = String(payload?.status || '').trim().toLowerCase();
      setGoLiveReady(status === 'ready_for_go_live' || status === 'live');
    };
    const applyNotifications = (payload) => {
      const settings = payload?.settings || payload || {};
      setNotificationsReady(Boolean(settings?.lead_alerts_enabled) && Boolean(settings?.lead_alert_sms_enabled) && Boolean(settings?.lead_alert_email_enabled));
    };
    const loadReadiness = () => {
      fetch('/api/v1/knowledge/readiness', { cache: 'no-store' })
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((data) => {
          if (!mounted) return;
          applyReadiness(data?.readiness);
        })
        .catch(() => {
          if (!mounted) return;
          setGoLiveReady(false);
        });
    };
    const loadNotifications = () => {
      fetch('/api/v1/settings', { cache: 'no-store' })
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((data) => {
          if (!mounted) return;
          applyNotifications(data?.settings ? data : null);
        })
        .catch(() => {
          if (!mounted) return;
          setNotificationsReady(false);
        });
    };
    const handleReadinessUpdated = (event) => {
      if (!mounted) return;
      applyReadiness(event?.detail || null);
    };
    const handleNotificationsUpdated = (event) => {
      if (!mounted) return;
      applyNotifications(event?.detail || null);
    };
    if (hasGoLiveTab) loadReadiness();
    if (hasNotificationsTab) loadNotifications();
    window.addEventListener('everycall:readiness-updated', handleReadinessUpdated);
    window.addEventListener('everycall:notifications-updated', handleNotificationsUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('everycall:readiness-updated', handleReadinessUpdated);
      window.removeEventListener('everycall:notifications-updated', handleNotificationsUpdated);
    };
  }, [hasGoLiveTab, hasNotificationsTab]);

  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  return (
    <div className="flex h-full items-end gap-8 overflow-x-auto">
        {items.map((item) => {
          const active = pathMatches(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'inline-flex h-full items-center whitespace-nowrap border-b-2 px-1 text-sm transition-colors',
                active
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent font-medium text-slate-500 hover:text-slate-800'
              )}
            >
              <span>{item.label}</span>
              {item.href === '/client/receptionist/notifications' ? (
                <span
                  className={`ml-2 h-2 w-2 rounded-full ${notificationsReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  aria-hidden="true"
                />
              ) : null}
              {item.href === '/client/receptionist/go-live' ? (
                <span
                  className={`ml-2 h-2 w-2 rounded-full ${goLiveReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          );
        })}
    </div>
  );
}

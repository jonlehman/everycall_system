'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../lib/utils';
import { pathMatches } from './navigation';

export default function SectionTabs({ items = [] }) {
  const pathname = usePathname();
  const [receptionistReady, setReceptionistReady] = useState(false);
  const hasGoLiveTab = Array.isArray(items) && items.some((item) => item?.href === '/client/receptionist/go-live');

  useEffect(() => {
    if (!hasGoLiveTab) return undefined;
    let mounted = true;
    fetch('/api/v1/knowledge/readiness')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!mounted) return;
        const status = String(data?.readiness?.status || '').trim().toLowerCase();
        setReceptionistReady(status === 'ready_for_go_live' || status === 'live');
      })
      .catch(() => {
        if (!mounted) return;
        setReceptionistReady(false);
      });
    return () => {
      mounted = false;
    };
  }, [hasGoLiveTab]);

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
              {item.href === '/client/receptionist/go-live' ? (
                <span
                  className={`ml-2 h-2 w-2 rounded-full ${receptionistReady ? 'bg-[#006229]' : 'bg-amber-500'}`}
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          );
        })}
    </div>
  );
}

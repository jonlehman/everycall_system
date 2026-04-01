'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../lib/utils';
import { pathMatches } from './navigation';

export default function SectionTabs({ items = [] }) {
  const pathname = usePathname();
  const [knowledgeReady, setKnowledgeReady] = useState(false);
  const hasKnowledgeTab = Array.isArray(items) && items.some((item) => item?.href === '/client/receptionist/knowledge');

  useEffect(() => {
    if (!hasKnowledgeTab) return undefined;
    let mounted = true;
    const applyKnowledge = (payload) => {
      const builds = Array.isArray(payload?.builds) ? payload.builds : [];
      const hasPublishedBuild = builds.some((build) => String(build?.status || '').trim().toLowerCase() === 'published');
      setKnowledgeReady(hasPublishedBuild);
    };
    const loadKnowledge = () => {
      fetch('/api/v1/knowledge/builds', { cache: 'no-store' })
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((data) => {
          if (!mounted) return;
          applyKnowledge(data || null);
        })
        .catch(() => {
          if (!mounted) return;
          setKnowledgeReady(false);
        });
    };
    const handleKnowledgeUpdated = (event) => {
      if (!mounted) return;
      applyKnowledge(event?.detail || null);
    };
    if (hasKnowledgeTab) loadKnowledge();
    window.addEventListener('everycall:knowledge-updated', handleKnowledgeUpdated);
    return () => {
      mounted = false;
      window.removeEventListener('everycall:knowledge-updated', handleKnowledgeUpdated);
    };
  }, [hasKnowledgeTab]);

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
              {item.href === '/client/receptionist/knowledge' ? (
                <span
                  className={`ml-2 h-2 w-2 rounded-full ${knowledgeReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          );
        })}
    </div>
  );
}

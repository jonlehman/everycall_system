'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../lib/utils';
import { pathMatches } from './navigation';

export default function SectionTabs({ items = [] }) {
  const pathname = usePathname();

  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = pathMatches(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

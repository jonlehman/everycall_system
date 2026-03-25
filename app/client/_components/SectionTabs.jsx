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
    <div className="border-b border-slate-200 px-1">
      <div className="flex flex-wrap gap-5">
        {items.map((item) => {
          const active = pathMatches(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'inline-flex items-center border-b-2 px-1 pb-3 pt-1 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
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

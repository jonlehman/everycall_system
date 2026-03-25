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
              {item.label}
            </Link>
          );
        })}
    </div>
  );
}

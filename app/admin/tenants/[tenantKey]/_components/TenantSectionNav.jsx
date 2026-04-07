'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { buildTenantAdminSectionHref, TENANT_ADMIN_SECTION_ITEMS } from './tenantAdminSections';

export default function TenantSectionNav() {
  const pathname = usePathname();
  const params = useParams();
  const tenantKey = String(params.tenantKey || '');

  return (
    <nav className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {TENANT_ADMIN_SECTION_ITEMS.map((item) => {
          const href = buildTenantAdminSectionHref(tenantKey, item.segment);
          const active = pathname === href;
          return (
            <Link
              key={item.key}
              href={href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

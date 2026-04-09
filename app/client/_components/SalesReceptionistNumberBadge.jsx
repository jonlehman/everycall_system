'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';
import { cn } from '../../../lib/utils';

const SALES_RECEPTIONIST_NUMBER_TOOLTIP = 'Your sales receptionist will answer this line. Forward desired calls from your business phone system to this line. Can handle multiple calls at once.';

export default function SalesReceptionistNumberBadge({ className = '' }) {
  const [readiness, setReadiness] = useState({
    showSalesReceptionistNumber: false,
    phoneNumber: '',
    label: 'Setting things up'
  });

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/settings')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!mounted) return;
        const nextReadiness = data?.salesReceptionistReadiness || null;
        setReadiness({
          showSalesReceptionistNumber: Boolean(nextReadiness?.showSalesReceptionistNumber),
          phoneNumber: String(nextReadiness?.phoneNumber || '').trim(),
          label: String(nextReadiness?.label || 'Setting things up').trim() || 'Setting things up'
        });
      })
      .catch(() => {
        if (!mounted) return;
        setReadiness({
          showSalesReceptionistNumber: false,
          phoneNumber: '',
          label: 'Setting things up'
        });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Link
      href="/client/account/general"
      title={SALES_RECEPTIONIST_NUMBER_TOOLTIP}
      className={cn(
        'group relative inline-flex items-center gap-2 rounded-md border border-slate-200 bg-[#eff4ff] px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-[#dfe9fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2',
        className
      )}
      aria-label={SALES_RECEPTIONIST_NUMBER_TOOLTIP}
    >
      <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">Sales Receptionist Number</span>
      <span className="font-semibold text-slate-900">
        {readiness.showSalesReceptionistNumber
          ? (formatPhoneDisplay(readiness.phoneNumber) || readiness.phoneNumber)
          : readiness.label}
      </span>
      <span className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-lg group-hover:block group-focus-visible:block lg:w-80">
        {SALES_RECEPTIONIST_NUMBER_TOOLTIP}
      </span>
    </Link>
  );
}

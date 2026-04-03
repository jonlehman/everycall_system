'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

export default function SalesReceptionistNumberBadge() {
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
      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-[#eff4ff] px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-[#dfe9fc]"
    >
      <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">Sales Receptionist Number</span>
      <span className="font-semibold text-slate-900">
        {readiness.showSalesReceptionistNumber
          ? (formatPhoneDisplay(readiness.phoneNumber) || readiness.phoneNumber)
          : readiness.label}
      </span>
    </Link>
  );
}

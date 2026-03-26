'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPhoneDisplay } from '../../../lib/phoneDisplay';

export default function SalesReceptionistNumberBadge() {
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/settings')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!mounted) return;
        setPhoneNumber(String(data?.tenant?.telnyx_voice_number || '').trim());
      })
      .catch(() => {
        if (!mounted) return;
        setPhoneNumber('');
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
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Sales Receptionist Number</span>
      <span className="font-semibold text-slate-900">{formatPhoneDisplay(phoneNumber) || 'Provisioning pending'}</span>
    </Link>
  );
}

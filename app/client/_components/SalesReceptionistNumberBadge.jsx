'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '../../../lib/utils';
import { CLIENT_SETUP_STATUS_EVENT, fetchClientSetupStatus } from './setupStatus';

const SALES_RECEPTIONIST_NUMBER_TOOLTIP = 'Your sales receptionist will answer this line. Forward desired calls from your business phone system to this line. Can handle multiple calls at once.';

function readinessFromSetupStatus(setupStatus) {
  const phoneTask = setupStatus?.tasks?.phoneNumber || null;
  const phoneNumber = String(
    phoneTask?.details?.formattedPhoneNumber || phoneTask?.details?.phoneNumber || ''
  ).trim();
  return {
    showSalesReceptionistNumber: phoneTask?.status === 'ready' && Boolean(phoneNumber),
    phoneNumber,
    label: String(phoneTask?.label || 'Setting things up').trim() || 'Setting things up'
  };
}

export default function SalesReceptionistNumberBadge({ className = '' }) {
  const [readiness, setReadiness] = useState({
    showSalesReceptionistNumber: false,
    phoneNumber: '',
    label: 'Setting things up'
  });

  useEffect(() => {
    let mounted = true;
    const applySetupStatus = (setupStatus) => {
      if (!mounted) return;
      setReadiness(readinessFromSetupStatus(setupStatus));
    };
    const loadSetupStatus = () => {
      fetchClientSetupStatus()
        .then(applySetupStatus)
        .catch(() => {
          if (!mounted) return;
          setReadiness({
            showSalesReceptionistNumber: false,
            phoneNumber: '',
            label: 'Setting things up'
          });
        });
    };
    const handleSetupStatusUpdated = (event) => applySetupStatus(event?.detail || null);
    loadSetupStatus();
    window.addEventListener(CLIENT_SETUP_STATUS_EVENT, handleSetupStatusUpdated);
    return () => {
      mounted = false;
      window.removeEventListener(CLIENT_SETUP_STATUS_EVENT, handleSetupStatusUpdated);
    };
  }, []);

  const isSettingThingsUp = !readiness.showSalesReceptionistNumber
    && String(readiness.label || '').trim().toLowerCase() === 'setting things up';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2',
        className
      )}
    >
      <Link
        href="/client/account/general"
        className="group relative inline-flex items-center gap-2 rounded-md border border-slate-200 bg-[#eff4ff] px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-[#dfe9fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2"
        aria-label={SALES_RECEPTIONIST_NUMBER_TOOLTIP}
      >
        <span className="text-[10px] font-bold normal-case tracking-normal text-slate-500">Receptionist Number</span>
        <span className="font-semibold text-slate-900">
          {readiness.showSalesReceptionistNumber
            ? readiness.phoneNumber
            : readiness.label}
        </span>
        <span className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-lg group-hover:block group-focus-visible:block lg:w-80">
          {SALES_RECEPTIONIST_NUMBER_TOOLTIP}
        </span>
      </Link>

      {isSettingThingsUp ? (
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004ac6] focus-visible:ring-offset-2"
          onClick={() => {
            fetchClientSetupStatus()
              .then((setupStatus) => setReadiness(readinessFromSetupStatus(setupStatus)))
              .catch(() => {});
          }}
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}

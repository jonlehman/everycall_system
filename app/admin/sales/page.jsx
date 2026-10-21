'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import CsvImportPanel from './CsvImportPanel';
import ProspectsManager from './ProspectsManager';
import SalesReports from './SalesReports';
import AdminQueue from './AdminQueue';
import OperatorSettings from './OperatorSettings';
import { fetchSalesJson } from './salesApi';
import { ErrorNotice } from './SalesUi';

const SECTIONS = [['prospects', 'Prospects'], ['import', 'Import prospects'], ['queue', 'Queue & demos'], ['reports', 'Rep reporting'], ['settings', 'Settings']];

export default function AdminSalesPage() {
  const [section, setSection] = useState('prospects');
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetchSalesJson('/api/v1/admin/sales/operator-settings?list=true')
      .then((data) => { if (active) setPolicy(data.policy); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-semibold text-slate-950">Sales</h1>
          <p className="mt-1 text-sm text-slate-500">Manage prospects, support your reps, and review calling activity.</p>
        </div>
        <Link href="/sales" target="_blank" rel="noopener noreferrer" className="rounded-full bg-[#004ac6] px-5 py-2.5 text-sm font-semibold text-white">Open caller workspace ↗</Link>
      </header>
      <nav aria-label="Sales administration" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {SECTIONS.map(([key, label]) => (
          <button key={key} type="button" aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${section === key ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-200' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </nav>
      <ErrorNotice title="Sales settings unavailable" message={error} />
      {section === 'prospects' ? <ProspectsManager key={version} onProspectsChanged={() => {}} /> : null}
      {section === 'import' ? policy ? <CsvImportPanel missingTimezonePolicy={policy.missingTimezonePolicy} onImported={() => setVersion((value) => value + 1)} /> : <p className="text-sm text-slate-500">{error ? 'Import is unavailable until the calling policy can be loaded.' : 'Loading import requirements…'}</p> : null}
      {section === 'queue' ? <AdminQueue /> : null}
      {section === 'reports' ? <SalesReports /> : null}
      {section === 'settings' ? <><div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Call scripts</h2><p className="mt-1 text-sm text-slate-600">Edit the shared opener, hand-off, demo, and close scripts.</p><Link className="mt-3 inline-block text-sm font-semibold text-blue-700" href="/sales/scripts">Edit scripts →</Link></div><OperatorSettings /></> : null}
    </div>
  );
}

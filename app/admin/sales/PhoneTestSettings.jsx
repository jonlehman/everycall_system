'use client';
import { useEffect, useState } from 'react';
import { fetchSalesJson } from './salesApi';
import { Card, ActionButton, ErrorNotice } from './SalesUi';

export default function PhoneTestSettings() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => { const result = await fetchSalesJson('/api/v1/admin/sales/phone-test-mode'); setStatus(result.phoneTestMode); };
  useEffect(() => { let active = true; fetchSalesJson('/api/v1/admin/sales/phone-test-mode').then(result => { if (active) setStatus(result.phoneTestMode); }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, []);
  async function changeMode() {
    setBusy(true); setError('');
    try {
      await fetchSalesJson('/api/v1/admin/sales/phone-test-mode', {method:'PATCH',body:JSON.stringify({enabled:!status.enabled})});
      await load();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <Card>
    <h2 className="m-0 text-lg font-semibold">Sales phone test mode</h2>
    <p className="mt-2 text-sm">Save every prospect’s original phone list and temporarily use your desk (+1 425 230 0121) and cell (+1 425 615 4640). Restore puts each original phone list back exactly as saved.</p>
    <p className="mt-2 text-sm text-slate-600">End all calls before switching. New prospects, imports, and phone edits and removals pause while enabled. Permission, do-not-call rules, and calling hours still apply. Test outcomes are saved on calls and excluded from rep metrics without changing prospect status or sending follow-ups. Checkout, setup bookings, and incoming Sales calls are unavailable during testing.</p>
    <ErrorNotice message={error} />
    <p role="status" className="mt-3 font-semibold">{status ? status.enabled ? `Test mode on · ${status.backedUpCount} original phone lists saved` : 'Test mode off · original prospect numbers in use' : 'Loading phone test status…'}</p>
    <ActionButton disabled={!status || busy} onClick={changeMode}>{busy ? 'Updating…' : status?.enabled ? 'Restore original numbers' : 'Save originals and enable test numbers'}</ActionButton>
  </Card>;
}

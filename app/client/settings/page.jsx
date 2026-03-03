'use client';

import { useEffect, useState } from 'react';
import ClientPage from '../_components/ClientPage';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu'
];

export default function SettingsPage() {
  const [tenant, setTenant] = useState({ name: '-', plan: '-', data_region: '-' });
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ message: 'Loading account settings...', tone: 'warn' });

  const loadSettings = () => {
    setLoading(true);
    setStatus({ message: 'Loading account settings...', tone: 'warn' });
    fetch('/api/v1/settings')
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!data) {
          setStatus({ message: 'Could not load account settings.', tone: 'bad' });
          setLoading(false);
          return;
        }
        setTenant(data.tenant || { name: '-', plan: '-', data_region: '-' });
        setTimezone(data.settings?.timezone || 'America/Los_Angeles');
        setNotes(data.settings?.notes || '');
        setStatus({ message: 'Account settings loaded.', tone: 'ok' });
        setLoading(false);
      })
      .catch(() => {
        setStatus({ message: 'Could not load account settings.', tone: 'bad' });
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setStatus({ message: 'Saving account settings...', tone: 'warn' });
    const resp = await fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone, notes })
    });
    setSaving(false);
    if (!resp.ok) {
      setStatus({ message: 'Save failed. Please try again.', tone: 'bad' });
      return;
    }
    setStatus({ message: 'Account settings saved.', tone: 'ok' });
  };

  return (
    <ClientPage
      title="Account Settings"
      subtitle="Confirm your account profile and operational defaults."
      status={status}
      primaryAction={{ label: saving ? 'Saving...' : 'Save Settings', brand: true, onClick: saveSettings, disabled: saving || loading }}
    >
      <div className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Account Snapshot</h2>
            <div className="kv">
              <div>Tenant</div><div>{tenant.name || '-'}</div>
              <div>Plan</div><div>{tenant.plan || '-'}</div>
              <div>Data Region</div><div>{tenant.data_region || '-'}</div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Operational Defaults</h2>
            <div className="stack">
              <div>
                <label>Timezone</label>
                <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                  {TIMEZONES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Internal Notes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Compliance notes, handoff preferences, or team instructions."
                />
              </div>
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn brand" type="button" onClick={saveSettings} disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
              <button className="btn" type="button" onClick={loadSettings} disabled={saving}>Reload</button>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Help</h2>
          <ul className="muted" style={{ paddingLeft: 18, marginTop: 8 }}>
            <li>Use timezone and notes to keep routing and handoff behavior consistent.</li>
            <li>If region or plan needs to change, contact support.</li>
            <li>Save changes before leaving this page.</li>
          </ul>
        </div>
      </div>
    </ClientPage>
  );
}

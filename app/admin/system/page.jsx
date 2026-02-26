'use client';

import { useEffect, useState } from 'react';

export default function AdminSystemPage() {
  const [phrase, setPhrase] = useState('');
  const [status, setStatus] = useState('Ready.');

  const loadConfig = () => {
    setStatus('Loading...');
    fetch('/api/v1/system/config')
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        setPhrase(data?.config?.global_emergency_phrase || '');
        setStatus('Loaded.');
      })
      .catch(() => setStatus('Failed to load.'));
  };

  const saveConfig = () => {
    if (!phrase.trim()) {
      setStatus('Phrase is required.');
      return;
    }
    setStatus('Saving...');
    fetch('/api/v1/system/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ globalEmergencyPhrase: phrase.trim() })
    })
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data?.ok) {
          setStatus('Save failed.');
          return;
        }
        setStatus('Saved.');
      })
      .catch(() => setStatus('Save failed.'));
  };

  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <section className="screen active">
      <div className="topbar"><h1>System Config</h1></div>
      <div className="card">
        <label>Global Emergency Phrase</label>
        <textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} />
        <div className="toolbar">
          <button className="btn brand" onClick={saveConfig}>Save System Config</button>
          <span className="muted">{status}</span>
        </div>
      </div>
    </section>
  );
}

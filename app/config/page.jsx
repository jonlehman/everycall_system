'use client';

import { useEffect, useMemo, useState } from 'react';
import './config.css';

export default function ConfigPage() {
  const [tenantKey, setTenantKey] = useState('default');
  const [agentName, setAgentName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [greetingText, setGreetingText] = useState('');
  const [voiceType, setVoiceType] = useState('alloy');
  const [status, setStatus] = useState({ message: 'Ready.', tone: '' });
  const [storage, setStorage] = useState('-');
  const [versions, setVersions] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('tenantKey');
    if (key) setTenantKey(key);
  }, []);

  const isDirty = useMemo(() => {
    if (!lastSaved) return false;
    return lastSaved.agentName !== agentName
      || lastSaved.companyName !== companyName
      || lastSaved.greetingText !== greetingText
      || lastSaved.voiceType !== voiceType
      || lastSaved.systemPrompt !== systemPrompt
      || lastSaved.tenantKey !== tenantKey;
  }, [agentName, companyName, greetingText, voiceType, systemPrompt, tenantKey, lastSaved]);

  const charCount = systemPrompt.length;

  const setStatusMessage = (message, tone = '') => {
    setStatus({ message, tone });
  };

  const authHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  const loadVersions = (key) => {
    fetch(`/api/v1/config/agent?tenantKey=${encodeURIComponent(key)}&mode=versions&limit=20`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => setVersions(data?.versions || []))
      .catch(() => setVersions([]));
  };

  const loadConfig = (key) => {
    setStatusMessage('Loading...', 'warn');
    fetch(`/api/v1/config/agent?tenantKey=${encodeURIComponent(key)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data) {
          setStatusMessage('Failed to load config.', 'bad');
          return;
        }
        setAgentName(data.agentName || '');
        setCompanyName(data.companyName || '');
        setSystemPrompt(data.systemPrompt || '');
        setGreetingText(data.greetingText || '');
        setVoiceType(data.voiceType || 'alloy');
        setStorage(data.storage || '-');
        setLastSaved({
          tenantKey: key,
          agentName: data.agentName || '',
          companyName: data.companyName || '',
          greetingText: data.greetingText || '',
          voiceType: data.voiceType || 'alloy',
          systemPrompt: data.systemPrompt || ''
        });
        setStatusMessage(`Loaded ${data.storage || 'unknown'} config.`, 'ok');
      })
      .catch(() => setStatusMessage('Failed to load config.', 'bad'));
    loadVersions(key);
  };

  useEffect(() => {
    loadConfig(tenantKey || 'default');
  }, [tenantKey]);

  const saveConfig = () => {
    setStatusMessage('Saving...', 'warn');
    fetch('/api/v1/config/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ tenantKey, agentName, companyName, greetingText, voiceType, systemPrompt })
    })
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data?.ok) {
          setStatusMessage('Save failed.', 'bad');
          return;
        }
        setLastSaved({ tenantKey, agentName, companyName, greetingText, voiceType, systemPrompt });
        setStatusMessage('Saved.', 'ok');
        loadVersions(tenantKey);
      })
      .catch(() => setStatusMessage('Save failed.', 'bad'));
  };

  const restoreVersion = (versionId) => {
    setStatusMessage('Restoring...', 'warn');
    fetch('/api/v1/config/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ tenantKey, restoreVersionId: versionId })
    })
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!data?.ok) {
          setStatusMessage('Restore failed.', 'bad');
          return;
        }
        const cfg = data.config || {};
        setAgentName(cfg.agentName || '');
        setCompanyName(cfg.companyName || '');
        setSystemPrompt(cfg.systemPrompt || '');
        setGreetingText(cfg.greetingText || '');
        setVoiceType(cfg.voiceType || 'alloy');
        setStorage(cfg.storage || storage);
        setLastSaved({
          tenantKey,
          agentName: cfg.agentName || '',
          companyName: cfg.companyName || '',
          greetingText: cfg.greetingText || '',
          voiceType: cfg.voiceType || 'alloy',
          systemPrompt: cfg.systemPrompt || ''
        });
        setStatusMessage('Version restored.', 'ok');
      })
      .catch(() => setStatusMessage('Restore failed.', 'bad'));
  };

  return (
    <div className="config-body">
      <div className="config-wrap">
        <section className="config-card config-panel">
          <div className="config-topline">
            <h1>Agent Config</h1>
            <span className="config-pill">storage: {storage}</span>
          </div>
          <p>Prompt + identity settings for live call handling.</p>

          <label htmlFor="tenantKey">Tenant Key</label>
          <input id="tenantKey" value={tenantKey} onChange={(event) => setTenantKey(event.target.value)} />

          <label htmlFor="agentName">Agent Name</label>
          <input id="agentName" value={agentName} onChange={(event) => setAgentName(event.target.value)} />

          <label htmlFor="companyName">Company Name</label>
          <input id="companyName" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />

          <label htmlFor="greetingText">Agent Greeting</label>
          <textarea id="greetingText" value={greetingText} onChange={(event) => setGreetingText(event.target.value)} />

          <label htmlFor="voiceType">Voice Type</label>
          <select id="voiceType" value={voiceType} onChange={(event) => setVoiceType(event.target.value)}>
            {['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'shimmer'].map((voice) => (
              <option key={voice} value={voice}>{voice}</option>
            ))}
          </select>

          <label htmlFor="apiKey">Config API Key (optional)</label>
          <input id="apiKey" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Needed only when CONFIG_API_KEY is set" />

          <div className="config-kv">
            <span>Characters</span><span>{charCount}</span>
            <span>Unsaved changes</span><span>{isDirty ? 'yes' : 'no'}</span>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '12px 0' }} />

          <h2>Version History</h2>
          <p>Each save creates a version in Postgres.</p>
          <div className="config-version-list">
            {versions.length === 0 && <div className="config-version-item">No versions yet.</div>}
            {versions.map((version) => (
              <div className="config-version-item" key={version.id}>
                <div><strong>Version {version.id}</strong></div>
                <div className="meta">Saved {new Date(version.created_at).toLocaleString()}</div>
                <div className="meta">Length {version.prompt_length || 0} chars</div>
                <button type="button" onClick={() => restoreVersion(version.id)}>Restore</button>
              </div>
            ))}
          </div>
        </section>

        <section className="config-card config-panel">
          <h2>System Prompt</h2>
          <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
          <div className="config-toolbar">
            <button type="button" onClick={saveConfig}>Save Config</button>
            <button type="button" className="secondary" onClick={() => loadConfig(tenantKey || 'default')}>Reload</button>
            <span className={`config-status ${status.tone}`}>{status.message}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
export default function RoutingPage() {
  const voiceOptions = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
  const [primaryQueue, setPrimaryQueue] = useState('Dispatch Team');
  const [emergencyBehavior, setEmergencyBehavior] = useState('Immediate Transfer');
  const [afterHours, setAfterHours] = useState('Collect details and dispatch callback');
  const [businessHours, setBusinessHours] = useState('Mon-Fri 7:00 AM - 8:00 PM\nEmergency service 24/7');
  const [greetingText, setGreetingText] = useState('');
  const [voiceType, setVoiceType] = useState('alloy');
  const gridRef = useRef(null);
  const sampleAudioRef = useRef(null);
  const sampleUrlRef = useRef('');
  const [sampleStatus, setSampleStatus] = useState('');
  const [status, setStatus] = useState('Ready.');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/routing`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.routing) return;
        setPrimaryQueue(data.routing.primary_queue);
        setEmergencyBehavior(data.routing.emergency_behavior);
        setAfterHours(data.routing.after_hours_behavior);
        setBusinessHours(data.routing.business_hours);
      })
      .catch(() => {});
    fetch(`/api/v1/agent`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setGreetingText(data.greetingText || '');
        setVoiceType(data.voiceType || 'alloy');
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.style.gridTemplateColumns = '7fr 3fr';
    }
  }, []);

  const saveRouting = async () => {
    if (!primaryQueue || !emergencyBehavior || !afterHours || !businessHours.trim()) {
      setStatus('All fields are required.');
      return;
    }
    setSaving(true);
    setStatus('Saving...');
    const resp = await fetch('/api/v1/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryQueue,
        emergencyBehavior,
        afterHoursBehavior: afterHours,
        businessHours
      })
    });
    const agentResp = await fetch('/api/v1/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        greetingText,
        voiceType
      })
    });
    setSaving(false);
    setStatus(resp.ok && agentResp.ok ? 'Saved.' : 'Save failed.');
  };

  const playSample = async () => {
    if (!voiceType) return;
    setSampleStatus('Loading sample...');
    try {
      const resp = await fetch(`/api/v1/voice/sample?voice=${encodeURIComponent(voiceType)}`);
      if (!resp.ok) {
        setSampleStatus('Sample failed.');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (sampleUrlRef.current) {
        URL.revokeObjectURL(sampleUrlRef.current);
      }
      sampleUrlRef.current = url;
      if (sampleAudioRef.current) {
        sampleAudioRef.current.src = url;
        await sampleAudioRef.current.play();
      }
      setSampleStatus('');
    } catch {
      setSampleStatus('Sample failed.');
    }
  };

  return (
    <section className="screen active">
      <div className="topbar">
        <h1>Call Routing</h1>
        <div className="top-actions">
          <button className="btn brand" onClick={saveRouting} disabled={saving}>Save Routing</button>
          <span className="muted" style={{ marginLeft: 10 }}>{status}</span>
        </div>
      </div>
      <div ref={gridRef} className="grid help-grid" style={{ gridTemplateColumns: '7fr 3fr' }}>
        <div>
          <div className="card">
            <label>Primary Callback Queue</label>
            <select id="routingPrimary" value={primaryQueue} onChange={(e) => setPrimaryQueue(e.target.value)}>
              <option>Dispatch Team</option>
              <option>Owner Only</option>
            </select>
            <label style={{ marginTop: 10 }}>Emergency Calls</label>
            <select id="routingEmergency" value={emergencyBehavior} onChange={(e) => setEmergencyBehavior(e.target.value)}>
              <option>Immediate Transfer</option>
              <option>Priority Queue</option>
            </select>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <label>Business Hours</label>
            <textarea id="routingHours" value={businessHours} onChange={(e) => setBusinessHours(e.target.value)}></textarea>
            <label style={{ marginTop: 10 }}>After Hours Behavior</label>
            <select id="routingAfterHours" value={afterHours} onChange={(e) => setAfterHours(e.target.value)}>
              <option>Collect details and dispatch callback</option>
              <option>Forward to on-call</option>
            </select>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <label>Agent Greeting</label>
            <textarea
              value={greetingText}
              onChange={(e) => setGreetingText(e.target.value)}
              placeholder="Hi, thanks for calling..."
              style={{ minHeight: 110 }}
            />
            <label style={{ marginTop: 10 }}>Voice Type</label>
            <select value={voiceType} onChange={(e) => setVoiceType(e.target.value)}>
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn" type="button" onClick={playSample}>Play Voice Sample</button>
              <span className="muted">{sampleStatus}</span>
            </div>
            <audio ref={sampleAudioRef} preload="none" />
          </div>
        </div>
        <div className="card">
          <h2>Help</h2>
          <ul className="muted" style={{ paddingLeft: 18, marginTop: 8 }}>
            <li>Choose the primary team that receives callback requests.</li>
            <li>Set how emergency calls are escalated.</li>
            <li>Define after-hours behavior so callers get a clear next step.</li>
            <li>Keep business hours current to prevent misrouting.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

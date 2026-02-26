'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function RoutingPage() {
  const searchParams = useSearchParams();
  const tenantKey = searchParams.get('tenantKey') || 'default';
  const [primaryQueue, setPrimaryQueue] = useState('Dispatch Team');
  const [emergencyBehavior, setEmergencyBehavior] = useState('Immediate Transfer');
  const [afterHours, setAfterHours] = useState('Collect details and dispatch callback');
  const [businessHours, setBusinessHours] = useState('Mon-Fri 7:00 AM - 8:00 PM\nEmergency service 24/7');

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/routing?tenantKey=${encodeURIComponent(tenantKey)}`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data?.routing) return;
        setPrimaryQueue(data.routing.primary_queue);
        setEmergencyBehavior(data.routing.emergency_behavior);
        setAfterHours(data.routing.after_hours_behavior);
        setBusinessHours(data.routing.business_hours);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [tenantKey]);

  const saveRouting = async () => {
    await fetch('/api/v1/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey,
        primaryQueue,
        emergencyBehavior,
        afterHoursBehavior: afterHours,
        businessHours
      })
    });
  };

  return (
    <section className="screen active">
      <div className="topbar"><h1>Call Routing</h1><div className="top-actions"><button className="btn brand" onClick={saveRouting}>Save Routing</button></div></div>
      <div className="grid cols-2 help-split">
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
        </div>
        <div className="card">
          <h2>Help</h2>
          <p className="muted">Define where callbacks go, how emergencies are handled, and what happens after hours. These rules shape every call flow.</p>
        </div>
      </div>
    </section>
  );
}

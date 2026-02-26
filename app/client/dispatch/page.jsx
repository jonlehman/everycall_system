'use client';

import { useEffect, useState } from 'react';
export default function DispatchPage() {
  const [counts, setCounts] = useState({ new: 0, assigned: 0, closed: 0 });

  useEffect(() => {
    let mounted = true;
    fetch(`/api/v1/dispatch`)
      .then((resp) => resp.ok ? resp.json() : null)
      .then((data) => {
        if (!mounted || !data) return;
        setCounts(data.counts || counts);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <section className="screen active">
      <div className="topbar"><h1>Dispatch Board</h1></div>
      <div className="grid cols-3">
        <div className="card"><h2>New</h2><p><span>{counts.new}</span> calls waiting assignment</p></div>
        <div className="card"><h2>Assigned</h2><p><span>{counts.assigned}</span> calls in progress</p></div>
        <div className="card"><h2>Closed</h2><p><span>{counts.closed}</span> completed today</p></div>
      </div>
    </section>
  );
}

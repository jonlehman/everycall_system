'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ClientPage from '../_components/ClientPage';

const endpoint = '/api/v1/billing/setup-appointment';
const messages = {
  setup_payment_required: 'Complete paid setup before booking your appointment.',
  owner_required: 'The account owner can book the setup appointment.',
  slot_unavailable: 'That time is no longer available. Refresh the available times and choose another.',
  setup_booking_already_reserved: 'An appointment request already exists. Check its status before making another request.'
};

async function request(body, after) {
  const response = await fetch(endpoint + (after ? `?after=${encodeURIComponent(after)}` : ''), {
    cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messages[data.error] || 'We could not confirm availability. Try checking again or email customerservice@everycall.io.');
  return data;
}

export default function SetupAppointmentPage() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    request().then(result => { if (active) setData(result); })
      .catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function refresh(after) {
    setBusy(true); setError('');
    try {
      const result = await request(null, after);
      setData(result); setSelected('');
      // A successful status read is required before another booking attempt.
      setSubmitted(Boolean(result.booking));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function book(event) {
    event.preventDefault();
    const slot = data?.slots?.find(value => value.start === selected);
    if (!slot || busy || submitted) return;
    setSubmitted(true); setBusy(true); setError('');
    try {
      const result = await request({ start: slot.start, end: slot.end });
      setData(current => ({ ...current, slots: [], booking: {
        booking_id: result.bookingId, starts_at: result.start, ends_at: result.end, status: result.status
      } }));
    } catch (failure) {
      setError(`${failure.message} Check booking status before trying again.`);
    } finally { setBusy(false); }
  }

  const booking = data?.booking;
  const confirmed = booking?.status === 'booked';
  const bookingTime = booking?.starts_at
    ? new Date(booking.starts_at).toLocaleString(undefined, { ...(data?.timezone ? { timeZone: data.timezone } : {}), dateStyle: 'full', timeStyle: 'short' })
    : '';
  const buttonClass = 'rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <ClientPage title="Setup appointment" subtitle="Choose a time to finish setting up your paid account.">
      <section className="mx-auto max-w-2xl space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        {error ? <p role="alert" className="text-red-700">{error}</p> : null}
        {busy ? <p role="status">Checking your appointment…</p> : null}
        {booking ? (
          <div role="status" className="space-y-3">
            <h2 className="text-lg font-semibold">{confirmed ? 'Your setup appointment is booked' : 'Your appointment request is being confirmed'}</h2>
            {bookingTime ? <p>{bookingTime}{data.timezone ? ` (${data.timezone})` : ''}</p> : null}
            {!confirmed ? <p>We are checking the existing request. Please keep this appointment while we confirm it.</p> : null}
          </div>
        ) : !busy && !submitted && data ? (
          <form onSubmit={book} className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="mb-3 font-semibold">Available times{data.timezone ? ` (${data.timezone})` : ''}</legend>
              {(data.slots || []).map(slot => (
                <label key={slot.start} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="radio" name="appointment" required value={slot.start} checked={selected === slot.start} onChange={() => setSelected(slot.start)} />
                  <span>{slot.label}</span>
                </label>
              ))}
              {!data.slots?.length ? <p>No times are available in this window. Check later times or contact customer service.</p> : null}
            </fieldset>
            <button type="submit" className={buttonClass} disabled={!selected || busy}>Book setup appointment</button>
            {data.nextAfter ? <button type="button" className="ml-4 underline" onClick={() => refresh(data.nextAfter)}>See later times</button> : null}
          </form>
        ) : null}
        <button type="button" className="underline" disabled={busy} onClick={() => refresh()}>Check booking status</button>
        <p><Link href="/client/account/billing" className="underline">Return to Billing</Link></p>
        <p className="text-sm text-slate-600">Need help? <a className="underline" href="mailto:customerservice@everycall.io">customerservice@everycall.io</a></p>
      </section>
    </ClientPage>
  );
}

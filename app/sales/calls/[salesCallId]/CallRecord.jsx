"use client";

import { useEffect, useState } from "react";
import {
  displayStatus,
  fetchSalesJson,
  normalizeCall,
} from "../../../admin/sales/salesApi";
import {
  elapsed,
  formatPhone,
  safeExternalUrl,
} from "../../../admin/sales/dialerState.mjs";

function time(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "—";
}
function transcriptText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : [entry.role || entry.speaker, entry.text || entry.transcript]
              .filter(Boolean)
              .join(": "),
      )
      .filter(Boolean)
      .join("\n\n");
  if (value && typeof value === "object")
    return transcriptText(
      value.text || value.transcript || value.messages || value.segments || "",
    );
  return "";
}
function Detail({ label, children }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="m-0 break-words whitespace-pre-wrap text-sm text-slate-900">
        {children || "—"}
      </dd>
    </div>
  );
}

export default function CallRecord({ salesCallId }) {
  const [call, setCall] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      timer;
    setCall(null);
    setError("");
    const load = async () => {
      try {
        const result = await fetchSalesJson(
          `/api/v1/admin/sales/calls/${encodeURIComponent(salesCallId)}`,
        );
        if (!active) return;
        const next = normalizeCall(result);
        if (!next.id) throw new Error("The call record is unavailable.");
        setCall(next);
        setError("");
        if (
          !next.terminal ||
          !next.recordingUrl ||
          !["ready", "failed", "unavailable"].includes(next.transcriptStatus)
        )
          timer = setTimeout(load, 5000);
      } catch (failure) {
        if (!active) return;
        setError(
          failure.status === 403 || failure.status === 404
            ? "This call record is not available to your account."
            : failure.status === 401
              ? "Sign in to view this call record."
              : failure.message || "The call record could not be loaded.",
        );
        if (
          failure.status === 401 ||
          failure.status === 403 ||
          failure.status === 404
        )
          setCall(null);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [salesCallId]);
  const transcript = transcriptText(call?.transcript),
    recording = safeExternalUrl(call?.recordingUrl),
    business = call?.raw?.businessName || call?.raw?.prospect?.businessName;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-950">
          {business || "Call record"}
        </h1>
        <a href="/sales" className="text-sm font-semibold text-blue-700">
          Back to calling
        </a>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {/Sign in/.test(error) && (
            <>
              {" "}
              <a
                className="underline"
                href={`/sales/login?next=${encodeURIComponent(`/sales/calls/${salesCallId}`)}`}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      )}
      {!call && !error && (
        <p role="status" className="text-sm text-slate-500">
          Loading call record…
        </p>
      )}
      {call && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-base font-semibold">Call details</h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail label="Business">{business}</Detail>
              <Detail label="Contact">
                {call.raw?.contactName || call.raw?.prospect?.contactName}
              </Detail>
              <Detail label="Number">{formatPhone(call.dialedNumber)}</Detail>
              <Detail label="Outcome">
                {call.paidAt
                  ? "Paid — confirmed by Stripe"
                  : call.outcome
                    ? displayStatus(call.outcome)
                    : "No outcome recorded"}
              </Detail>
              <Detail label="Started">
                {time(call.startedAt || call.createdAt)}
              </Detail>
              <Detail label="Connected">{time(call.connectedAt)}</Detail>
              <Detail label="Ended">{time(call.endedAt)}</Detail>
              <Detail label="Length">
                {call.endedAt
                  ? elapsed(call.connectedAt || call.startedAt, call.endedAt)
                  : "Call in progress"}
              </Detail>
              <Detail label="Demo started">{time(call.demoStartedAt)}</Detail>
              <Detail label="Demo ended">{time(call.demoEndedAt)}</Detail>
              <Detail label="Checkout link sent">
                {time(call.linkSentAt)}
              </Detail>
              <Detail label="Setup call booked">{time(call.bookedAt)}</Detail>
            </dl>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Notes</h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {call.outcomeNotes || call.liveNotes || "No notes recorded."}
            </p>
            {call.outcomeNotes &&
              call.liveNotes &&
              call.outcomeNotes !== call.liveNotes && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-slate-500">
                    During the call
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {call.liveNotes}
                  </p>
                </div>
              )}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Transcript</h2>
            {transcript ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {transcript}
              </p>
            ) : (
              <p role="status" className="text-sm text-slate-500">
                {["failed", "unavailable", "ready"].includes(
                  call.transcriptStatus,
                )
                  ? "No transcript is available for this call."
                  : "Transcript — processing. This page updates when it arrives."}
              </p>
            )}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Recording</h2>
            {recording ? (
              <a
                className="text-sm font-semibold text-blue-700"
                href={recording}
                target="_blank"
                rel="noreferrer"
              >
                Open recording ↗
              </a>
            ) : (
              <p className="text-sm text-slate-500">
                A recording is not available yet.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

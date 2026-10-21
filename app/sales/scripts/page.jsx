"use client";
import { useEffect, useState } from "react";
import { fetchSalesJson } from "../../admin/sales/salesApi";
const PHASES = [
  "opener",
  "if_interested",
  "if_voicemail",
  "talk_discovery",
  "handoff",
  "objections",
  "no_time",
  "gatekeeper",
  "while_you_listen",
  "exit_line",
  "close",
  "close_decline",
];
export default function SalesScriptsPage() {
  const [scripts, setScripts] = useState({}),
    [draft, setDraft] = useState({}),
    [operator, setOperator] = useState({}),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchSalesJson("/api/v1/admin/sales/settings")
      .then((result) => {
        setScripts(result.scripts || {});
        setDraft(
          Object.fromEntries(
            Object.entries(result.scripts || {}).map(([key, value]) => [
              key,
              key === "objections" ? JSON.stringify(value, null, 2) : value,
            ]),
          ),
        );
        setOperator(result.operator || {});
      })
      .catch((err) => setError(err.message));
  }, []);
  const save = async () => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const next = {
        ...draft,
        objections: JSON.parse(draft.objections || "[]"),
      };
      if (!Array.isArray(next.objections))
        throw new Error("Objections must be a JSON array.");
      const result = await fetchSalesJson("/api/v1/admin/sales/settings", {
        method: "PATCH",
        body: JSON.stringify({ scripts: next }),
      });
      setScripts(result.scripts || next);
      setStatus("Scripts saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Call scripts</h1>
        <a className="text-blue-700" href="/sales">
          Back to calling
        </a>
      </div>
      <p className="text-sm text-slate-600">
        {operator.canEditScripts
          ? "Edit the shared scripts used in each call phase."
          : "These are your shared call scripts. An administrator can edit them from this page."}
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-green-700">
          {status}
        </p>
      )}
      {PHASES.map((key) => (
        <section
          key={key}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h2 className="mb-3 font-semibold capitalize">
            {key.replaceAll("_", " ")}
          </h2>
          {operator.canEditScripts ? (
            <textarea
              aria-label={key.replaceAll("_", " ")}
              className="min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm"
              value={draft[key] || ""}
              onChange={(e) =>
                setDraft((current) => ({ ...current, [key]: e.target.value }))
              }
            />
          ) : key === "objections" ? (
            <div className="grid gap-3">
              {(scripts.objections || []).map((item, index) => (
                <p key={index} className="text-sm">
                  <strong>{item.title || item.label}</strong>{" "}
                  {item.response || item.text || String(item)}
                </p>
              ))}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-6">
              {scripts[key] || "No script configured."}
            </p>
          )}
        </section>
      ))}
      {operator.canEditScripts && (
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save scripts"}
        </button>
      )}
    </div>
  );
}

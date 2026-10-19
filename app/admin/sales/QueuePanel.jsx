'use client';
import { isDemoReady } from './salesApi';
import { Card, StatusPill, ActionButton, ErrorNotice } from './SalesUi';

function demoStatusTone(status) {
  if (['ready', 'demo_ready', 'ready_to_call'].includes(status)) return 'good';
  if (['failed', 'build_failed', 'error'].includes(status)) return 'bad';
  return 'warn';
}

function demoStatusLabel(status) {
  return status === 'stale' ? 'Demo needs rebuilding' : status;
}

export default function QueuePanel({
  queue,
  loading,
  error,
  warmBusy,
  onRefresh,
  onWarm,
  onPrepare,
  onSkip,
  prepareBusyId,
  skipBusyId,
  callerMode = false
}) {
  const showCurrent = !callerMode || !queue.current || !isDemoReady(queue.current)
    || Boolean(queue.current.demoFailure) || !queue.current.website || !queue.current.eligible;
  return (
    <Card className="h-fit">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-950">Up next</h2>
          <p className="mt-1 text-xs text-slate-500">{callerMode ? 'Next prospects' : 'Current prospect plus the next 10 demos (11 total).'}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Reload callable prospects and their latest demo and call status."
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
        >
          {loading ? 'Reloading queue…' : 'Reload calling queue'}
        </button>
      </div>

      <ErrorNotice title="Queue unavailable" message={error} />

      {showCurrent ? <div className="mt-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Current</div>
        {!queue.current ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No callable prospects are queued.
          </div>
        ) : (
          <div className="rounded-xl border border-[#004ac6]/25 bg-[#eff4ff] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">{queue.current.businessName || 'Unnamed business'}</div>
                <div className="mt-1 truncate text-xs text-slate-600">{queue.current.contactName || queue.current.phone || 'No contact name'}</div>
              </div>
              <StatusPill status={demoStatusLabel(queue.current.demoStatus)} tone={demoStatusTone(queue.current.demoStatus)} />
            </div>
            {!isDemoReady(queue.current) && queue.current.preparationEligible ? (
              <ActionButton
                className="mt-3 w-full"
                tone="secondary"
                disabled={prepareBusyId === queue.current.id}
                onClick={() => onPrepare(queue.current)}
                title="Scan this prospect's website and build the receptionist demo used during the call."
              >
                {prepareBusyId === queue.current.id ? 'Queueing demo build…' : 'Queue website demo build'}
              </ActionButton>
            ) : null}
            {(queue.current.demoStatus === 'failed' || queue.current.demoFailure || !queue.current.website) ? (
              <ActionButton
                className="mt-2 w-full"
                tone="secondary"
                disabled={skipBusyId === queue.current.id}
                onClick={() => onSkip(queue.current)}
              >
                {skipBusyId === queue.current.id ? 'Skipping…' : 'Skip unusable demo'}
              </ActionButton>
            ) : null}
            {queue.current.demoFailure ? (
              <div className="mt-2 break-words text-xs text-red-700">{queue.current.demoFailure}</div>
            ) : null}
          </div>
        )}
      </div> : null}

      <div className="mt-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Upcoming</div>
        <ol className="space-y-2">
          {queue.upcoming.map((prospect, index) => (
            <li key={prospect.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{prospect.businessName || 'Unnamed business'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusPill status={demoStatusLabel(prospect.demoStatus)} tone={demoStatusTone(prospect.demoStatus)} />
                    {!prospect.eligible ? <StatusPill status="Blocked" tone="bad" /> : null}
                  </div>
                  {prospect.demoFailure ? (
                    <div className="mt-2 line-clamp-2 text-xs text-red-700">{prospect.demoFailure}</div>
                  ) : null}
                </div>
                <div className="grid shrink-0 gap-1 text-right">
                  {!isDemoReady(prospect) && prospect.preparationEligible ? (
                    <button
                      type="button"
                      onClick={() => onPrepare(prospect)}
                      disabled={prepareBusyId === prospect.id}
                      title="Scan this prospect's website and build their receptionist demo."
                      className="text-xs font-semibold text-[#004ac6] hover:underline disabled:text-slate-400"
                    >
                      {prepareBusyId === prospect.id ? 'Queueing…' : prospect.demoFailure ? 'Retry demo build' : 'Queue website demo build'}
                    </button>
                  ) : null}
                  {(prospect.demoStatus === 'failed' || prospect.demoFailure || !prospect.website) ? (
                    <button
                      type="button"
                      onClick={() => onSkip(prospect)}
                      disabled={skipBusyId === prospect.id}
                      className="text-xs font-semibold text-slate-600 hover:underline disabled:text-slate-400"
                    >
                      {skipBusyId === prospect.id ? 'Skipping…' : 'Skip'}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
        {!queue.upcoming.length ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
            No upcoming prospects.
          </div>
        ) : null}
      </div>

      {!callerMode ? <ActionButton
        className="mt-4 w-full"
        tone="secondary"
        onClick={onWarm}
        disabled={warmBusy || loading}
        title="Queue website-based receptionist demo builds for the current prospect and the next 10 prospects."
      >
        {warmBusy ? 'Queueing demo builds…' : 'Queue demo builds for current + next 10'}
      </ActionButton> : null}
    </Card>
  );
}

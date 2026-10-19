
'use client';
import QueuePanel from './QueuePanel';
import { useSalesQueue } from './useSalesQueue';

export default function AdminQueue() {
  const { queue, queueLoading, queueError, warmBusy, prepareBusyId, skipBusyId,
    loadQueue, warmQueue, prepareProspect, skipProspect } = useSalesQueue();
  return <div className="grid max-w-3xl gap-3">
    <p className="m-0 text-sm text-slate-500">Review the shared queue and prepare website demos before reps start calling. Failed demos can be retried or skipped here.</p>
    <QueuePanel queue={queue} loading={queueLoading} error={queueError} warmBusy={warmBusy}
      onRefresh={() => { void loadQueue(); }} onWarm={() => { void warmQueue({ currentProspectId: queue.currentProspectId }); }}
      onPrepare={(prospect) => { void prepareProspect(prospect); }} onSkip={(prospect) => { void skipProspect(prospect); }}
      prepareBusyId={prepareBusyId} skipBusyId={skipBusyId} />
  </div>;
}

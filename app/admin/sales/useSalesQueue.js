'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchSalesJson, normalizeQueue } from './salesApi';

export function useSalesQueue({ autoWarm = false } = {}) {
  const [queue, setQueue] = useState({
    current: null,
    prospects: [],
    upcoming: [],
    currentProspectId: '',
    warmQueueSize: 11,
    missingTimezonePolicy: 'block'
  });
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [warmBusy, setWarmBusy] = useState(false);
  const [prepareBusyId, setPrepareBusyId] = useState('');
  const [skipBusyId, setSkipBusyId] = useState('');
  const loadQueue = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setQueueLoading(true);
    setQueueError('');
    try {
      const payload = await fetchSalesJson('/api/v1/admin/sales/queue');
      const nextQueue = normalizeQueue(payload);
      setQueue(nextQueue);
      return nextQueue;
    } catch (error) {
      setQueueError(error?.message || 'Could not load the sales queue.');
      return null;
    } finally {
      if (!quiet) setQueueLoading(false);
    }
  }, []);

  const warmQueue = useCallback(async ({ quiet = false, currentProspectId = '' } = {}) => {
    if (!quiet) setWarmBusy(true);
    try {
      await fetchSalesJson('/api/v1/admin/sales/queue/warm', {
        method: 'POST',
        body: JSON.stringify({
          currentProspectId: currentProspectId || undefined,
          size: 11
        })
      });
      await loadQueue({ quiet: true });
    } catch (error) {
      if (!quiet) setQueueError(error?.message || 'Could not queue the upcoming demo builds.');
    } finally {
      if (!quiet) setWarmBusy(false);
    }
  }, [loadQueue]);

  useEffect(() => {
    let active = true;
    (async () => {
      const loadedQueue = await loadQueue();
      if (active && loadedQueue && autoWarm) {
        await warmQueue({
          quiet: true,
          currentProspectId: loadedQueue.currentProspectId
        });
      }
    })();
    return () => { active = false; };
  }, [loadQueue, warmQueue, autoWarm]);

  useEffect(() => {
    const hasPendingDemo = queue.prospects.some((prospect) => (
      ['not_prepared', 'queued', 'preparing', 'building', 'stale'].includes(prospect.demoStatus)
    ));
    if (!hasPendingDemo) return undefined;
    const interval = window.setInterval(() => { void loadQueue({ quiet: true }); }, 3000);
    return () => window.clearInterval(interval);
  }, [queue.prospects, loadQueue]);

  const prepareProspect = async (prospect) => {
    if (!prospect?.id) return;
    setPrepareBusyId(prospect.id);
    setQueueError('');
    try {
      await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/demo`, {
        method: 'POST',
        body: JSON.stringify({ force: Boolean(prospect.demoFailure) })
      });
      await loadQueue({ quiet: true });
    } catch (error) {
      setQueueError(error?.message || 'Could not queue this demo build.');
    } finally {
      setPrepareBusyId('');
    }
  };

  const skipProspect = async (prospect) => {
    if (!prospect?.id) return;
    setSkipBusyId(prospect.id);
    setQueueError('');
    try {
      await fetchSalesJson(
        `/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/skip`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: prospect.demoFailure || 'Demo is unusable for this calling session.'
          })
        }
      );
      await loadQueue({ quiet: true });
    } catch (error) {
      setQueueError(error?.message || 'Could not skip this prospect.');
    } finally {
      setSkipBusyId('');
    }
  };

  return { queue, queueLoading, queueError, warmBusy, prepareBusyId, skipBusyId,
    loadQueue, warmQueue, prepareProspect, skipProspect };
}

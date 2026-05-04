export const CLIENT_SETUP_STATUS_EVENT = 'everycall:setup-status-updated';

export async function fetchClientSetupStatus() {
  const resp = await fetch('/api/v1/client/setup-status', { cache: 'no-store' });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.setupStatus) {
    throw new Error(data?.message || data?.error || 'client_setup_status_failed');
  }
  return data.setupStatus;
}

export function emitClientSetupStatus(setupStatus) {
  if (typeof window === 'undefined' || !setupStatus) return;
  window.dispatchEvent(new CustomEvent(CLIENT_SETUP_STATUS_EVENT, { detail: setupStatus }));
}

export function statusChipFromTask(task, fallback = null) {
  if (!task) return fallback;
  return {
    tone: task.status === 'ready' ? 'ok' : 'warn',
    label: String(task.label || fallback?.label || 'Setup in progress').trim()
  };
}

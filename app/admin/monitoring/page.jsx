'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function SummaryCard({ label, value, detail }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
      {detail ? <div className="mt-1 text-sm text-slate-500">{detail}</div> : null}
    </div>
  );
}

function SectionCard({ title, body, children, action = null }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold">{title}</h2>
          {body ? <p className="m-0 mt-1 text-sm text-slate-500">{body}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatusChip({ value }) {
  const normalized = String(value || '').trim().toLowerCase();
  const className = normalized === 'delivered' || normalized === 'done'
    ? 'bg-emerald-100 text-emerald-800'
    : normalized === 'skipped'
      ? 'bg-slate-100 text-slate-700'
      : 'bg-rose-100 text-rose-800';
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${className}`}>
      {value || 'unknown'}
    </span>
  );
}

export default function AdminMonitoringPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const loadPage = async (message = '') => {
    if (message) setStatus(message);
    setLoading(true);
    try {
      const next = await fetchJson('/api/v1/admin/monitoring');
      setData(next);
      if (!message) {
        setStatus('');
      }
    } catch (error) {
      setStatus(error?.message || 'Could not load monitoring data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage();
  }, []);

  const runAction = async (body, message, successMessage, busyValue) => {
    setBusyKey(busyValue);
    setStatus(message);
    try {
      const response = await fetchJson('/api/v1/admin/monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await loadPage(successMessage || response?.message || 'Action completed.');
    } catch (error) {
      setStatus(error?.message || 'Action failed.');
      setLoading(false);
    } finally {
      setBusyKey('');
    }
  };

  const summary = data?.summary || {};
  const releaseHealth = data?.releaseHealth || {};
  const failedNotifications = Array.isArray(data?.failedNotifications) ? data.failedNotifications : [];
  const failedIntegrations = Array.isArray(data?.failedIntegrations) ? data.failedIntegrations : [];
  const deadLetterJobs = Array.isArray(data?.deadLetterJobs) ? data.deadLetterJobs : [];
  const failedProvisioning = Array.isArray(data?.failedProvisioning) ? data.failedProvisioning : [];
  const buildIssues = Array.isArray(data?.buildIssues) ? data.buildIssues : [];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Platform Monitoring</h1>
          <div className="mt-1 text-sm text-slate-500">
            Watch delivery failures, stuck work, and launch health across all tenants.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => loadPage('Refreshing monitoring data...')} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Link className={cn(buttonVariants({ variant: 'outline' }))} href="/admin/jobs">
            Open Provisioning Jobs
          </Link>
        </div>
      </div>

      {status ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {status}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Failed Notifications (24h)" value={Number(summary.failed_notifications_24h || 0)} detail="SMS and email lead alert delivery failures." />
        <SummaryCard label="Failed Integrations (24h)" value={Number(summary.failed_integrations_24h || 0)} detail="Connector delivery attempts that did not succeed." />
        <SummaryCard label="Dead-Letter Jobs" value={Number(summary.dead_letter_jobs || 0)} detail="Async jobs that exhausted retries and need intervention." />
        <SummaryCard label="Provisioning Failures (7d)" value={Number(summary.failed_provisioning_7d || 0)} detail="Number or setup jobs that failed recently." />
        <SummaryCard label="Stuck Builds" value={Number(summary.stuck_builds || 0)} detail="Knowledge builds still queued or running past the safety window." />
        <SummaryCard label="Call Errors (24h)" value={Number(summary.call_errors_24h || 0)} detail="Calls that ended in error in the last 24 hours." />
      </div>

      <SectionCard
        title="Release Health"
        body="These launch metrics help show whether new tenants are actually getting live after signup."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SummaryCard label="New Tenants (30d)" value={Number(releaseHealth.new_tenants_30d || 0)} />
          <SummaryCard label="Published Build Rate" value={`${Number(releaseHealth.tenants_with_published_builds_30d || 0)}/${Number(releaseHealth.new_tenants_30d || 0)}`} />
          <SummaryCard label="Ready For Calls" value={`${Number(releaseHealth.tenants_ready_for_calls_30d || 0)}/${Number(releaseHealth.new_tenants_30d || 0)}`} />
          <SummaryCard label="Notifications Ready" value={`${Number(releaseHealth.tenants_with_notifications_ready_30d || 0)}/${Number(releaseHealth.new_tenants_30d || 0)}`} />
          <SummaryCard label="Checkout Started" value={Number(releaseHealth.checkout_created_30d || 0)} />
          <SummaryCard label="Checkout Completed" value={Number(releaseHealth.checkout_completed_30d || 0)} />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SectionCard title="Failed Notifications" body="Replay lead alerts when delivery failed or recipient configuration has just been fixed.">
          {failedNotifications.length ? (
            <div className="grid gap-2">
              {failedNotifications.map((item) => {
                const key = `notification:${item.id}`;
                return (
                  <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900">{item.tenant_name || item.tenant_key}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.channel} · {item.destination}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAction(
                          { action: 'replay_notification', tenantKey: item.tenant_key, callSid: item.call_sid },
                          'Queueing notification replay...',
                          'Notification replay queued.',
                          key
                        )}
                        disabled={busyKey === key}
                      >
                        {busyKey === key ? 'Queueing...' : 'Replay'}
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Call {item.call_sid} · {formatDateTime(item.updated_at)}</div>
                    <div className="mt-2 text-sm text-rose-700">{item.last_error_message || item.last_error_code || 'Unknown failure'}</div>
                    <div className="mt-3">
                      <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`/admin/tenants/${encodeURIComponent(item.tenant_key)}`}>
                        Open Tenant
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No failed notifications right now.</div>
          )}
        </SectionCard>

        <SectionCard title="Failed Integrations" body="Replay connector deliveries after credentials, endpoint health, or mapping issues have been corrected.">
          {failedIntegrations.length ? (
            <div className="grid gap-2">
              {failedIntegrations.map((item) => {
                const key = `integration:${item.id}`;
                return (
                  <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900">{item.connection_name || item.connector_type || 'Integration'}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.tenant_name || item.tenant_key} · call {item.call_sid}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAction(
                          {
                            action: 'replay_integration',
                            tenantKey: item.tenant_key,
                            callSid: item.call_sid,
                            connectionId: item.connection_id,
                            eventId: item.event_id
                          },
                          'Queueing integration replay...',
                          'Integration replay queued.',
                          key
                        )}
                        disabled={busyKey === key}
                      >
                        {busyKey === key ? 'Queueing...' : 'Replay'}
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Attempt {item.attempt_number} · {formatDateTime(item.created_at)}</div>
                    <div className="mt-2 text-sm text-rose-700">{item.error_message || `HTTP ${item.response_status || 'unknown'}`}</div>
                    <div className="mt-3">
                      <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`/admin/tenants/${encodeURIComponent(item.tenant_key)}`}>
                        Open Tenant
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No failed integrations right now.</div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SectionCard title="Dead-Letter Jobs" body="These jobs exhausted retries. Requeue them after the underlying issue has been corrected.">
          {deadLetterJobs.length ? (
            <div className="grid gap-2">
              {deadLetterJobs.map((job) => {
                const key = `job:${job.id}`;
                return (
                  <div key={job.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900">{job.job_type}</div>
                        <div className="mt-1 text-xs text-slate-500">{job.tenant_key || 'No tenant'} · attempts {job.attempts}/{job.max_attempts}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAction(
                          { action: 'retry_async_job', jobId: job.id },
                          'Requeueing async job...',
                          'Async job requeued.',
                          key
                        )}
                        disabled={busyKey === key}
                      >
                        {busyKey === key ? 'Queueing...' : 'Retry'}
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(job.updated_at)}</div>
                    <div className="mt-2 text-sm text-rose-700">{job.last_error || 'Unknown async job failure'}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No dead-letter async jobs right now.</div>
          )}
        </SectionCard>

        <SectionCard title="Knowledge Build Issues" body="Failed builds need investigation. Stuck queued or running builds can be re-run safely from here.">
          {buildIssues.length ? (
            <div className="grid gap-2">
              {buildIssues.map((item) => {
                const key = `build:${item.build_id}`;
                const warnings = Array.isArray(item.warnings_json) ? item.warnings_json.filter(Boolean).slice(0, 2) : [];
                return (
                  <div key={item.build_id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900">{item.tenant_name || item.tenant_key}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.build_id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusChip value={item.status} />
                        {item.is_stuck ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runAction(
                              { action: 'rerun_build', tenantKey: item.tenant_key, buildId: item.build_id },
                              'Requesting build rerun...',
                              'Build rerun requested.',
                              key
                            )}
                            disabled={busyKey === key}
                          >
                            {busyKey === key ? 'Running...' : 'Rerun'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(item.updated_at)}</div>
                    {warnings.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {warnings.map((warning) => (
                          <span key={`${item.build_id}-${warning}`} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                            {warning}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`/admin/tenants/${encodeURIComponent(item.tenant_key)}`}>
                        Open Tenant
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No build failures or stuck builds right now.</div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Provisioning Failures" body="These are account setup or number operations that failed recently. Open the tenant to retry provisioning or inspect the audit trail.">
        {failedProvisioning.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {failedProvisioning.map((job) => (
              <div key={job.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{job.tenant_name || job.tenant_key}</div>
                    <div className="mt-1 text-xs text-slate-500">{job.stage} · {formatDateTime(job.updated_at)}</div>
                  </div>
                  <StatusChip value="failed" />
                </div>
                <div className="mt-2 text-sm text-rose-700">{job.error_message || job.status_detail || job.error_code || 'Unknown provisioning failure'}</div>
                <div className="mt-3">
                  <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`/admin/tenants/${encodeURIComponent(job.tenant_key)}`}>
                    Open Tenant
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No recent provisioning failures.</div>
        )}
      </SectionCard>
    </section>
  );
}

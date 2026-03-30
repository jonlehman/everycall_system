'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

const CALL_TYPE_OPTIONS = [
  'project_inquiry',
  'general_inquiry',
  'existing_customer_support',
  'vendor_or_sales',
  'spam',
  'wrong_number',
  'hangup_or_incomplete',
  'other_non_billable'
];

const CONNECTOR_TYPES = {
  zapierHook: 'zapier_hook',
  hubspotPrivateApp: 'hubspot_private_app',
  jobberClient: 'jobber_client',
  serviceTitanBooking: 'servicetitan_booking'
};

const CONNECTOR_DEFINITIONS = [
  {
    type: CONNECTOR_TYPES.zapierHook,
    label: 'Zapier',
    description: 'Send full EveryCall call.completed events into a Zapier Catch Hook.',
    defaultName: 'Zapier Catch Hook'
  },
  {
    type: CONNECTOR_TYPES.hubspotPrivateApp,
    label: 'HubSpot',
    description: 'Create or update a HubSpot contact and add an EveryCall note.',
    defaultName: 'HubSpot'
  },
  {
    type: CONNECTOR_TYPES.jobberClient,
    label: 'Jobber',
    description: 'Create a lead client in Jobber from qualified project inquiries.',
    defaultName: 'Jobber'
  },
  {
    type: CONNECTOR_TYPES.serviceTitanBooking,
    label: 'ServiceTitan',
    description: 'Send qualified project inquiries into ServiceTitan CRM bookings.',
    defaultName: 'ServiceTitan'
  }
];

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function formatLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function buildConnectorDraft(type, connection = null) {
  const config = connection?.config || {};
  const definition = CONNECTOR_DEFINITIONS.find((item) => item.type === type);
  const defaults = type === CONNECTOR_TYPES.zapierHook
    ? { includeTypes: [...CALL_TYPE_OPTIONS], includeNonBillable: true, includeDuplicates: true, includeTranscript: false }
    : { includeTypes: ['project_inquiry'], includeNonBillable: false, includeDuplicates: false, includeTranscript: false };

  return {
    connectionId: connection?.id || '',
    connectorType: type,
    name: connection?.name || definition?.defaultName || formatLabel(type),
    status: connection?.status || 'enabled',
    endpointUrl: connection?.endpointUrl || '',
    includeTypes: Array.isArray(config.includeTypes) && config.includeTypes.length ? config.includeTypes : defaults.includeTypes,
    includeNonBillable: typeof config.includeNonBillable === 'boolean' ? config.includeNonBillable : defaults.includeNonBillable,
    includeDuplicates: typeof config.includeDuplicates === 'boolean' ? config.includeDuplicates : defaults.includeDuplicates,
    includeTranscript: typeof config.includeTranscript === 'boolean' ? config.includeTranscript : defaults.includeTranscript,
    createNote: config.createNote !== false,
    privateAppToken: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    appKey: '',
    serviceTitanTenantId: config.tenantId || '',
    environment: config.environment || 'integration'
  };
}

export default function AccountIntegrationsPage() {
  const [viewer, setViewer] = useState({ canManage: false, userRole: null });
  const [connectorReview, setConnectorReview] = useState({ connections: [], deliveries: [] });
  const [selectedConnectorType, setSelectedConnectorType] = useState(CONNECTOR_TYPES.zapierHook);
  const [connectorDraft, setConnectorDraft] = useState(buildConnectorDraft(CONNECTOR_TYPES.zapierHook, null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading integrations...' });

  const selectedConnectorDefinition = CONNECTOR_DEFINITIONS.find((item) => item.type === selectedConnectorType) || CONNECTOR_DEFINITIONS[0];

  const loadIntegrations = () => {
    setLoading(true);
    setStatus({ tone: 'warn', message: 'Loading integrations...' });
    return fetchJson('/api/v1/integrations/connectors')
      .then((data) => {
        const nextConnections = Array.isArray(data?.connections) ? data.connections : [];
        setViewer(data?.viewer || { canManage: false, userRole: null });
        setConnectorReview({
          connections: nextConnections,
          deliveries: Array.isArray(data?.deliveries) ? data.deliveries : []
        });
        setStatus({ tone: 'ok', message: 'Integrations loaded.' });
        setLoading(false);
      })
      .catch((error) => {
        setStatus({ tone: 'bad', message: error?.message || 'Could not load integrations.' });
        setLoading(false);
      });
  };

  useEffect(() => {
    void loadIntegrations();
  }, []);

  useEffect(() => {
    const connection = connectorReview.connections.find((item) => item.connectorType === selectedConnectorType);
    setConnectorDraft(buildConnectorDraft(selectedConnectorType, connection || null));
  }, [selectedConnectorType, connectorReview.connections]);

  const updateConnectorField = (key, value) => {
    setConnectorDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleConnectorTypeFilter = (type) => {
    setConnectorDraft((current) => {
      const includeTypes = Array.isArray(current.includeTypes) ? [...current.includeTypes] : [];
      const exists = includeTypes.includes(type);
      return {
        ...current,
        includeTypes: exists
          ? includeTypes.filter((item) => item !== type)
          : [...includeTypes, type]
      };
    });
  };

  const saveConnector = async () => {
    if (!viewer.canManage) {
      setStatus({ tone: 'bad', message: 'Only the account owner can manage integrations.' });
      return;
    }
    setSaving(true);
    setStatus({ tone: 'warn', message: `Saving ${selectedConnectorDefinition.label}...` });
    try {
      const data = await fetchJson('/api/v1/integrations/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: connectorDraft.connectionId || undefined,
          connectorType: selectedConnectorType,
          name: connectorDraft.name,
          status: connectorDraft.status,
          endpointUrl: connectorDraft.endpointUrl || undefined,
          includeTypes: connectorDraft.includeTypes,
          includeNonBillable: connectorDraft.includeNonBillable,
          includeDuplicates: connectorDraft.includeDuplicates,
          includeTranscript: connectorDraft.includeTranscript,
          createNote: connectorDraft.createNote,
          privateAppToken: connectorDraft.privateAppToken || undefined,
          clientId: connectorDraft.clientId || undefined,
          clientSecret: connectorDraft.clientSecret || undefined,
          refreshToken: connectorDraft.refreshToken || undefined,
          appKey: connectorDraft.appKey || undefined,
          serviceTitanTenantId: connectorDraft.serviceTitanTenantId || undefined,
          environment: connectorDraft.environment
        })
      });
      setViewer(data?.viewer || viewer);
      setConnectorReview({
        connections: Array.isArray(data?.connections) ? data.connections : [],
        deliveries: Array.isArray(data?.deliveries) ? data.deliveries : []
      });
      setStatus({ tone: 'ok', message: `${selectedConnectorDefinition.label} saved.` });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Connector save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const testConnector = async () => {
    if (!viewer.canManage) {
      setStatus({ tone: 'bad', message: 'Only the account owner can test integrations.' });
      return;
    }
    if (!connectorDraft.connectionId) {
      setStatus({ tone: 'warn', message: 'Save the connector before testing it.' });
      return;
    }
    setTesting(true);
    setStatus({ tone: 'warn', message: `Testing ${selectedConnectorDefinition.label}...` });
    try {
      const data = await fetchJson('/api/v1/integrations/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connectorDraft.connectionId })
      });
      await loadIntegrations();
      setStatus({ tone: 'ok', message: data?.responseStatus ? `${selectedConnectorDefinition.label} test succeeded with HTTP ${data.responseStatus}.` : `${selectedConnectorDefinition.label} test succeeded.` });
    } catch (error) {
      await loadIntegrations();
      setStatus({ tone: 'bad', message: error?.message || 'Connector test failed.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Integrations"
      subtitle="Connect EveryCall to the systems that should receive your completed calls."
      status={status}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)]">
        <div className="grid min-w-0 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Connectors</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Every completed call is delivered with a classification so your downstream tools can decide what to do with it.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {connectorReview.connections.length} configured
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,1.05fr)]">
              <div className="grid gap-2">
                {CONNECTOR_DEFINITIONS.map((definition) => {
                  const connection = connectorReview.connections.find((item) => item.connectorType === definition.type);
                  const isSelected = selectedConnectorType === definition.type;
                  return (
                    <button
                      key={definition.type}
                      type="button"
                      onClick={() => setSelectedConnectorType(definition.type)}
                      className={`rounded-lg border p-3 text-left transition ${isSelected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{definition.label}</div>
                          <div className="mt-1 text-sm text-slate-500">{definition.description}</div>
                        </div>
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${connection?.status === 'enabled' ? 'bg-emerald-100 text-emerald-800' : connection ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>
                          {connection ? connection.status : 'not configured'}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {connection?.lastTestStatus ? `Test ${connection.lastTestStatus}` : 'Never tested'}
                        {connection?.reconnectRequired ? ' · Reconnect required' : ''}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="m-0 text-base font-semibold text-slate-900">{selectedConnectorDefinition.label}</h3>
                  <div className="mt-1 text-sm text-slate-500">{selectedConnectorDefinition.description}</div>
                </div>

                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium text-slate-900">Connection Name</span>
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={connectorDraft.name}
                      onChange={(event) => updateConnectorField('name', event.target.value)}
                      placeholder={selectedConnectorDefinition.defaultName}
                      disabled={!viewer.canManage}
                    />
                  </label>

                  {selectedConnectorType === CONNECTOR_TYPES.zapierHook ? (
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium text-slate-900">Hook URL</span>
                      <span className="text-xs text-slate-500">Paste the Catch Hook URL from Zapier.</span>
                      <input
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        value={connectorDraft.endpointUrl}
                        onChange={(event) => updateConnectorField('endpointUrl', event.target.value)}
                        placeholder="https://hooks.zapier.com/hooks/catch/..."
                        disabled={!viewer.canManage}
                      />
                    </label>
                  ) : null}

                  {selectedConnectorType === CONNECTOR_TYPES.hubspotPrivateApp ? (
                    <>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Private App Token</span>
                        <span className="text-xs text-slate-500">Leave blank to keep the saved token.</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          type="password"
                          value={connectorDraft.privateAppToken}
                          onChange={(event) => updateConnectorField('privateAppToken', event.target.value)}
                          placeholder="pat-..."
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={connectorDraft.createNote}
                          onChange={(event) => updateConnectorField('createNote', event.target.checked)}
                          disabled={!viewer.canManage}
                        />
                        <span>Create an EveryCall note on the contact timeline</span>
                      </label>
                    </>
                  ) : null}

                  {selectedConnectorType === CONNECTOR_TYPES.jobberClient ? (
                    <>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Client ID</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          value={connectorDraft.clientId}
                          onChange={(event) => updateConnectorField('clientId', event.target.value)}
                          placeholder="Jobber client id"
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Client Secret</span>
                        <span className="text-xs text-slate-500">Leave blank to keep the saved secret.</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          type="password"
                          value={connectorDraft.clientSecret}
                          onChange={(event) => updateConnectorField('clientSecret', event.target.value)}
                          placeholder="Jobber client secret"
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Refresh Token</span>
                        <span className="text-xs text-slate-500">Leave blank to keep the saved token.</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          type="password"
                          value={connectorDraft.refreshToken}
                          onChange={(event) => updateConnectorField('refreshToken', event.target.value)}
                          placeholder="Jobber refresh token"
                          disabled={!viewer.canManage}
                        />
                      </label>
                    </>
                  ) : null}

                  {selectedConnectorType === CONNECTOR_TYPES.serviceTitanBooking ? (
                    <>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Client ID</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          value={connectorDraft.clientId}
                          onChange={(event) => updateConnectorField('clientId', event.target.value)}
                          placeholder="ServiceTitan client id"
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Client Secret</span>
                        <span className="text-xs text-slate-500">Leave blank to keep the saved secret.</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          type="password"
                          value={connectorDraft.clientSecret}
                          onChange={(event) => updateConnectorField('clientSecret', event.target.value)}
                          placeholder="ServiceTitan client secret"
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">App Key</span>
                        <span className="text-xs text-slate-500">Leave blank to keep the saved key.</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          type="password"
                          value={connectorDraft.appKey}
                          onChange={(event) => updateConnectorField('appKey', event.target.value)}
                          placeholder="ServiceTitan app key"
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Tenant ID</span>
                        <input
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          value={connectorDraft.serviceTitanTenantId}
                          onChange={(event) => updateConnectorField('serviceTitanTenantId', event.target.value)}
                          placeholder="985798691"
                          disabled={!viewer.canManage}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-slate-900">Environment</span>
                        <select
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          value={connectorDraft.environment}
                          onChange={(event) => updateConnectorField('environment', event.target.value)}
                          disabled={!viewer.canManage}
                        >
                          <option value="integration">Integration</option>
                          <option value="production">Production</option>
                        </select>
                      </label>
                    </>
                  ) : null}

                  <label className="grid gap-1 text-sm">
                    <span className="font-medium text-slate-900">Status</span>
                    <select
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={connectorDraft.status}
                      onChange={(event) => updateConnectorField('status', event.target.value)}
                      disabled={!viewer.canManage}
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-900">Include Call Types</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {CALL_TYPE_OPTIONS.map((type) => (
                        <label key={`${selectedConnectorType}-${type}`} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={connectorDraft.includeTypes.includes(type)}
                            onChange={() => toggleConnectorTypeFilter(type)}
                            disabled={!viewer.canManage}
                          />
                          <span>{formatLabel(type)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={connectorDraft.includeNonBillable}
                      onChange={(event) => updateConnectorField('includeNonBillable', event.target.checked)}
                      disabled={!viewer.canManage}
                    />
                    <span>Include non-billable calls</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={connectorDraft.includeDuplicates}
                      onChange={(event) => updateConnectorField('includeDuplicates', event.target.checked)}
                      disabled={!viewer.canManage}
                    />
                    <span>Include duplicate leads</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={connectorDraft.includeTranscript}
                      onChange={(event) => updateConnectorField('includeTranscript', event.target.checked)}
                      disabled={!viewer.canManage}
                    />
                    <span>Include transcript when available</span>
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={saveConnector} disabled={!viewer.canManage || saving || loading}>
                      {saving ? 'Saving...' : `Save ${selectedConnectorDefinition.label}`}
                    </Button>
                    <Button variant="outline" onClick={testConnector} disabled={!viewer.canManage || testing || saving || !connectorDraft.connectionId}>
                      {testing ? 'Testing...' : 'Test Connection'}
                    </Button>
                  </div>

                  {!viewer.canManage ? (
                    <div className="text-sm text-slate-500">
                      Only the account owner can update or test integrations.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mt-0 text-lg font-semibold">Recent Delivery Activity</h2>
            {connectorReview.deliveries.length ? (
              <div className="mt-3 grid gap-2">
                {connectorReview.deliveries.slice(0, 10).map((delivery) => (
                  <div key={`${delivery.id}-${delivery.delivery_id}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-slate-900">{delivery.connection_name || formatLabel(delivery.connector_type)}</div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        delivery.status === 'delivered'
                          ? 'bg-emerald-100 text-emerald-800'
                          : delivery.status === 'skipped'
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-rose-100 text-rose-800'
                      }`}>
                        {delivery.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {delivery.event_type} · attempt {delivery.attempt_number} · {formatDateTime(delivery.created_at)}
                    </div>
                    {delivery.call_sid ? <div className="mt-1 break-all text-xs text-slate-500">Call {delivery.call_sid}</div> : null}
                    {delivery.error_message ? <div className="mt-2 text-xs text-rose-700">{delivery.error_message}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">No connector deliveries recorded yet.</div>
            )}
          </div>
        </div>

        <GuidePanel title="Integrations Guide" eyebrow="How it works" icon="settings_input_component">
          <div>Use this page to connect EveryCall to the systems that should receive your completed calls.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">What gets sent</div>
            <div className="mt-1 text-sm text-slate-600">Every completed call includes a summary, structured caller details, and a classification such as valid lead, general inquiry, or support call.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Filters</div>
            <div className="mt-1 text-sm text-slate-600">Use filters to decide which call types reach each connector, and whether non-billable calls or duplicates should be included.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Test before go-live</div>
            <div className="mt-1 text-sm text-slate-600">Save the connector first, then use Test Connection to confirm the credentials or endpoint are valid before relying on live delivery.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

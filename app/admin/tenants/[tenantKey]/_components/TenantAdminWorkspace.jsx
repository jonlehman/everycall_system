'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '../../../../../components/ui/button';
import { formatBillingCallTypeLabel, getChargeBucketMeta } from '../../../../../lib/callBilling';
import { formatPhoneDisplay } from '../../../../../lib/phoneDisplay';

const FIELD_SECTIONS = [
  {
    id: 'core',
    title: 'Core Tenant',
    description: 'Primary identity, region, and business-level account fields.',
    fields: [
      { key: 'name', label: 'Tenant name', type: 'text', required: true, hint: 'Display name shown across admin and client views.' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended'], hint: 'High-level tenant lifecycle state.' },
      { key: 'data_region', label: 'Data region', type: 'select', options: ['US', 'EU'], hint: 'Primary region used for tenant data handling.' },
      { key: 'primary_number', label: 'Primary number', type: 'text', hint: 'Customer-facing main number for the tenant.' },
      { key: 'industry', label: 'Business Category', type: 'text', hint: 'Broad business category used for knowledge-pack defaults.' }
    ]
  },
  {
    id: 'forwarding',
    title: 'Forwarding',
    description: 'Forwarding status and lifecycle timestamps.',
    fields: [
      { key: 'forwarding_setup_status', label: 'Forwarding setup status', type: 'select', options: ['not_started', 'acknowledged', 'configured'], hint: 'Operational state for forwarding setup.' },
      { key: 'forwarding_acknowledged_at', label: 'Forwarding acknowledged at', type: 'datetime', hint: 'When forwarding setup was acknowledged.' },
      { key: 'forwarding_configured_at', label: 'Forwarding configured at', type: 'datetime', hint: 'When forwarding was actually configured.' }
    ]
  },
  {
    id: 'billing',
    title: 'Billing And Access',
    description: 'Commercial status, access gates, and lockout-related fields.',
    fields: [
      { key: 'billing_status', label: 'Billing status', type: 'select', options: ['trialing', 'active', 'past_due', 'canceled'], hint: 'Commercial status used by billing lifecycle flows.' },
      { key: 'service_access_status', label: 'Service access status', type: 'select', options: ['enabled', 'disabled'], hint: 'Whether backend service access is currently enabled.' },
      { key: 'app_access_status', label: 'App access status', type: 'select', options: ['enabled', 'disabled'], hint: 'Whether tenant users can access the application.' },
      { key: 'billing_lock_reason', label: 'Billing lock reason', type: 'textarea', hint: 'Optional human-readable reason for a billing lock or manual restriction.' }
    ]
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle Dates',
    description: 'Stored timestamps related to trial, grace, billing, and deactivation.',
    fields: [
      { key: 'trial_started_at', label: 'Trial started at', type: 'datetime', hint: 'Beginning of the trial period.' },
      { key: 'trial_end', label: 'Trial end', type: 'datetime', hint: 'Current trial expiration timestamp.' },
      { key: 'post_trial_access_ends_at', label: 'Post-trial access ends at', type: 'datetime', hint: 'Access cutoff after trial ends.' },
      { key: 'billing_grace_ends_at', label: 'Billing grace ends at', type: 'datetime', hint: 'End of temporary billing grace period.' },
      { key: 'billing_status_updated_at', label: 'Billing status updated at', type: 'datetime', hint: 'Last time billing status was changed.' },
      { key: 'deactivated_at', label: 'Deactivated at', type: 'datetime', hint: 'Timestamp for tenant deactivation, if applicable.' }
    ]
  }
];

const EDITABLE_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);
const ADVANCED_VISIBLE_SECTION_IDS = new Set(['core', 'forwarding']);
const ADVANCED_FIELD_SECTIONS = FIELD_SECTIONS.filter((section) => ADVANCED_VISIBLE_SECTION_IDS.has(section.id));
const PRIMARY_USER_FIELDS = ['name', 'email', 'phoneNumber'];
const GUARDRAIL_TYPE_OPTIONS = ['dangerous_question', 'escalation', 'compliance'];
const GUARDRAIL_MODE_OPTIONS = ['clarify', 'handoff', 'emergency_redirect'];
const RISK_LEVEL_OPTIONS = ['low', 'medium', 'high'];
const ARTIFACT_STATUS_OPTIONS = ['approved_live', 'draft'];
const OVERRIDE_TYPE_OPTIONS = ['approved_answer', 'hard_fact', 'temporary_notice'];
const WEBHOOK_TYPE_OPTIONS = [
  'project_inquiry',
  'general_inquiry',
  'existing_customer_support',
  'vendor_or_sales',
  'spam',
  'wrong_number',
  'hangup_or_incomplete',
  'other_non_billable'
];
const NATIVE_CONNECTOR_TYPES = {
  zapierHook: 'zapier_hook',
  hubspotPrivateApp: 'hubspot_private_app',
  jobberClient: 'jobber_client',
  serviceTitanBooking: 'servicetitan_booking'
};
const NATIVE_CONNECTOR_DEFINITIONS = [
  {
    type: NATIVE_CONNECTOR_TYPES.zapierHook,
    label: 'Zapier',
    description: 'Send full call.completed events into a Zapier Catch Hook.',
    defaultName: 'Zapier Catch Hook'
  },
  {
    type: NATIVE_CONNECTOR_TYPES.hubspotPrivateApp,
    label: 'HubSpot',
    description: 'Create or update a HubSpot contact and attach an EveryCall note.',
    defaultName: 'HubSpot'
  },
  {
    type: NATIVE_CONNECTOR_TYPES.jobberClient,
    label: 'Jobber',
    description: 'Create a lead client in Jobber from qualified EveryCall project inquiries.',
    defaultName: 'Jobber'
  },
  {
    type: NATIVE_CONNECTOR_TYPES.serviceTitanBooking,
    label: 'ServiceTitan',
    description: 'Send qualified EveryCall inquiries into ServiceTitan CRM bookings.',
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

function joinListForEditor(value) {
  return (Array.isArray(value) ? value : []).filter(Boolean).join('\n');
}

function splitEditorList(value) {
  return String(value || '')
    .split(/\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDateTimeDisplay(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDurationDisplay(value) {
  const totalSeconds = Number(value || 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatMoney(amountCents) {
  const value = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoneyInput(amountCents) {
  const amount = Number(amountCents || 0) / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function parseMoneyInput(value, { allowZero = false } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return allowZero ? 0 : null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100);
  if (rounded < 0) return null;
  if (!allowZero && rounded <= 0) return null;
  return rounded;
}

function buildPricingDraft(billing = null, pricingCatalog = null) {
  const plans = Array.isArray(pricingCatalog?.plans) ? pricingCatalog.plans : [];
  const selectedPlanCode = billing?.pricing?.selectedPlanCode || plans[0]?.code || 'growth';
  return {
    planCode: selectedPlanCode,
    monthlyAmount: formatMoneyInput(billing?.pricing?.effectiveMonthlyAmountCents),
    includedCalls: String(Number(billing?.pricing?.includedCallCount ?? billing?.pricing?.includedCount ?? 0)),
    callOverageRate: formatMoneyInput(billing?.pricing?.effectiveCallOverageRateCents ?? billing?.pricing?.effectiveLeadRateCents)
  };
}

function buildDraftFromTenant(tenant) {
  const draft = {};
  for (const field of EDITABLE_FIELDS) {
    const value = tenant?.[field.key];
    if (field.type === 'datetime') {
      draft[field.key] = formatDateTimeLocal(value);
    } else if (field.type === 'number') {
      draft[field.key] = value === null || value === undefined ? '' : String(value);
    } else {
      draft[field.key] = value === null || value === undefined ? '' : String(value);
    }
  }
  return draft;
}

function buildPayloadFromDraft(tenantKey, draft) {
  const payload = { tenantKey };
  for (const field of EDITABLE_FIELDS) {
    const value = draft?.[field.key] ?? '';
    if (field.type === 'datetime') {
      payload[field.key] = value ? new Date(value).toISOString() : null;
    } else if (field.type === 'number') {
      payload[field.key] = value === '' ? null : Number(value);
    } else {
      payload[field.key] = value;
    }
  }
  return payload;
}

function buildPrimaryUserDraft(user) {
  return {
    name: user?.name || '',
    email: user?.email || '',
    phoneNumber: user?.phone_number || ''
  };
}

function buildGuardrailDraft(guardrail = null) {
  return {
    knowledgeGuardrailId: guardrail?.knowledge_guardrail_id || '',
    guardrailType: guardrail?.guardrail_type || 'dangerous_question',
    triggerPatternsText: joinListForEditor(guardrail?.trigger_patterns_json),
    riskLevel: guardrail?.risk_level || 'high',
    mode: guardrail?.mode || 'clarify',
    approvedResponsePattern: guardrail?.approved_response_pattern || '',
    requiredNextStep: guardrail?.required_next_step || '',
    optionalCaptureFieldsText: joinListForEditor(guardrail?.optional_capture_fields_json),
    escalationInstruction: guardrail?.escalation_instruction || '',
    enabled: guardrail ? guardrail.enabled !== false : true,
    status: guardrail?.status || 'approved_live'
  };
}

function buildOverrideDraft(override = null) {
  return {
    knowledgeOverrideId: override?.knowledge_override_id || '',
    overrideType: override?.override_type || 'approved_answer',
    title: override?.title || '',
    body: override?.body || '',
    priority: Number.isFinite(Number(override?.priority)) ? String(override.priority) : '100',
    status: override?.status || 'approved_live'
  };
}

function buildWebhookDraft(connection = null) {
  const config = connection?.config || {};
  return {
    connectionId: connection?.id || '',
    name: connection?.name || 'Outbound Webhook',
    endpointUrl: connection?.endpointUrl || '',
    status: connection?.status || 'enabled',
    signingSecret: '',
    includeTypes: Array.isArray(config.includeTypes) && config.includeTypes.length ? config.includeTypes : [...WEBHOOK_TYPE_OPTIONS],
    includeNonBillable: config.includeNonBillable !== false,
    includeDuplicates: config.includeDuplicates !== false,
    includeTranscript: config.includeTranscript === true
  };
}

function buildConnectorDraft(type, connection = null) {
  const config = connection?.config || {};
  const definition = NATIVE_CONNECTOR_DEFINITIONS.find((item) => item.type === type);
  const nativeDefaults = type === NATIVE_CONNECTOR_TYPES.zapierHook
    ? { includeTypes: [...WEBHOOK_TYPE_OPTIONS], includeNonBillable: true, includeDuplicates: true, includeTranscript: false }
    : { includeTypes: ['project_inquiry'], includeNonBillable: false, includeDuplicates: false, includeTranscript: false };
  return {
    connectionId: connection?.id || '',
    connectorType: type,
    name: connection?.name || definition?.defaultName || formatLabel(type),
    status: connection?.status || 'enabled',
    endpointUrl: connection?.endpointUrl || '',
    includeTypes: Array.isArray(config.includeTypes) && config.includeTypes.length ? config.includeTypes : nativeDefaults.includeTypes,
    includeNonBillable: typeof config.includeNonBillable === 'boolean' ? config.includeNonBillable : nativeDefaults.includeNonBillable,
    includeDuplicates: typeof config.includeDuplicates === 'boolean' ? config.includeDuplicates : nativeDefaults.includeDuplicates,
    includeTranscript: typeof config.includeTranscript === 'boolean' ? config.includeTranscript : nativeDefaults.includeTranscript,
    createNote: config.createNote !== false,
    apiVersion: config.apiVersion || '2026-01-20',
    privateAppToken: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    appKey: '',
    serviceTitanTenantId: config.tenantId || '',
    environment: config.environment || 'integration',
    resourcePath: config.resourcePath || ''
  };
}

function countChangedFields(draft, saved, keys) {
  return keys.reduce((count, key) => {
    return count + ((draft?.[key] ?? '') === (saved?.[key] ?? '') ? 0 : 1);
  }, 0);
}

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-900">{label}</span>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      {children}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()}
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className={`min-h-[92px] rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()}
    />
  );
}

function SelectInput({ value, options, ...props }) {
  const normalizedValue = value || '';
  const optionList = Array.from(new Set([normalizedValue, ...(options || [])].filter(Boolean)));
  return (
    <select
      {...props}
      value={normalizedValue}
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${props.className || ''}`.trim()}
    >
      {!optionList.length ? <option value="">Select…</option> : null}
      {optionList.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

function SummaryCard({ label, value, detail, tone = 'slate' }) {
  const toneClasses = {
    slate: 'border-slate-200 bg-slate-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    sky: 'border-sky-200 bg-sky-50',
    rose: 'border-rose-200 bg-rose-50'
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="text-xs font-semibold normal-case tracking-normal text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value || '-'}</div>
      {detail ? <div className="mt-1 text-sm text-slate-600">{detail}</div> : null}
    </div>
  );
}

function UserCard({ user }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="font-medium text-slate-900">{user.name || user.email}</div>
      <div className="text-slate-500">{user.email}</div>
      <div className="mt-1 text-xs text-slate-500">
        {user.role || 'user'} · {user.status || 'active'}{user.phone_number ? ` · ${formatPhoneDisplay(user.phone_number)}` : ''}
      </div>
    </div>
  );
}

function RuntimeStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold normal-case tracking-normal text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value ?? '-'}</div>
    </div>
  );
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

function ensureSentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildRepresentativeAnswer(answerPacket) {
  const packet = answerPacket || {};
  const direct = Array.isArray(packet.direct_answer_points) ? packet.direct_answer_points.filter(Boolean) : [];
  const qualifiers = Array.isArray(packet.qualifiers) ? packet.qualifiers.filter(Boolean) : [];
  const limits = Array.isArray(packet.limits_or_exclusions) ? packet.limits_or_exclusions.filter(Boolean) : [];
  const nextSteps = Array.isArray(packet.next_step_options) ? packet.next_step_options.filter(Boolean) : [];
  const unsupported = Array.isArray(packet.unsupported_requested_items) ? packet.unsupported_requested_items.filter(Boolean) : [];
  const shouldLeadWithNextStep = !direct.length || unsupported.length > 0 || String(packet.runtime_mode || '').trim() !== 'answer';

  const parts = [];
  if (direct.length) {
    parts.push(direct.slice(0, 2).map(ensureSentence).join(' '));
  }
  if (qualifiers.length) {
    parts.push(`Key qualifiers: ${qualifiers.slice(0, 2).join('; ')}.`);
  }
  if (limits.length) {
    parts.push(`Limits or exclusions: ${limits.slice(0, 2).join('; ')}.`);
  }
  if (unsupported.length) {
    parts.push(`Confirmed details are not available for: ${unsupported.slice(0, 2).join('; ')}.`);
  }
  if (nextSteps.length && shouldLeadWithNextStep) {
    parts.push(`Likely next step: ${ensureSentence(nextSteps[0])}`);
  }
  return parts.join(' ').trim() || 'No representative answer is available for this preview yet.';
}

function PreviewList({ title, items, emptyText = 'None.' }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {values.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {values.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-slate-500">{emptyText}</div>
      )}
    </div>
  );
}

export default function TenantAdminWorkspace({ section = 'overview' }) {
  const params = useParams();
  const router = useRouter();
  const tenantKey = String(params.tenantKey || '');

  const [tenant, setTenant] = useState(null);
  const [draft, setDraft] = useState(null);
  const [users, setUsers] = useState([]);
  const [builds, setBuilds] = useState([]);
  const [activeBuild, setActiveBuild] = useState(null);
  const [coreFacts, setCoreFacts] = useState({ activeBuildId: null, pins: [], history: [] });
  const [billingReview, setBillingReview] = useState({ billing: null, pricingCatalog: { plans: [], defaultTrialDays: null } });
  const [pricingDraft, setPricingDraft] = useState(buildPricingDraft(null, null));
  const [pricingSaving, setPricingSaving] = useState(false);
  const [demoExtensionDays, setDemoExtensionDays] = useState('');
  const [demoExtensionBusy, setDemoExtensionBusy] = useState(false);
  const [billingCallActionBusy, setBillingCallActionBusy] = useState('');
  const [billingCouponCode, setBillingCouponCode] = useState('');
  const [billingCouponBusy, setBillingCouponBusy] = useState(false);
  const [adjustmentDraft, setAdjustmentDraft] = useState({ adjustmentType: 'credit', amount: '', description: '' });
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [notificationReview, setNotificationReview] = useState({ channelHealth: [], smsFailovers: [] });
  const [status, setStatus] = useState('Loading tenant...');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [deprovisionBusy, setDeprovisionBusy] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [primaryUserDraft, setPrimaryUserDraft] = useState(buildPrimaryUserDraft(null));
  const [primaryUserSaving, setPrimaryUserSaving] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewQuery, setPreviewQuery] = useState('');
  const [preview, setPreview] = useState(null);
  const [guardrails, setGuardrails] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [guardrailDraft, setGuardrailDraft] = useState(buildGuardrailDraft(null));
  const [overrideDraft, setOverrideDraft] = useState(buildOverrideDraft(null));
  const [guardrailSaving, setGuardrailSaving] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [integrationReview, setIntegrationReview] = useState({ connections: [], deliveries: [] });
  const [webhookDraft, setWebhookDraft] = useState(buildWebhookDraft(null));
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [connectorReview, setConnectorReview] = useState({ connections: [], deliveries: [] });
  const [selectedConnectorType, setSelectedConnectorType] = useState(NATIVE_CONNECTOR_TYPES.zapierHook);
  const [connectorDraft, setConnectorDraft] = useState(buildConnectorDraft(NATIVE_CONNECTOR_TYPES.zapierHook, null));
  const [connectorSaving, setConnectorSaving] = useState(false);
  const [connectorTesting, setConnectorTesting] = useState(false);

  const primaryUser = useMemo(() => {
    if (!users.length) return null;
    return users.find((user) => user.role === 'owner') || users[0];
  }, [users]);

  const savedDraft = useMemo(() => (tenant ? buildDraftFromTenant(tenant) : null), [tenant]);
  const changedCount = useMemo(
    () => countChangedFields(draft, savedDraft, EDITABLE_FIELDS.map((field) => field.key)),
    [draft, savedDraft]
  );
  const hasUnsavedChanges = changedCount > 0;

  const savedPrimaryUserDraft = useMemo(
    () => buildPrimaryUserDraft(primaryUser),
    [primaryUser?.id, primaryUser?.name, primaryUser?.email, primaryUser?.phone_number]
  );
  const savedPricingDraft = useMemo(
    () => buildPricingDraft(billingReview.billing, billingReview.pricingCatalog),
    [billingReview]
  );
  const primaryUserChangedCount = useMemo(
    () => countChangedFields(primaryUserDraft, savedPrimaryUserDraft, PRIMARY_USER_FIELDS),
    [primaryUserDraft, savedPrimaryUserDraft]
  );
  const pricingChangedCount = useMemo(
    () => countChangedFields(pricingDraft, savedPricingDraft, ['planCode', 'monthlyAmount', 'includedCalls', 'callOverageRate']),
    [pricingDraft, savedPricingDraft]
  );
  const hasPrimaryUserChanges = primaryUserChangedCount > 0;
  const hasPricingChanges = pricingChangedCount > 0;

  useEffect(() => {
    setPrimaryUserDraft(buildPrimaryUserDraft(primaryUser));
  }, [primaryUser?.id, primaryUser?.name, primaryUser?.email, primaryUser?.phone_number]);

  useEffect(() => {
    const matching = connectorReview.connections.find((connection) => connection.connectorType === selectedConnectorType);
    setConnectorDraft(buildConnectorDraft(selectedConnectorType, matching || null));
  }, [selectedConnectorType, connectorReview.connections]);

  useEffect(() => {
    setPreview(null);
    setPreviewQuery('');
    setGuardrailDraft(buildGuardrailDraft(null));
    setOverrideDraft(buildOverrideDraft(null));
    setWebhookDraft(buildWebhookDraft(null));
    setConnectorDraft(buildConnectorDraft(selectedConnectorType, null));
    setDemoExtensionDays('');
  }, [tenantKey]);

  const loadTenant = async () => {
    if (!tenantKey) return;
    setLoading(true);
    setStatus('Loading tenant...');
    try {
      const [tenantData, usersData, buildData, billingData, integrationData, connectorData, coreFactsData] = await Promise.all([
        fetchJson(`/api/v1/tenants?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/tenant/users?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/knowledge/builds?tenantKey=${encodeURIComponent(tenantKey)}`),
        fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing`).catch(() => ({ channelHealth: [], smsFailovers: [] })),
        fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/webhooks`).catch(() => ({ connections: [], deliveries: [] })),
        fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/connectors`).catch(() => ({ connections: [], deliveries: [] })),
        fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/knowledge/core-facts`).catch(() => ({ activeBuildId: null, pins: [], history: [] }))
      ]);
      const [guardrailData, overrideData] = await Promise.all([
        fetchJson(`/api/v1/knowledge/guardrails?tenantKey=${encodeURIComponent(tenantKey)}`).catch(() => ({ guardrails: [] })),
        fetchJson(`/api/v1/knowledge/overrides?tenantKey=${encodeURIComponent(tenantKey)}`).catch(() => ({ overrides: [] }))
      ]);
      const nextTenant = tenantData?.tenant || null;
      const nextBillingReview = {
        billing: billingData?.billing || null,
        pricingCatalog: billingData?.pricingCatalog || { plans: [], defaultTrialDays: null }
      };
      setTenant(nextTenant);
      setDraft(nextTenant ? buildDraftFromTenant(nextTenant) : null);
      setUsers(Array.isArray(usersData?.users) ? usersData.users : []);
      setBuilds(Array.isArray(buildData?.builds) ? buildData.builds : []);
      setActiveBuild(buildData?.activeBuild || null);
      setCoreFacts({
        activeBuildId: coreFactsData?.activeBuildId || null,
        pins: Array.isArray(coreFactsData?.pins) ? coreFactsData.pins : [],
        history: Array.isArray(coreFactsData?.history) ? coreFactsData.history : []
      });
      setBillingReview(nextBillingReview);
      setPricingDraft(buildPricingDraft(nextBillingReview.billing, nextBillingReview.pricingCatalog));
      setDemoExtensionDays((current) => current || String(nextBillingReview.pricingCatalog?.defaultTrialDays || 14));
      setNotificationReview({
        channelHealth: Array.isArray(billingData?.channelHealth) ? billingData.channelHealth : [],
        smsFailovers: Array.isArray(billingData?.smsFailovers) ? billingData.smsFailovers : []
      });
      const nextConnections = Array.isArray(integrationData?.connections) ? integrationData.connections : [];
      setIntegrationReview({
        connections: nextConnections,
        deliveries: Array.isArray(integrationData?.deliveries) ? integrationData.deliveries : []
      });
      setWebhookDraft((current) => {
        if (current?.connectionId) {
          const matching = nextConnections.find((connection) => String(connection.id) === String(current.connectionId));
          if (matching) return buildWebhookDraft(matching);
        }
        return nextConnections[0] ? buildWebhookDraft(nextConnections[0]) : buildWebhookDraft(null);
      });
      const nextNativeConnections = Array.isArray(connectorData?.connections) ? connectorData.connections : [];
      setConnectorReview({
        connections: nextNativeConnections,
        deliveries: Array.isArray(connectorData?.deliveries) ? connectorData.deliveries : []
      });
      setGuardrails(Array.isArray(guardrailData?.guardrails) ? guardrailData.guardrails : []);
      setOverrides(Array.isArray(overrideData?.overrides) ? overrideData.overrides : []);
      setStatus(nextTenant ? 'Tenant loaded.' : 'Tenant not found.');
    } catch (error) {
      setStatus(error?.message || 'Failed to load tenant.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTenant();
  }, [tenantKey]);

  const updateField = (key, value) => {
    setDraft((current) => ({ ...(current || {}), [key]: value }));
  };

  const updatePrimaryUserField = (key, value) => {
    setPrimaryUserDraft((current) => ({ ...current, [key]: value }));
  };

  const updatePricingField = (key, value) => {
    setPricingDraft((current) => ({ ...current, [key]: value }));
  };

  const updateWebhookField = (key, value) => {
    setWebhookDraft((current) => ({ ...current, [key]: value }));
  };

  const updateConnectorField = (key, value) => {
    setConnectorDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleWebhookType = (type) => {
    setWebhookDraft((current) => {
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

  const resetToSaved = () => {
    if (!tenant) return;
    setDraft(buildDraftFromTenant(tenant));
    setStatus('Reverted unsaved tenant field changes.');
  };

  const resetPrimaryUserDraft = () => {
    setPrimaryUserDraft(buildPrimaryUserDraft(primaryUser));
    setStatus('Reverted unsaved owner changes.');
  };

  const resetPricingDraft = () => {
    setPricingDraft(buildPricingDraft(billingReview.billing, billingReview.pricingCatalog));
    setStatus('Reverted unsaved pricing changes.');
  };

  const saveTenant = async () => {
    if (!draft) return;
    setSaving(true);
    setStatus('Saving tenant...');
    try {
      const data = await fetchJson('/api/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayloadFromDraft(tenantKey, draft))
      });
      const nextTenant = data?.tenant || null;
      setTenant(nextTenant);
      setDraft(nextTenant ? buildDraftFromTenant(nextTenant) : null);
      setStatus(data?.changedFields?.length ? `Saved ${data.changedFields.length} tenant field(s).` : 'No tenant changes to save.');
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const savePrimaryUserProfile = async () => {
    if (!primaryUser) {
      setStatus('No tenant user exists for this tenant.');
      return;
    }
    if (!primaryUserDraft.name.trim() || !primaryUserDraft.email.trim()) {
      setStatus('Primary user name and email are required.');
      return;
    }

    setPrimaryUserSaving(true);
    setStatus('Saving primary user profile...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/primary-user-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(primaryUserDraft)
      });
      const updatedUser = data?.user || null;
      if (updatedUser) {
        setUsers((current) => current.map((user) => (
          user.id === updatedUser.id
            ? { ...user, ...updatedUser }
            : user
        )));
        setPrimaryUserDraft(buildPrimaryUserDraft(updatedUser));
      }
      setStatus('Primary user profile updated.');
    } catch (error) {
      setStatus(error?.message || 'Primary user update failed.');
    } finally {
      setPrimaryUserSaving(false);
    }
  };

  const savePricing = async () => {
    const selectedPlan = (Array.isArray(billingReview.pricingCatalog?.plans) ? billingReview.pricingCatalog.plans : [])
      .find((plan) => plan.code === pricingDraft.planCode);
    const monthlyAmountCents = parseMoneyInput(pricingDraft.monthlyAmount);
    const callOverageRateCents = parseMoneyInput(pricingDraft.callOverageRate, { allowZero: true });
    const includedCallCount = Number(pricingDraft.includedCalls || 0);

    if (!selectedPlan) {
      setStatus('Select a pricing tier first.');
      return;
    }
    if (monthlyAmountCents === null) {
      setStatus('Enter a valid monthly amount.');
      return;
    }
    if (callOverageRateCents === null) {
      setStatus('Enter a valid overage-per-call amount.');
      return;
    }
    if (!Number.isInteger(includedCallCount) || includedCallCount < 0) {
      setStatus('Enter a valid included-call count.');
      return;
    }

    setPricingSaving(true);
    setStatus('Saving tenant pricing...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planCode: pricingDraft.planCode,
          monthlyAmountCents,
          includedCallCount,
          callOverageRateCents
        })
      });
      setBillingReview((current) => ({
        ...current,
        billing: data?.billing ? { ...(current?.billing || {}), ...data.billing } : current.billing
      }));
      await loadTenant();
      setStatus('Tenant pricing updated.');
    } catch (error) {
      setStatus(error?.message || 'Tenant pricing update failed.');
    } finally {
      setPricingSaving(false);
    }
  };

  const extendDemo = async () => {
    const additionalDays = Number(demoExtensionDays || 0);
    if (!Number.isInteger(additionalDays) || additionalDays <= 0) {
      setStatus('Enter a whole number of demo days to add.');
      return;
    }

    setDemoExtensionBusy(true);
    setStatus('Extending demo...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing/extend-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalDays })
      });
      await loadTenant();
      const phoneNote = data?.provisionedPhoneNumber ? ` New number: ${formatPhoneDisplay(data.provisionedPhoneNumber)}.` : '';
      setStatus(`${data?.message || 'Demo updated.'}${phoneNote}`);
    } catch (error) {
      setStatus(error?.message || 'Could not extend demo.');
    } finally {
      setDemoExtensionBusy(false);
    }
  };

  const applyBillingCoupon = async () => {
    const code = String(billingCouponCode || '').trim().toUpperCase();
    if (!code) {
      setStatus('Enter a coupon code first.');
      return;
    }
    setBillingCouponBusy(true);
    setStatus('Applying coupon...');
    try {
      await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing/coupons/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      setBillingCouponCode('');
      await loadTenant();
      setStatus('Coupon applied.');
    } catch (error) {
      setStatus(error?.message || 'Could not apply coupon.');
    } finally {
      setBillingCouponBusy(false);
    }
  };

  const revokeBillingCoupon = async () => {
    const confirmed = window.confirm('Revoke the active coupon for this tenant?');
    if (!confirmed) return;
    setBillingCouponBusy(true);
    setStatus('Revoking coupon...');
    try {
      await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing/coupons/revoke`, {
        method: 'POST'
      });
      await loadTenant();
      setStatus('Coupon revoked.');
    } catch (error) {
      setStatus(error?.message || 'Could not revoke coupon.');
    } finally {
      setBillingCouponBusy(false);
    }
  };

  const toggleCallBillingExclusion = async (call) => {
    const billingPeriodId = Number(billingReview.billing?.currentBillingPeriod?.billingPeriodId || 0);
    if (!call?.call_sid || !billingPeriodId) return;
    const action = String(call.charge_bucket || '').toLowerCase() === 'excluded' ? 'reinclude' : 'exclude';
    setBillingCallActionBusy(call.call_sid);
    setStatus(action === 'exclude' ? 'Excluding call from billing...' : 'Re-including call in billing...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing/calls/${encodeURIComponent(call.call_sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingPeriodId,
          action
        })
      });
      setBillingReview((current) => ({
        ...current,
        billing: {
          ...(current?.billing || {}),
          currentBillingPeriod: data?.currentBillingPeriod || current?.billing?.currentBillingPeriod
        }
      }));
      setStatus(action === 'exclude' ? 'Call excluded from billing.' : 'Call restored to automatic billing.');
    } catch (error) {
      setStatus(error?.message || 'Could not update call billing.');
    } finally {
      setBillingCallActionBusy('');
    }
  };

  const saveBillingAdjustment = async () => {
    const billingPeriodId = Number(billingReview.billing?.currentBillingPeriod?.billingPeriodId || 0);
    const amountCents = parseMoneyInput(adjustmentDraft.amount);
    if (!billingPeriodId) {
      setStatus('No current billing period is available.');
      return;
    }
    if (!amountCents) {
      setStatus('Enter a valid adjustment amount.');
      return;
    }
    if (!adjustmentDraft.description.trim()) {
      setStatus('Enter an adjustment description.');
      return;
    }
    setAdjustmentSaving(true);
    setStatus('Saving billing adjustment...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingPeriodId,
          adjustmentType: adjustmentDraft.adjustmentType,
          amountCents,
          description: adjustmentDraft.description.trim()
        })
      });
      setBillingReview((current) => ({
        ...current,
        billing: {
          ...(current?.billing || {}),
          currentBillingPeriod: data?.currentBillingPeriod || current?.billing?.currentBillingPeriod
        }
      }));
      setAdjustmentDraft({ adjustmentType: 'credit', amount: '', description: '' });
      setStatus('Billing adjustment saved.');
    } catch (error) {
      setStatus(error?.message || 'Could not save billing adjustment.');
    } finally {
      setAdjustmentSaving(false);
    }
  };

  const deleteTenant = async () => {
    const confirmed = window.confirm(`Delete tenant "${tenant?.name || tenantKey}" and all associated data?`);
    if (!confirmed) return;
    setDeleteBusy(true);
    setStatus('Deleting tenant...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!data?.ok) {
        setStatus(data?.message || data?.error || 'Delete failed.');
        return;
      }
      setStatus('Tenant deleted.');
      router.push('/admin/tenants');
    } catch (error) {
      setStatus(error?.message || 'Delete failed.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const provisionVoiceNumber = async () => {
    setProvisionBusy(true);
    setStatus('Provisioning voice number...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/phone-number/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setStatus(data?.ok ? `Provisioned ${formatPhoneDisplay(data.phoneNumber)}.` : (data?.message || data?.error || 'Provisioning failed.'));
      await loadTenant();
    } catch (error) {
      setStatus(error?.message || 'Provisioning failed.');
    } finally {
      setProvisionBusy(false);
    }
  };

  const deprovisionVoiceNumber = async () => {
    if (!tenant?.telnyx_voice_number) return;
    const confirmed = window.confirm(`Delete voice number ${formatPhoneDisplay(tenant.telnyx_voice_number)}?`);
    if (!confirmed) return;
    setDeprovisionBusy(true);
    setStatus('Deprovisioning voice number...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/phone-number/deprovision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setStatus(data?.ok ? 'Voice number deprovisioned.' : (data?.message || data?.error || 'Deprovision failed.'));
      await loadTenant();
    } catch (error) {
      setStatus(error?.message || 'Deprovision failed.');
    } finally {
      setDeprovisionBusy(false);
    }
  };

  const setPrimaryUserPassword = async () => {
    if (!primaryUser) {
      setStatus('No tenant user exists for this tenant.');
      return;
    }
    if (!passwordDraft || passwordDraft.length < 8) {
      setStatus('Password must be at least 8 characters.');
      return;
    }
    if (passwordDraft !== passwordConfirm) {
      setStatus('Passwords do not match.');
      return;
    }

    setPasswordBusy(true);
    setStatus('Updating primary user password...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/primary-user-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordDraft })
      });
      setPasswordDraft('');
      setPasswordConfirm('');
      setStatus(`Updated password for ${data?.user?.email || primaryUser.email}.`);
    } catch (error) {
      setStatus(error?.message || 'Password update failed.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const runRuntimePreview = async () => {
    if (!previewQuery.trim()) {
      setStatus('Enter a caller-style question first.');
      return;
    }
    setPreviewBusy(true);
    setPreview(null);
    setStatus('Running admin runtime preview...');
    try {
      const data = await fetchJson(`/api/v1/knowledge/runtime-preview?tenantKey=${encodeURIComponent(tenantKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: previewQuery.trim() })
      });
      setPreview(data);
      setStatus('Admin runtime preview ready.');
    } catch (error) {
      setStatus(error?.message || 'Runtime preview failed.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const saveGuardrail = async () => {
    setGuardrailSaving(true);
    setStatus('Saving safety rule...');
    try {
      const data = await fetchJson(`/api/v1/knowledge/guardrails?tenantKey=${encodeURIComponent(tenantKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          knowledgeGuardrailId: guardrailDraft.knowledgeGuardrailId || undefined,
          guardrailType: guardrailDraft.guardrailType,
          triggerPatterns: splitEditorList(guardrailDraft.triggerPatternsText),
          riskLevel: guardrailDraft.riskLevel,
          mode: guardrailDraft.mode,
          approvedResponsePattern: guardrailDraft.approvedResponsePattern,
          requiredNextStep: guardrailDraft.requiredNextStep || undefined,
          optionalCaptureFields: splitEditorList(guardrailDraft.optionalCaptureFieldsText),
          escalationInstruction: guardrailDraft.escalationInstruction || undefined,
          enabled: guardrailDraft.enabled,
          status: guardrailDraft.status
        })
      });
      const savedGuardrail = data?.guardrail || null;
      const refreshed = await fetchJson(`/api/v1/knowledge/guardrails?tenantKey=${encodeURIComponent(tenantKey)}`).catch(() => null);
      setGuardrails(Array.isArray(refreshed?.guardrails) ? refreshed.guardrails : []);
      setGuardrailDraft(buildGuardrailDraft(savedGuardrail));
      setStatus('Safety rule saved.');
    } catch (error) {
      setStatus(error?.message || 'Safety rule save failed.');
    } finally {
      setGuardrailSaving(false);
    }
  };

  const saveOverride = async () => {
    setOverrideSaving(true);
    setStatus('Saving approved answer...');
    try {
      const data = await fetchJson(`/api/v1/knowledge/overrides?tenantKey=${encodeURIComponent(tenantKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          knowledgeOverrideId: overrideDraft.knowledgeOverrideId || undefined,
          overrideType: overrideDraft.overrideType,
          title: overrideDraft.title,
          body: overrideDraft.body,
          priority: Number(overrideDraft.priority || 100),
          status: overrideDraft.status
        })
      });
      const savedOverride = data?.override || null;
      const refreshed = await fetchJson(`/api/v1/knowledge/overrides?tenantKey=${encodeURIComponent(tenantKey)}`).catch(() => null);
      setOverrides(Array.isArray(refreshed?.overrides) ? refreshed.overrides : []);
      setOverrideDraft(buildOverrideDraft(savedOverride));
      setStatus('Approved answer saved.');
    } catch (error) {
      setStatus(error?.message || 'Approved answer save failed.');
    } finally {
      setOverrideSaving(false);
    }
  };

  const saveWebhookConnection = async () => {
    setWebhookSaving(true);
    setStatus('Saving outbound webhook...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: webhookDraft.connectionId || undefined,
          name: webhookDraft.name,
          endpointUrl: webhookDraft.endpointUrl,
          status: webhookDraft.status,
          signingSecret: webhookDraft.signingSecret || undefined,
          includeTypes: webhookDraft.includeTypes,
          includeNonBillable: webhookDraft.includeNonBillable,
          includeDuplicates: webhookDraft.includeDuplicates,
          includeTranscript: webhookDraft.includeTranscript
        })
      });
      const connections = Array.isArray(data?.connections) ? data.connections : [];
      setIntegrationReview({
        connections,
        deliveries: Array.isArray(data?.deliveries) ? data.deliveries : []
      });
      setWebhookDraft(buildWebhookDraft(data?.connection || connections[0] || null));
      if (data?.generatedSecret) {
        setStatus(`Outbound webhook saved. Generated signing secret: ${data.generatedSecret}`);
      } else {
        setStatus('Outbound webhook saved.');
      }
    } catch (error) {
      setStatus(error?.message || 'Outbound webhook save failed.');
    } finally {
      setWebhookSaving(false);
    }
  };

  const testWebhookConnection = async () => {
    const connectionId = webhookDraft.connectionId;
    if (!connectionId) {
      setStatus('Save the outbound webhook before testing it.');
      return;
    }
    setWebhookTesting(true);
    setStatus('Sending webhook test...');
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/webhooks/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId })
      });
      await loadTenant();
      setStatus(data?.responseStatus ? `Webhook test succeeded with HTTP ${data.responseStatus}.` : 'Webhook test succeeded.');
    } catch (error) {
      setStatus(error?.message || 'Webhook test failed.');
      await loadTenant();
    } finally {
      setWebhookTesting(false);
    }
  };

  const saveConnector = async () => {
    setConnectorSaving(true);
    setStatus(`Saving ${formatLabel(selectedConnectorType)} connector...`);
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/connectors`, {
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
          apiVersion: connectorDraft.apiVersion,
          privateAppToken: connectorDraft.privateAppToken || undefined,
          clientId: connectorDraft.clientId || undefined,
          clientSecret: connectorDraft.clientSecret || undefined,
          refreshToken: connectorDraft.refreshToken || undefined,
          appKey: connectorDraft.appKey || undefined,
          serviceTitanTenantId: connectorDraft.serviceTitanTenantId || undefined,
          environment: connectorDraft.environment,
          resourcePath: connectorDraft.resourcePath || undefined
        })
      });
      setConnectorReview({
        connections: Array.isArray(data?.connections) ? data.connections : [],
        deliveries: Array.isArray(data?.deliveries) ? data.deliveries : []
      });
      setStatus(`${formatLabel(selectedConnectorType)} connector saved.`);
    } catch (error) {
      setStatus(error?.message || 'Connector save failed.');
    } finally {
      setConnectorSaving(false);
    }
  };

  const testConnector = async () => {
    const connectionId = connectorDraft.connectionId;
    if (!connectionId) {
      setStatus('Save the connector before testing it.');
      return;
    }
    setConnectorTesting(true);
    setStatus(`Testing ${formatLabel(selectedConnectorType)} connector...`);
    try {
      const data = await fetchJson(`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/connectors/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId })
      });
      await loadTenant();
      setStatus(data?.responseStatus ? `${formatLabel(selectedConnectorType)} test succeeded with HTTP ${data.responseStatus}.` : `${formatLabel(selectedConnectorType)} test succeeded.`);
    } catch (error) {
      setStatus(error?.message || 'Connector test failed.');
      await loadTenant();
    } finally {
      setConnectorTesting(false);
    }
  };

  const unsavedNotes = [];
  if (hasPrimaryUserChanges) {
    unsavedNotes.push(`${primaryUserChangedCount} primary user change${primaryUserChangedCount === 1 ? '' : 's'}`);
  }
  if (hasPricingChanges) {
    unsavedNotes.push(`${pricingChangedCount} billing pricing change${pricingChangedCount === 1 ? '' : 's'}`);
  }
  if (hasUnsavedChanges) {
    unsavedNotes.push(`${changedCount} advanced tenant field${changedCount === 1 ? '' : 's'}`);
  }

  const primaryUserLabel = primaryUser?.role === 'owner' ? 'Owner' : 'Primary User';
  const latestBuild = builds[0] || null;
  const activeRuntimeReady = Boolean(
    activeBuild?.active_build_id
    && latestBuild?.build_id
    && activeBuild.active_build_id === latestBuild.build_id
    && String(latestBuild?.status || '').trim().toLowerCase() === 'published'
  );
  const availablePricingPlans = Array.isArray(billingReview.pricingCatalog?.plans) ? billingReview.pricingCatalog.plans : [];
  const selectedPricingPlan = availablePricingPlans.find((plan) => plan.code === pricingDraft.planCode) || availablePricingPlans[0] || null;
  const pricingState = billingReview.billing?.pricing || null;
  const activeBillingCoupon = billingReview.billing?.activeCoupon || null;
  const currentBillingPeriod = billingReview.billing?.currentBillingPeriod || null;
  const pricingSubscriptionDisplayId = billingReview.billing?.stripeSubscriptionDisplayId
    || pricingState?.subscriptionDisplayId
    || '—';
  const demoBillingStatus = String(billingReview.billing?.status || tenant?.billing_status || '').trim().toLowerCase();
  const canExtendDemo = ['trialing', 'trial_expired', 'deactivated'].includes(demoBillingStatus);
  const extendDemoWillProvisionNumber = demoBillingStatus === 'deactivated' && !tenant?.telnyx_voice_number;
  const previewPlanner = preview?.planner || null;
  const previewAnswerPacket = preview?.answerPacket || null;
  const previewRuntimeBundle = preview?.runtimeBundle || null;
  const representativeAnswer = preview?.spokenAnswerEstimate || buildRepresentativeAnswer(previewAnswerPacket);
  const selectedConnectorDefinition = NATIVE_CONNECTOR_DEFINITIONS.find((item) => item.type === selectedConnectorType) || NATIVE_CONNECTOR_DEFINITIONS[0];
  const showOverview = section === 'overview';
  const showBilling = section === 'billing';
  const showVoiceIntegrations = section === 'voice-integrations';
  const showKnowledge = section === 'knowledge';
  const showAdvanced = section === 'advanced';

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{tenant?.name || tenantKey}</h1>
          <div className="text-sm text-slate-500">Use the subpages below to manage contacts, billing, voice and integrations, knowledge runtime, and advanced tenant record fields.</div>
          <div className="mt-1 text-xs text-slate-500">Tenant key: <code>{tenantKey}</code></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/admin/tenants">Back</Link>
          <Button variant="outline" onClick={loadTenant} disabled={loading || saving || primaryUserSaving}>Reload</Button>
          <Button variant="destructive" onClick={deleteTenant} disabled={deleteBusy}>
            {deleteBusy ? 'Deleting...' : 'Delete Tenant'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="text-sm text-slate-700">{status}</div>
        <div className="mt-1 text-xs text-slate-500">
          {unsavedNotes.length ? `Unsaved: ${unsavedNotes.join(' · ')}.` : 'No unsaved changes.'}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Account"
          value={`${tenant?.status || 'unknown'} / ${tenant?.billing_status || 'unknown'}`}
          detail={`Plan ${tenant?.plan || '-'} · App ${tenant?.app_access_status || '-'}`}
          tone={tenant?.status === 'active' ? 'emerald' : 'amber'}
        />
        <SummaryCard
          label={primaryUserLabel}
          value={primaryUser?.name || primaryUser?.email || 'No tenant user'}
          detail={primaryUser?.email ? `${primaryUser.email}${primaryUser?.phone_number ? ` · ${formatPhoneDisplay(primaryUser.phone_number)}` : ''}` : 'No contact configured'}
          tone="sky"
        />
        <SummaryCard
          label="Voice Number"
          value={tenant?.telnyx_voice_number ? formatPhoneDisplay(tenant.telnyx_voice_number) : 'Unassigned'}
          detail={`${tenant?.telnyx_voice_status || 'not provisioned'} · Primary ${formatPhoneDisplay(tenant?.primary_number) || '-'}`}
          tone={tenant?.telnyx_voice_number ? 'emerald' : 'amber'}
        />
        <SummaryCard
          label="Knowledge"
          value={activeRuntimeReady ? 'live build published' : (latestBuild?.status || 'none')}
          detail={`Active build ${activeBuild?.active_build_id || 'none'} · ${builds.length} build${builds.length === 1 ? '' : 's'}`}
          tone={activeRuntimeReady ? 'emerald' : 'amber'}
        />
      </div>

      <div className="grid gap-4">
        {showOverview ? (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-lg font-semibold">{primaryUserLabel} And Access</h2>
              <div className="text-sm text-slate-500">Update the main tenant contact first. Password reset stays separate from profile edits.</div>
            </div>
            {primaryUser ? (
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {primaryUser.role || 'user'} · {primaryUser.status || 'active'}
              </div>
            ) : null}
          </div>

          {primaryUser ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
              <div className="grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="font-medium text-slate-900">{primaryUser.name || primaryUser.email}</div>
                  <div className="text-slate-500">{primaryUser.email}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {primaryUser.phone_number ? formatPhoneDisplay(primaryUser.phone_number) : 'No mobile phone on file'}
                  </div>
                </div>

                <Field label="Name" hint="Displayed as the tenant owner or main contact in admin reporting and the client workspace.">
                  <TextInput
                    value={primaryUserDraft.name}
                    onChange={(event) => updatePrimaryUserField('name', event.target.value)}
                    placeholder="Owner name"
                  />
                </Field>

                <Field label="Email" hint="Primary login email for the main tenant user account. Must remain unique across tenant users.">
                  <TextInput
                    type="email"
                    value={primaryUserDraft.email}
                    onChange={(event) => updatePrimaryUserField('email', event.target.value)}
                    placeholder="owner@company.com"
                  />
                </Field>

                <Field label="Mobile Phone" hint="Used for SMS opt-in and lead notifications. Changing it resets SMS opt-in status.">
                  <TextInput
                    value={primaryUserDraft.phoneNumber}
                    onChange={(event) => updatePrimaryUserField('phoneNumber', event.target.value)}
                    placeholder="+1XXXXXXXXXX"
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={savePrimaryUserProfile} disabled={primaryUserSaving || !hasPrimaryUserChanges}>
                    {primaryUserSaving ? 'Saving...' : `Save ${primaryUserLabel}`}
                  </Button>
                  <Button variant="outline" onClick={resetPrimaryUserDraft} disabled={primaryUserSaving || !hasPrimaryUserChanges}>
                    Reset
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="m-0 text-base font-semibold text-slate-900">Reset {primaryUserLabel} Password</h3>
                  <div className="mt-1 text-sm text-slate-500">
                    This targets the same primary tenant login account shown on the left.
                  </div>
                </div>
                <Field label="New Password" hint="Admin-only direct password set for the tenant’s main user account. Minimum 8 characters.">
                  <TextInput
                    type="password"
                    value={passwordDraft}
                    onChange={(event) => setPasswordDraft(event.target.value)}
                    placeholder="Enter a new password"
                  />
                </Field>
                <Field label="Confirm Password" hint="Re-enter the same password before saving.">
                  <TextInput
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder="Confirm the password"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={setPrimaryUserPassword} disabled={passwordBusy || !passwordDraft || !passwordConfirm}>
                    {passwordBusy ? 'Updating...' : 'Set Password'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPasswordDraft('');
                      setPasswordConfirm('');
                      setStatus('Cleared unsaved password input.');
                    }}
                    disabled={passwordBusy || (!passwordDraft && !passwordConfirm)}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-500">No tenant users found, so there is no owner or primary login account to edit.</div>
          )}
        </section>
        ) : null}

        {!showOverview && !showAdvanced ? (
        <div className="grid gap-4">
          {showBilling ? (
          <>
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Extend Demo</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Add demo days to an active trial, or reopen an expired demo from today.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                Status: {billingReview.billing?.status || tenant?.billing_status || 'unknown'}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <RuntimeStat label="Current Trial End" value={formatDateTimeDisplay(billingReview.billing?.trialEnd || tenant?.trial_end)} />
              <RuntimeStat label="Days Remaining" value={billingReview.billing?.trialDaysRemaining ?? '-'} />
              <RuntimeStat label="App Access" value={billingReview.billing?.appAccessStatus || tenant?.app_access_status || '-'} />
              <RuntimeStat label="Voice Number" value={formatPhoneDisplay(tenant?.telnyx_voice_number) || 'Unassigned'} />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-medium text-slate-900">How it works</div>
                <div className="mt-2">
                  If the tenant is still in trial, the new days are added to the current trial end. If the demo already expired, the trial reopens for the number of days entered starting now.
                </div>
                <div className="mt-2">
                  If a Stripe subscription is already in `trialing`, Stripe’s trial end is updated too so billing stays aligned.
                </div>
                {extendDemoWillProvisionNumber ? (
                  <div className="mt-2 font-medium text-amber-800">
                    This tenant is deactivated and has no Sales Receptionist Number assigned. Extending the demo will provision a replacement number.
                  </div>
                ) : null}
                {!canExtendDemo ? (
                  <div className="mt-2 font-medium text-rose-700">
                    Demo extension is only available while the tenant is `trialing`, `trial_expired`, or `deactivated`.
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3">
                  <Field label="Additional Demo Days" hint="Enter how many days to add. For expired demos, this becomes the new trial length from today.">
                    <TextInput
                      inputMode="numeric"
                      value={demoExtensionDays}
                      onChange={(event) => setDemoExtensionDays(event.target.value)}
                      placeholder={String(billingReview.pricingCatalog?.defaultTrialDays || 14)}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={extendDemo} disabled={demoExtensionBusy || !canExtendDemo}>
                      {demoExtensionBusy ? 'Extending...' : 'Extend Demo'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDemoExtensionDays(String(billingReview.pricingCatalog?.defaultTrialDays || 14));
                        setStatus('Reset demo extension days.');
                      }}
                      disabled={demoExtensionBusy}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Billing Pricing</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Choose a standard tier or set tenant-specific monthly and per-call pricing.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                Subscription ID: {pricingSubscriptionDisplayId}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <RuntimeStat label="Billing Status" value={billingReview.billing?.status || '-'} />
              <RuntimeStat label="Default Trial Days" value={billingReview.pricingCatalog?.defaultTrialDays ?? '-'} />
              <RuntimeStat
                label="Current Monthly"
                value={billingReview.billing?.plan ? formatMoney(billingReview.billing.plan.monthlyAmountCents) : '-'}
              />
              <RuntimeStat
                label="Current Overage / Call"
                value={billingReview.billing?.plan ? formatMoney(billingReview.billing.plan.callOverageRateCents) : '-'}
              />
            </div>

            <div className="mt-4 grid gap-3">
              <Field label="Pricing Tier" hint="Changing tiers resets the monthly amount, included calls, and overage-per-call fields to that tier’s defaults.">
                <SelectInput
                  value={pricingDraft.planCode}
                  options={availablePricingPlans.map((plan) => plan.code)}
                  onChange={(event) => {
                    const nextPlan = availablePricingPlans.find((plan) => plan.code === event.target.value) || null;
                    setPricingDraft((current) => ({
                      ...current,
                      planCode: event.target.value,
                      monthlyAmount: nextPlan ? formatMoneyInput(nextPlan.monthlyAmountCents) : current.monthlyAmount,
                      includedCalls: String(Number(nextPlan?.includedCallCount ?? nextPlan?.includedCount ?? 0)),
                      callOverageRate: nextPlan ? formatMoneyInput(nextPlan.callOverageRateCents ?? nextPlan.leadRateCents) : current.callOverageRate
                    }));
                  }}
                />
              </Field>

              {selectedPricingPlan ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  Tier default: {selectedPricingPlan.label} · {formatMoney(selectedPricingPlan.monthlyAmountCents)} / month · {Number(selectedPricingPlan.includedCallCount ?? selectedPricingPlan.includedCount ?? 0)} included calls · {formatMoney(selectedPricingPlan.callOverageRateCents ?? selectedPricingPlan.leadRateCents)} / overage call
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Monthly Amount" hint="Override the monthly base for this tenant if needed.">
                  <div className="flex items-center rounded-md border border-slate-300 bg-white px-3">
                    <span className="text-sm text-slate-500">$</span>
                    <input
                      inputMode="decimal"
                      value={pricingDraft.monthlyAmount}
                      onChange={(event) => updatePricingField('monthlyAmount', event.target.value)}
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm focus:outline-none"
                    />
                  </div>
                </Field>
                <Field label="Included Calls" hint="Calls included before overages begin.">
                  <input
                    inputMode="numeric"
                    value={pricingDraft.includedCalls}
                    onChange={(event) => updatePricingField('includedCalls', event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Overage Per Call" hint="Used for billing estimates and Stripe overage pricing.">
                  <div className="flex items-center rounded-md border border-slate-300 bg-white px-3">
                    <span className="text-sm text-slate-500">$</span>
                    <input
                      inputMode="decimal"
                      value={pricingDraft.callOverageRate}
                      onChange={(event) => updatePricingField('callOverageRate', event.target.value)}
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm focus:outline-none"
                    />
                  </div>
                </Field>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                {billingReview.billing?.plan?.isCustom
                  ? `Custom pricing is active. Base tier: ${billingReview.billing.plan.basePlanLabel}.`
                  : `Standard tier pricing is active${billingReview.billing?.plan?.label ? `: ${billingReview.billing.plan.label}.` : '.'}`}
                {billingReview.billing?.pricing?.stripeSubscriptionId
                  ? ` Stripe record: ${billingReview.billing.pricing.stripeSubscriptionId}.`
                  : ' No Stripe subscription is linked yet.'}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <div className="font-medium text-slate-900">Coupon</div>
                {activeBillingCoupon ? (
                  <div className="mt-2 grid gap-2 md:grid-cols-[220px_1fr]">
                    <div>Active code</div><div>{activeBillingCoupon.code}</div>
                    <div>Monthly discount</div><div>{Number(activeBillingCoupon.monthlyDiscountPercent || 0)}%</div>
                    <div>Overage discount</div><div>{Number(activeBillingCoupon.overageDiscountPercent || 0)}%</div>
                    <div>Free trial</div><div>{Number(activeBillingCoupon.freeTrialDays || 0)} day(s)</div>
                    <div>Discount duration</div><div>{Number(activeBillingCoupon.discountDurationDays || 0) === 0 ? 'Unlimited' : `${activeBillingCoupon.discountDurationDays} day(s)`}</div>
                    <div>Trial ends</div><div>{activeBillingCoupon.trialEndsAt ? formatDateTimeDisplay(activeBillingCoupon.trialEndsAt) : '—'}</div>
                    <div>Discount starts</div><div>{activeBillingCoupon.discountStartsAt ? formatDateTimeDisplay(activeBillingCoupon.discountStartsAt) : (activeBillingCoupon.pendingPaidDiscountStart ? 'When paid billing begins' : '—')}</div>
                    <div>Discount ends</div><div>{activeBillingCoupon.discountEndsAt ? formatDateTimeDisplay(activeBillingCoupon.discountEndsAt) : 'Unlimited / pending'}</div>
                  </div>
                ) : (
                  <div className="mt-2">No active coupon is attached to this tenant.</div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={billingCouponCode}
                    onChange={(event) => setBillingCouponCode(event.target.value.toUpperCase())}
                    placeholder="Coupon code"
                  />
                  <Button onClick={applyBillingCoupon} disabled={billingCouponBusy}>
                    {billingCouponBusy ? 'Saving...' : (activeBillingCoupon ? 'Replace Coupon' : 'Apply Coupon')}
                  </Button>
                  {activeBillingCoupon ? (
                    <Button variant="outline" onClick={revokeBillingCoupon} disabled={billingCouponBusy}>
                      Remove Coupon
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={savePricing} disabled={pricingSaving || !hasPricingChanges}>
                  {pricingSaving ? 'Saving...' : 'Save Pricing'}
                </Button>
                <Button variant="outline" onClick={resetPricingDraft} disabled={pricingSaving || !hasPricingChanges}>
                  Reset
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Current Billing Period</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Exclude calls from usage, add credits or debits, and review the current call-usage ledger.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {currentBillingPeriod?.currentPeriod?.start ? `${formatDateTimeDisplay(currentBillingPeriod.currentPeriod.start)} → ${formatDateTimeDisplay(currentBillingPeriod.currentPeriod.end)}` : 'No active period'}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <RuntimeStat label="Eligible Calls" value={currentBillingPeriod?.callUsage?.eligibleCallCount ?? '-'} />
              <RuntimeStat label="Included Used" value={currentBillingPeriod?.callUsage?.includedCallCountUsed ?? '-'} />
              <RuntimeStat label="Overage Calls" value={currentBillingPeriod?.callUsage?.overageCallCount ?? '-'} />
              <RuntimeStat label="Estimate" value={currentBillingPeriod ? formatMoney(currentBillingPeriod.invoiceEstimate?.totalEstimatedInvoiceCents) : '-'} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Duration</th>
                      <th className="px-3 py-2 font-medium">Caller</th>
                      <th className="px-3 py-2 font-medium">Charge Bucket</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(currentBillingPeriod?.callUsage?.recentCalls) && currentBillingPeriod.callUsage.recentCalls.length ? currentBillingPeriod.callUsage.recentCalls.map((call) => {
                      const bucketMeta = getChargeBucketMeta(call?.charge_bucket);
                      const busy = billingCallActionBusy === call.call_sid;
                      return (
                        <tr key={call.call_sid} className="border-b border-slate-100 align-top last:border-b-0">
                          <td className="px-3 py-2 text-slate-700">{formatDateTimeDisplay(call.created_at)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatDurationDisplay(call.duration_seconds)}</td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="font-medium text-slate-900">{[call.caller_first_name, call.caller_last_name].filter(Boolean).join(' ') || 'Unknown caller'}</div>
                            <div className="text-xs text-slate-500">{call.callback_number || '-'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${bucketMeta.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : bucketMeta.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                              {bucketMeta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            <div>{call.billing_call_type_label || formatBillingCallTypeLabel(call.billing_call_type_code)}</div>
                            <div className="text-xs text-slate-500">{call.summary || call.service_required || 'No summary available.'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              variant="outline"
                              onClick={() => toggleCallBillingExclusion(call)}
                              disabled={busy}
                            >
                              {busy ? 'Saving...' : String(call?.charge_bucket || '').toLowerCase() === 'excluded' ? 'Re-include' : 'Exclude'}
                            </Button>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-slate-500">No calls are assigned to the current billing period yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="m-0 text-base font-semibold text-slate-900">Adjustment</h3>
                  <div className="mt-1 text-sm text-slate-500">
                    Add a manual credit or debit for the current billing period.
                  </div>
                </div>
                <Field label="Type">
                  <SelectInput
                    value={adjustmentDraft.adjustmentType}
                    options={['credit', 'debit']}
                    onChange={(event) => setAdjustmentDraft((current) => ({ ...current, adjustmentType: event.target.value }))}
                  />
                </Field>
                <Field label="Amount">
                  <div className="flex items-center rounded-md border border-slate-300 bg-white px-3">
                    <span className="text-sm text-slate-500">$</span>
                    <input
                      inputMode="decimal"
                      value={adjustmentDraft.amount}
                      onChange={(event) => setAdjustmentDraft((current) => ({ ...current, amount: event.target.value }))}
                      className="w-full border-0 bg-transparent px-2 py-2 text-sm focus:outline-none"
                    />
                  </div>
                </Field>
                <Field label="Description">
                  <TextInput
                    value={adjustmentDraft.description}
                    onChange={(event) => setAdjustmentDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Reason for the adjustment"
                  />
                </Field>
                <Button onClick={saveBillingAdjustment} disabled={adjustmentSaving}>
                  {adjustmentSaving ? 'Saving...' : 'Add Adjustment'}
                </Button>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                  Net adjustments: {formatMoney(currentBillingPeriod?.adjustments?.netAdjustmentAmountCents || 0)}
                </div>
              </div>
            </div>
          </section>
          </>
          ) : null}

          {showVoiceIntegrations ? (
          <>
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Voice Number</h2>
            <div className="mt-3 grid grid-cols-[140px_1fr] gap-2 text-sm">
              <div className="text-slate-500">Assigned number</div>
              <div className="font-medium text-slate-900">{formatPhoneDisplay(tenant?.telnyx_voice_number) || 'None'}</div>
              <div className="text-slate-500">Primary number</div>
              <div className="font-medium text-slate-900">{formatPhoneDisplay(tenant?.primary_number) || '-'}</div>
              <div className="text-slate-500">Status</div>
              <div className="font-medium text-slate-900">{tenant?.telnyx_voice_status || '-'}</div>
              <div className="text-slate-500">Purchased</div>
              <div className="font-medium text-slate-900">{formatDateTimeDisplay(tenant?.telnyx_voice_purchased_at)}</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={provisionVoiceNumber} disabled={provisionBusy}>
                {provisionBusy ? 'Provisioning...' : 'Provision Voice Number'}
              </Button>
              <Button variant="outline" onClick={deprovisionVoiceNumber} disabled={deprovisionBusy || !tenant?.telnyx_voice_number}>
                {deprovisionBusy ? 'Deprovisioning...' : 'Deprovision Voice Number'}
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Recent SMS Delivery Failures</h2>
            <div className="mt-1 text-sm text-slate-500">
              Failover callbacks from Telnyx are stored here for admin review.
            </div>
            {notificationReview.smsFailovers.length ? (
              <div className="mt-3 grid gap-2">
                {notificationReview.smsFailovers.map((event, index) => (
                  <div key={`${event.provider_event_id || event.provider_message_id || index}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="font-medium text-slate-900">{formatPhoneDisplay(event.destination) || event.destination || 'Unknown destination'}</div>
                    <div className="mt-1 text-slate-600">{event.reason || 'SMS delivery failed.'}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTimeDisplay(event.created_at)}
                      {event.provider_message_id ? ` · Message ${event.provider_message_id}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">No recent SMS delivery failures recorded.</div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Outbound Webhooks</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Phase 1 integrations: signed `call.completed` deliveries with per-connection filters.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {integrationReview.connections.length} connection{integrationReview.connections.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,1.1fr)]">
              <div className="grid gap-2">
                {integrationReview.connections.length ? integrationReview.connections.map((connection) => (
                  <div key={connection.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{connection.name}</div>
                        <div className="mt-1 break-all text-xs text-slate-500">{connection.endpointUrl}</div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${connection.status === 'enabled' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                        {connection.status}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Test: {connection.lastTestStatus || 'never'} · Last delivery: {connection.lastDeliverySucceededAt ? formatDateTimeDisplay(connection.lastDeliverySucceededAt) : 'none'}
                    </div>
                    <div className="mt-3">
                      <Button variant="outline" onClick={() => setWebhookDraft(buildWebhookDraft(connection))}>
                        Edit Webhook
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-slate-500">No outbound webhook connections configured yet.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold text-slate-900">{webhookDraft.connectionId ? 'Edit Outbound Webhook' : 'New Outbound Webhook'}</h3>
                  <Button variant="outline" onClick={() => setWebhookDraft(buildWebhookDraft(null))} disabled={webhookSaving || webhookTesting}>
                    New Webhook
                  </Button>
                </div>
                <div className="mt-3 grid gap-3">
                  <Field label="Connection Name">
                    <TextInput
                      value={webhookDraft.name}
                      onChange={(event) => updateWebhookField('name', event.target.value)}
                      placeholder="Primary CRM Webhook"
                    />
                  </Field>
                  <Field label="Endpoint URL" hint="HTTPS endpoint that should receive signed `call.completed` events.">
                    <TextInput
                      value={webhookDraft.endpointUrl}
                      onChange={(event) => updateWebhookField('endpointUrl', event.target.value)}
                      placeholder="https://example.com/everycall/webhook"
                    />
                  </Field>
                  <Field label="Signing Secret" hint={webhookDraft.connectionId ? 'Leave blank to keep the existing secret. Enter a new one to rotate it.' : 'Leave blank to auto-generate one, or enter your own secret.'}>
                    <TextInput
                      value={webhookDraft.signingSecret}
                      onChange={(event) => updateWebhookField('signingSecret', event.target.value)}
                      placeholder="Secret used for X-EveryCall-Signature"
                    />
                  </Field>
                  <Field label="Status">
                    <SelectInput
                      value={webhookDraft.status}
                      options={['enabled', 'disabled']}
                      onChange={(event) => updateWebhookField('status', event.target.value)}
                    />
                  </Field>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-900">Include Call Types</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {WEBHOOK_TYPE_OPTIONS.map((type) => (
                        <label key={type} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={webhookDraft.includeTypes.includes(type)}
                            onChange={() => toggleWebhookType(type)}
                          />
                          <span>{formatLabel(type)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={webhookDraft.includeNonBillable}
                      onChange={(event) => updateWebhookField('includeNonBillable', event.target.checked)}
                    />
                    <span>Include non-billable calls</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={webhookDraft.includeDuplicates}
                      onChange={(event) => updateWebhookField('includeDuplicates', event.target.checked)}
                    />
                    <span>Include duplicate leads</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={webhookDraft.includeTranscript}
                      onChange={(event) => updateWebhookField('includeTranscript', event.target.checked)}
                    />
                    <span>Include transcript artifact when available</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={saveWebhookConnection} disabled={webhookSaving}>
                      {webhookSaving ? 'Saving...' : 'Save Webhook'}
                    </Button>
                    <Button variant="outline" onClick={testWebhookConnection} disabled={webhookTesting || webhookSaving || !webhookDraft.connectionId}>
                      {webhookTesting ? 'Testing...' : 'Test Connection'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-900">Recent Deliveries</div>
              {integrationReview.deliveries.length ? (
                <div className="mt-2 grid gap-2">
                  {integrationReview.deliveries.slice(0, 8).map((delivery) => (
                    <div key={`${delivery.id}-${delivery.delivery_id}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-slate-900">{delivery.connection_name || `Connection ${delivery.connection_id}`}</div>
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
                        {delivery.event_type} · attempt {delivery.attempt_number} · {formatDateTimeDisplay(delivery.created_at)}
                      </div>
                      {delivery.call_sid ? <div className="mt-1 break-all text-xs text-slate-500">Call {delivery.call_sid}</div> : null}
                      {delivery.error_message ? <div className="mt-2 text-xs text-rose-700">{delivery.error_message}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">No webhook deliveries recorded yet.</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Native Connectors</h2>
                <div className="mt-1 text-sm text-slate-500">
                  First-generation connectors for Zapier, HubSpot, Jobber, and ServiceTitan.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {connectorReview.connections.length} connector{connectorReview.connections.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,1.1fr)]">
              <div className="grid gap-2">
                {NATIVE_CONNECTOR_DEFINITIONS.map((definition) => {
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
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="m-0 text-base font-semibold text-slate-900">{selectedConnectorDefinition.label}</h3>
                    <div className="mt-1 text-sm text-slate-500">{selectedConnectorDefinition.description}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3">
                  <Field label="Connection Name">
                    <TextInput
                      value={connectorDraft.name}
                      onChange={(event) => updateConnectorField('name', event.target.value)}
                      placeholder={selectedConnectorDefinition.defaultName}
                    />
                  </Field>

                  {selectedConnectorType === NATIVE_CONNECTOR_TYPES.zapierHook ? (
                    <Field label="Hook URL" hint="Paste the Zapier Catch Hook URL that should receive each call.completed event.">
                      <TextInput
                        value={connectorDraft.endpointUrl}
                        onChange={(event) => updateConnectorField('endpointUrl', event.target.value)}
                        placeholder="https://hooks.zapier.com/hooks/catch/..."
                      />
                    </Field>
                  ) : null}

                  {selectedConnectorType === NATIVE_CONNECTOR_TYPES.hubspotPrivateApp ? (
                    <>
                      <Field label="Private App Token" hint="HubSpot private app access token used for contacts and note writes. Leave blank to keep the saved token.">
                        <TextInput
                          type="password"
                          value={connectorDraft.privateAppToken}
                          onChange={(event) => updateConnectorField('privateAppToken', event.target.value)}
                          placeholder="pat-..."
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={connectorDraft.createNote}
                          onChange={(event) => updateConnectorField('createNote', event.target.checked)}
                        />
                        <span>Create an EveryCall note on the contact timeline</span>
                      </label>
                    </>
                  ) : null}

                  {selectedConnectorType === NATIVE_CONNECTOR_TYPES.jobberClient ? (
                    <>
                      <Field label="Client ID" hint="Jobber OAuth client id for this integration.">
                        <TextInput
                          value={connectorDraft.clientId}
                          onChange={(event) => updateConnectorField('clientId', event.target.value)}
                          placeholder="Jobber client id"
                        />
                      </Field>
                      <Field label="Client Secret" hint="Jobber OAuth client secret. Leave blank to keep the saved secret.">
                        <TextInput
                          type="password"
                          value={connectorDraft.clientSecret}
                          onChange={(event) => updateConnectorField('clientSecret', event.target.value)}
                          placeholder="Jobber client secret"
                        />
                      </Field>
                      <Field label="Refresh Token" hint="Refresh token from the Jobber OAuth flow. Leave blank to keep the saved token.">
                        <TextInput
                          type="password"
                          value={connectorDraft.refreshToken}
                          onChange={(event) => updateConnectorField('refreshToken', event.target.value)}
                          placeholder="Jobber refresh token"
                        />
                      </Field>
                      <Field label="API Version" hint="Required X-JOBBER-GRAPHQL-VERSION header value.">
                        <TextInput
                          value={connectorDraft.apiVersion}
                          onChange={(event) => updateConnectorField('apiVersion', event.target.value)}
                          placeholder="2026-01-20"
                        />
                      </Field>
                    </>
                  ) : null}

                  {selectedConnectorType === NATIVE_CONNECTOR_TYPES.serviceTitanBooking ? (
                    <>
                      <Field label="Client ID" hint="ServiceTitan app client id.">
                        <TextInput
                          value={connectorDraft.clientId}
                          onChange={(event) => updateConnectorField('clientId', event.target.value)}
                          placeholder="ServiceTitan client id"
                        />
                      </Field>
                      <Field label="Client Secret" hint="ServiceTitan app client secret. Leave blank to keep the saved secret.">
                        <TextInput
                          type="password"
                          value={connectorDraft.clientSecret}
                          onChange={(event) => updateConnectorField('clientSecret', event.target.value)}
                          placeholder="ServiceTitan client secret"
                        />
                      </Field>
                      <Field label="App Key" hint="ServiceTitan ST-App-Key header value. Leave blank to keep the saved key.">
                        <TextInput
                          type="password"
                          value={connectorDraft.appKey}
                          onChange={(event) => updateConnectorField('appKey', event.target.value)}
                          placeholder="ServiceTitan app key"
                        />
                      </Field>
                      <Field label="Tenant ID" hint="Numeric ServiceTitan tenant/account id used in the resource path.">
                        <TextInput
                          value={connectorDraft.serviceTitanTenantId}
                          onChange={(event) => updateConnectorField('serviceTitanTenantId', event.target.value)}
                          placeholder="985798691"
                        />
                      </Field>
                      <Field label="Environment">
                        <SelectInput
                          value={connectorDraft.environment}
                          options={['integration', 'production']}
                          onChange={(event) => updateConnectorField('environment', event.target.value)}
                        />
                      </Field>
                      <Field label="Resource Path" hint="Defaults to the ServiceTitan CRM bookings endpoint for the configured tenant.">
                        <TextInput
                          value={connectorDraft.resourcePath}
                          onChange={(event) => updateConnectorField('resourcePath', event.target.value)}
                          placeholder={`/crm/v2/tenant/${connectorDraft.serviceTitanTenantId || 'tenantId'}/bookings`}
                        />
                      </Field>
                    </>
                  ) : null}

                  <Field label="Status">
                    <SelectInput
                      value={connectorDraft.status}
                      options={['enabled', 'disabled']}
                      onChange={(event) => updateConnectorField('status', event.target.value)}
                    />
                  </Field>

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-900">Include Call Types</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {WEBHOOK_TYPE_OPTIONS.map((type) => (
                        <label key={`${selectedConnectorType}-${type}`} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={connectorDraft.includeTypes.includes(type)}
                            onChange={() => toggleConnectorTypeFilter(type)}
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
                    />
                    <span>Include non-billable calls</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={connectorDraft.includeDuplicates}
                      onChange={(event) => updateConnectorField('includeDuplicates', event.target.checked)}
                    />
                    <span>Include duplicate leads</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={connectorDraft.includeTranscript}
                      onChange={(event) => updateConnectorField('includeTranscript', event.target.checked)}
                    />
                    <span>Include transcript artifact when available</span>
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={saveConnector} disabled={connectorSaving}>
                      {connectorSaving ? 'Saving...' : `Save ${selectedConnectorDefinition.label}`}
                    </Button>
                    <Button variant="outline" onClick={testConnector} disabled={connectorTesting || connectorSaving || !connectorDraft.connectionId}>
                      {connectorTesting ? 'Testing...' : 'Test Connection'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-900">Recent Native Connector Deliveries</div>
              {connectorReview.deliveries.length ? (
                <div className="mt-2 grid gap-2">
                  {connectorReview.deliveries.slice(0, 8).map((delivery) => (
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
                        {delivery.event_type} · attempt {delivery.attempt_number} · {formatDateTimeDisplay(delivery.created_at)}
                      </div>
                      {delivery.call_sid ? <div className="mt-1 break-all text-xs text-slate-500">Call {delivery.call_sid}</div> : null}
                      {delivery.error_message ? <div className="mt-2 text-xs text-rose-700">{delivery.error_message}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">No native connector deliveries recorded yet.</div>
              )}
            </div>
          </section>
          </>
          ) : null}

          {showKnowledge ? (
          <>
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Pinned Core Facts <span className="text-sm font-normal text-slate-500">(internal)</span></h2>
                <div className="mt-1 text-sm text-slate-500">Read-only runtime facts automatically selected for the active knowledge build.</div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {coreFacts.pins.length} pinned · {coreFacts.activeBuildId || 'no active build'}
              </div>
            </div>
            {coreFacts.pins.length ? (
              <div className="mt-4 grid gap-2">
                {coreFacts.pins.map((fact) => (
                  <div key={fact.knowledge_fact_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="font-medium text-slate-900">#{fact.core_fact_rank ?? '-'} · {fact.core_fact_title || fact.claim_text}</div>
                      <div className="text-xs text-slate-500">{fact.fact_role || 'detail'}{fact.core_fact_score !== null && fact.core_fact_score !== undefined ? ` · score ${Number(fact.core_fact_score).toFixed(2)}` : ''}</div>
                    </div>
                    {fact.core_fact_spoken_text ? <div className="mt-1 text-slate-600">{fact.core_fact_spoken_text}</div> : null}
                    <div className="mt-2 text-xs text-slate-500">Reason: {fact.core_fact_reason || 'Not recorded'}{fact.core_fact_selected_at ? ` · Selected ${formatDateTimeDisplay(fact.core_fact_selected_at)}` : ''}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">No core facts are pinned for the active build.</div>
            )}
            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="text-sm font-semibold text-slate-900">Recent Pin Changes</div>
              {coreFacts.history.length ? (
                <div className="mt-2 grid gap-2">
                  {coreFacts.history.slice(0, 8).map((change) => (
                    <div key={change.change_id} className="text-xs text-slate-600">
                      <span className="font-medium text-slate-800">{formatLabel(change.change_type) || 'Changed'}</span>
                      {' · '}{change.title || change.claim_text || change.fact_fingerprint || change.knowledge_fact_id}
                      {change.reason ? ` · ${change.reason}` : ''}
                      {change.created_at ? ` · ${formatDateTimeDisplay(change.created_at)}` : ''}
                    </div>
                  ))}
                </div>
              ) : <div className="mt-2 text-sm text-slate-500">No pin changes recorded yet.</div>}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="m-0 text-lg font-semibold">Knowledge Builds</h2>
            <div className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-medium ${activeRuntimeReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
              {activeRuntimeReady ? 'latest published build is active' : 'active runtime needs attention'}
            </div>
            <div className="mt-3 text-sm text-slate-600">
              A tenant is operationally ready when the latest build is published and selected as the active runtime.
            </div>
            <div className="mt-4 grid gap-2">
              {builds.length ? builds.map((build) => (
                <div key={build.build_id} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{build.version || build.build_id}</div>
                      <div className="text-xs text-slate-500">{build.build_id}</div>
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${build.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                      {build.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Cards: {build.artifact_counts_json?.cards || 0} · Facts: {build.artifact_counts_json?.facts || 0}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-slate-500">No builds yet.</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Safety Rules</h2>
                <div className="mt-1 text-sm text-slate-500">
                  These are the tenant guardrails counted by the `Safety rules configured` system check.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {guardrails.length} rule{guardrails.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <div className="grid gap-2">
                {guardrails.length ? guardrails.map((guardrail) => (
                  <div key={guardrail.knowledge_guardrail_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{formatLabel(guardrail.guardrail_type)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatLabel(guardrail.mode)} · {formatLabel(guardrail.risk_level)} · {guardrail.enabled === false ? 'Disabled' : 'Enabled'}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${guardrail.status === 'approved_live' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                        {guardrail.status}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {guardrail.approved_response_pattern || 'No approved response pattern yet.'}
                    </div>
                    {Array.isArray(guardrail.trigger_patterns_json) && guardrail.trigger_patterns_json.length ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Triggers: {guardrail.trigger_patterns_json.slice(0, 3).join(', ')}
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <Button variant="outline" onClick={() => setGuardrailDraft(buildGuardrailDraft(guardrail))}>
                        Edit Rule
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-slate-500">No safety rules configured yet.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold text-slate-900">{guardrailDraft.knowledgeGuardrailId ? 'Edit Safety Rule' : 'New Safety Rule'}</h3>
                  <Button variant="outline" onClick={() => setGuardrailDraft(buildGuardrailDraft(null))} disabled={guardrailSaving}>
                    New Rule
                  </Button>
                </div>
                <div className="mt-3 grid gap-3">
                  <Field label="Rule Type">
                    <SelectInput
                      value={guardrailDraft.guardrailType}
                      options={GUARDRAIL_TYPE_OPTIONS}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, guardrailType: event.target.value }))}
                    />
                  </Field>
                  <Field label="Trigger Patterns" hint="One phrase per line. These are matched against caller requests.">
                    <TextArea
                      value={guardrailDraft.triggerPatternsText}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, triggerPatternsText: event.target.value }))}
                      placeholder={'emergency\nsuicidal\nmedical advice'}
                    />
                  </Field>
                  <Field label="Risk Level">
                    <SelectInput
                      value={guardrailDraft.riskLevel}
                      options={RISK_LEVEL_OPTIONS}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, riskLevel: event.target.value }))}
                    />
                  </Field>
                  <Field label="Mode">
                    <SelectInput
                      value={guardrailDraft.mode}
                      options={GUARDRAIL_MODE_OPTIONS}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, mode: event.target.value }))}
                    />
                  </Field>
                  <Field label="Approved Response Pattern">
                    <TextArea
                      value={guardrailDraft.approvedResponsePattern}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, approvedResponsePattern: event.target.value }))}
                      placeholder="Please respond with the approved bounded answer only."
                    />
                  </Field>
                  <Field label="Required Next Step">
                    <TextInput
                      value={guardrailDraft.requiredNextStep}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, requiredNextStep: event.target.value }))}
                      placeholder="Escalate to office"
                    />
                  </Field>
                  <Field label="Escalation Instruction">
                    <TextArea
                      value={guardrailDraft.escalationInstruction}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, escalationInstruction: event.target.value }))}
                      placeholder="If the caller asks for medical, legal, or dangerous technical advice, do not answer directly."
                    />
                  </Field>
                  <Field label="Optional Capture Fields" hint="One field per line.">
                    <TextArea
                      value={guardrailDraft.optionalCaptureFieldsText}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, optionalCaptureFieldsText: event.target.value }))}
                      placeholder={'caller_name\ncallback_number'}
                    />
                  </Field>
                  <Field label="Status">
                    <SelectInput
                      value={guardrailDraft.status}
                      options={ARTIFACT_STATUS_OPTIONS}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, status: event.target.value }))}
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(guardrailDraft.enabled)}
                      onChange={(event) => setGuardrailDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    Enabled
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={saveGuardrail} disabled={guardrailSaving}>
                      {guardrailSaving ? 'Saving...' : 'Save Safety Rule'}
                    </Button>
                    <Button variant="outline" onClick={() => setGuardrailDraft(buildGuardrailDraft(null))} disabled={guardrailSaving}>
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Approved Answers And Notices</h2>
                <div className="mt-1 text-sm text-slate-500">
                  These tenant overrides count toward the `Approved answers configured` system check when they are saved as approved live.
                </div>
              </div>
              <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {overrides.length} item{overrides.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <div className="grid gap-2">
                {overrides.length ? overrides.map((override) => (
                  <div key={override.knowledge_override_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{override.title || formatLabel(override.override_type)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatLabel(override.override_type)} · Priority {override.priority ?? 100}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${override.status === 'approved_live' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                        {override.status}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">{override.body || 'No answer text yet.'}</div>
                    <div className="mt-3">
                      <Button variant="outline" onClick={() => setOverrideDraft(buildOverrideDraft(override))}>
                        Edit Answer
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-slate-500">No approved answers or notices configured yet.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold text-slate-900">{overrideDraft.knowledgeOverrideId ? 'Edit Answer / Notice' : 'New Answer / Notice'}</h3>
                  <Button variant="outline" onClick={() => setOverrideDraft(buildOverrideDraft(null))} disabled={overrideSaving}>
                    New Item
                  </Button>
                </div>
                <div className="mt-3 grid gap-3">
                  <Field label="Type">
                    <SelectInput
                      value={overrideDraft.overrideType}
                      options={OVERRIDE_TYPE_OPTIONS}
                      onChange={(event) => setOverrideDraft((current) => ({ ...current, overrideType: event.target.value }))}
                    />
                  </Field>
                  <Field label="Title">
                    <TextInput
                      value={overrideDraft.title}
                      onChange={(event) => setOverrideDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Emergency pricing note"
                    />
                  </Field>
                  <Field label="Answer / Notice Text">
                    <TextArea
                      value={overrideDraft.body}
                      onChange={(event) => setOverrideDraft((current) => ({ ...current, body: event.target.value }))}
                      placeholder="Provide the approved bounded answer or notice here."
                    />
                  </Field>
                  <Field label="Priority">
                    <TextInput
                      type="number"
                      step="1"
                      value={overrideDraft.priority}
                      onChange={(event) => setOverrideDraft((current) => ({ ...current, priority: event.target.value }))}
                    />
                  </Field>
                  <Field label="Status">
                    <SelectInput
                      value={overrideDraft.status}
                      options={ARTIFACT_STATUS_OPTIONS}
                      onChange={(event) => setOverrideDraft((current) => ({ ...current, status: event.target.value }))}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={saveOverride} disabled={overrideSaving}>
                      {overrideSaving ? 'Saving...' : 'Save Answer'}
                    </Button>
                    <Button variant="outline" onClick={() => setOverrideDraft(buildOverrideDraft(null))} disabled={overrideSaving}>
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Runtime Preview</h2>
                <div className="mt-1 text-sm text-slate-500">
                  Admin-only test of the likely answer from this tenant’s current published build.
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              This is only an estimate. It does not include the full context of a real call already in progress.
            </div>
            <Field label="Representative Query" hint="Ask a caller-style question to inspect the likely answer and runtime details.">
              <TextInput
                value={previewQuery}
                onChange={(event) => setPreviewQuery(event.target.value)}
                placeholder="Do you handle after-hours emergencies?"
              />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={runRuntimePreview} disabled={previewBusy || !previewQuery.trim()}>
                {previewBusy ? 'Running...' : 'Run Preview'}
              </Button>
            </div>
            {preview ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-900">Likely Spoken Answer</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">{representativeAnswer}</div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <RuntimeStat label="Runtime Mode" value={formatLabel(previewRuntimeBundle?.runtime_mode || '-')} />
                  <RuntimeStat label="Selected Cards" value={previewRuntimeBundle?.selected_cards?.length || 0} />
                  <RuntimeStat label="Used Facts" value={previewRuntimeBundle?.selected_answer_facts?.length || 0} />
                  <RuntimeStat label="Confidence" value={previewRuntimeBundle?.confidence_score ?? '-'} />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <PreviewList
                    title="Direct Answer Points"
                    items={previewAnswerPacket?.direct_answer_points}
                    emptyText="No direct answer points were assembled."
                  />
                  <PreviewList
                    title="Qualifiers"
                    items={previewAnswerPacket?.qualifiers}
                  />
                  <PreviewList
                    title="Limits or Exclusions"
                    items={previewAnswerPacket?.limits_or_exclusions}
                  />
                  <PreviewList
                    title="Next Step Options"
                    items={previewAnswerPacket?.next_step_options}
                  />
                </div>

                <details className="rounded-lg border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">Advanced Details</summary>
                  <div className="mt-3 grid gap-3">
                    <PreviewList
                      title="Planner Coverage Items"
                      items={previewPlanner?.coverage_items}
                      emptyText="No planner coverage items returned."
                    />
                    <PreviewList
                      title="Planner Next-Step Suggestions"
                      items={previewPlanner?.next_step_suggestions}
                      emptyText="No planner next-step suggestions returned."
                    />

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">Coverage Support</div>
                      {Array.isArray(previewAnswerPacket?.coverage) && previewAnswerPacket.coverage.length ? (
                        <div className="mt-2 grid gap-2">
                          {previewAnswerPacket.coverage.map((item) => (
                            <div key={item.requested_coverage_item_text} className="rounded-md border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium text-slate-900">{item.requested_coverage_item_text}</div>
                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                  item.support_strength === 'strong'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : item.support_strength === 'partial'
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-rose-100 text-rose-800'
                                }`}>
                                  {formatLabel(item.support_strength)}
                                </span>
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                Cards: {(item.used_card_ids || []).length} · Facts: {(item.used_fact_ids || []).length}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">No coverage items were returned.</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">Structured Answer Packet</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {JSON.stringify(previewAnswerPacket, null, 2)}
                      </pre>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-semibold text-slate-900">Runtime Bundle</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {JSON.stringify(previewRuntimeBundle, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
          </section>
          </>
          ) : null}
        </div>
        ) : null}
      </div>

      {showOverview ? (
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold">Tenant Team</h2>
            <div className="text-sm text-slate-500">Read-only view of all tenant users. The main contact above is the first owner user when present.</div>
          </div>
          <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {users.length} user{users.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {users.length ? users.map((user) => <UserCard key={user.id || user.email} user={user} />) : (
            <div className="text-sm text-slate-500">No tenant users found.</div>
          )}
        </div>
      </section>
      ) : null}

      {showAdvanced ? (
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-lg font-semibold">Advanced Tenant Record</h2>
            <div className="text-sm text-slate-500">
              Lower-level fields for core tenant metadata and forwarding state stored directly on the <code>tenants</code> table.
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Created {formatDateTimeDisplay(tenant?.created_at)} · Updated {formatDateTimeDisplay(tenant?.updated_at)}
            </div>
          </div>
          <Button onClick={saveTenant} disabled={saving || !draft || !hasUnsavedChanges}>
            {saving ? 'Saving...' : 'Save Advanced Fields'}
          </Button>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Billing lifecycle fields are intentionally hidden here. Use the Billing tab for pricing, coupons, current-period adjustments, and the dedicated `Extend Demo` workflow.
          </div>

          {ADVANCED_FIELD_SECTIONS.map((section) => (
            <section key={section.id} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3">
                <h3 className="m-0 text-base font-semibold text-slate-900">{section.title}</h3>
                <div className="text-sm text-slate-500">{section.description}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {section.fields.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    {field.type === 'textarea' ? (
                      <TextArea
                        value={draft?.[field.key] || ''}
                        onChange={(event) => updateField(field.key, event.target.value)}
                        placeholder={field.placeholder || ''}
                      />
                    ) : field.type === 'select' ? (
                      <SelectInput
                        value={draft?.[field.key] || ''}
                        options={field.options}
                        onChange={(event) => updateField(field.key, event.target.value)}
                      />
                    ) : (
                      <TextInput
                        type={field.type === 'datetime' ? 'datetime-local' : field.type}
                        value={draft?.[field.key] || ''}
                        onChange={(event) => updateField(field.key, event.target.value)}
                        placeholder={field.placeholder || ''}
                        required={field.required}
                        step={field.type === 'number' ? '1' : undefined}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={resetToSaved} disabled={!hasUnsavedChanges || saving}>Reset To Saved</Button>
          <Button onClick={saveTenant} disabled={saving || !draft || !hasUnsavedChanges}>
            {saving ? 'Saving...' : 'Save Advanced Fields'}
          </Button>
        </div>
      </section>
      ) : null}
    </section>
  );
}

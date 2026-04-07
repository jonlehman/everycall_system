export const TENANT_ADMIN_SECTION_ITEMS = [
  { key: 'overview', label: 'Overview', segment: 'overview' },
  { key: 'billing', label: 'Billing', segment: 'billing' },
  { key: 'voice-integrations', label: 'Voice & Integrations', segment: 'voice-integrations' },
  { key: 'knowledge', label: 'Knowledge', segment: 'knowledge' },
  { key: 'advanced', label: 'Advanced', segment: 'advanced' }
];

export function buildTenantAdminSectionHref(tenantKey, segment) {
  return `/admin/tenants/${encodeURIComponent(tenantKey)}/${segment}`;
}

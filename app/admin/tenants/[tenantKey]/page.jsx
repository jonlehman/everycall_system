import { redirect } from 'next/navigation';

export default async function AdminTenantIndexPage({ params }) {
  redirect(`/admin/tenants/${encodeURIComponent(params.tenantKey)}/overview`);
}

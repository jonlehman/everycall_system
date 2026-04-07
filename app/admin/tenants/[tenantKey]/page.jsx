import { redirect } from 'next/navigation';

export default async function AdminTenantIndexPage({ params }) {
  const resolvedParams = await params;
  redirect(`/admin/tenants/${encodeURIComponent(resolvedParams.tenantKey)}/overview`);
}

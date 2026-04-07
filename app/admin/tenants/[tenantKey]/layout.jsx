import TenantSectionNav from './_components/TenantSectionNav';

export default function AdminTenantLayout({ children }) {
  return (
    <section className="grid gap-4">
      <TenantSectionNav />
      {children}
    </section>
  );
}

import SystemSectionNav from './_components/SystemSectionNav';

export default function AdminSystemLayout({ children }) {
  return (
    <section className="grid gap-4">
      <div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-slate-950">System Config</h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform-wide settings for defaults, billing, coupons, messaging, and prompt behavior.
        </p>
      </div>
      <SystemSectionNav />
      {children}
    </section>
  );
}

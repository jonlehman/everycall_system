import AdminSidebar from './_components/AdminSidebar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AdminLayout({ children }) {
  return (
    <div className="shell">
      <AdminSidebar />
      <main className="main">{children}</main>
    </div>
  );
}

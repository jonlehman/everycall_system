import AdminShell from './_components/AdminShell';
import './admin.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AdminLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}

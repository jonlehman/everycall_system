import ClientLayoutShell from './ClientLayoutShell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ClientLayout({ children }) {
  return <ClientLayoutShell>{children}</ClientLayoutShell>;
}

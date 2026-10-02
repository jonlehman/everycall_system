import SalesShell from './SalesShell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function SalesLayout({ children }) {
  return <SalesShell>{children}</SalesShell>;
}

import SalesShell from './SalesShell';

export const metadata = {
  title: { default: 'EveryCall - sales', template: '%s - sales' }
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function SalesLayout({ children }) {
  return <SalesShell>{children}</SalesShell>;
}

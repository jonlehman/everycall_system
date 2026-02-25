import Sidebar from './_components/Sidebar';
import Header from './_components/Header';
import './client.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ClientLayout({ children }) {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Header />
        {children}
      </main>
    </div>
  );
}

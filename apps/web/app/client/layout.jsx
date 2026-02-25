import Sidebar from './_components/Sidebar';
import Header from './_components/Header';
import './client.css';

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

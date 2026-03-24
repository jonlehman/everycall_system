import ClientPage from './ClientPage';
import SectionTabs from './SectionTabs';

export default function SectionPage({ tabs = [], title, subtitle = '', status = null, primaryAction = null, children }) {
  return (
    <ClientPage title={title} subtitle={subtitle} status={status} primaryAction={primaryAction}>
      <SectionTabs items={tabs} />
      {children}
    </ClientPage>
  );
}

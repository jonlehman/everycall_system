import ClientPage from './ClientPage';
import SectionTabs from './SectionTabs';

export default function SectionPage({ tabs = [], title, subtitle = '', status = null, primaryAction = null, headerAside = null, statusChip = null, children }) {
  return (
    <ClientPage title={title} subtitle={subtitle} status={status} primaryAction={primaryAction} headerAside={headerAside}>
      {tabs.length ? (
        <div className="-mx-4 sticky top-16 z-40 mb-2 border-b border-slate-200/70 bg-white px-4 md:-mx-8 md:px-8">
          <div className="flex h-14 items-center justify-between gap-4">
            <SectionTabs items={tabs} />
            {statusChip ? (
              <div className="hidden items-center gap-2 md:flex">
                <span className={`h-2 w-2 rounded-full ${statusChip.tone === 'ok' ? 'bg-[#006229]' : statusChip.tone === 'warn' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${
                  statusChip.tone === 'ok' ? 'text-[#006229]' : statusChip.tone === 'warn' ? 'text-amber-700' : 'text-slate-500'
                }`}>
                  {statusChip.label}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
    </ClientPage>
  );
}

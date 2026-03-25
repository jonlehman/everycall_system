import { cn } from '../../../lib/utils';

export default function GuidePanel({ title, eyebrow = 'Guide', icon = 'architecture', className = '', children }) {
  return (
    <aside
      className={cn(
        'rounded-xl border border-slate-200/50 bg-[#e6eeff] p-6 text-slate-700',
        className
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-[#004ac6]">{icon}</span>
        <h2 className="m-0 text-lg font-bold tracking-[-0.02em] text-slate-900">{title}</h2>
      </div>
      <div className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</div>
      <div className="mt-4 grid gap-4 text-sm leading-6 text-slate-600">{children}</div>
    </aside>
  );
}

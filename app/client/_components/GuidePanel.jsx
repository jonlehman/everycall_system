import { cn } from '../../../lib/utils';

export default function GuidePanel({ title, eyebrow = 'Guide', className = '', children }) {
  return (
    <aside
      className={cn(
        'rounded-[28px] border border-[#d8e3fb] bg-gradient-to-b from-[#eef3ff] to-[#eaf1ff] p-5 text-slate-700 shadow-[0_18px_40px_rgba(17,35,63,0.07)]',
        className
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4f73a8]">{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-600">{children}</div>
    </aside>
  );
}

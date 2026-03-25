import { cn } from '../../../lib/utils';

function formatStep(step) {
  const value = String(step || '').trim();
  if (!value) return '';
  return value.length >= 2 ? value : value.padStart(2, '0');
}

export default function StepSection({ step, title, description = '', className = '', contentClassName = '', children }) {
  return (
    <section
      className={cn(
        'rounded-[30px] border border-[#dfe7f5] bg-[#f7f9fe] p-4 shadow-[0_18px_40px_rgba(17,35,63,0.06)]',
        className
      )}
    >
      <div className="flex items-start gap-3">
        {step ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#162033] text-xs font-semibold text-white shadow-sm">
            {formatStep(step)}
          </div>
        ) : null}
        <div className="min-w-0">
          <h2 className="m-0 text-[1.3rem] font-semibold tracking-tight text-slate-900">{title}</h2>
          {description ? <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
        </div>
      </div>
      <div
        className={cn(
          'mt-4 rounded-[24px] border border-white/90 bg-white/85 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
          contentClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

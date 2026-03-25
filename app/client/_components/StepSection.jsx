import { cn } from '../../../lib/utils';

function formatStep(step) {
  const value = String(step || '').trim();
  if (!value) return '';
  return value.length >= 2 ? value : value.padStart(2, '0');
}

export default function StepSection({ step, title, description = '', className = '', contentClassName = '', children }) {
  return (
    <section className={cn('space-y-6', className)}>
      <div className="flex items-start gap-3">
        {step ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#121c2a] text-xs font-bold text-white">
            {formatStep(step)}
          </div>
        ) : null}
        <div className="min-w-0">
          <h2 className="m-0 text-xl font-semibold tracking-[-0.02em] text-slate-900">{title}</h2>
          {description ? <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
        </div>
      </div>
      <div
        className={cn(
          'rounded-xl border border-slate-200/30 bg-[#eff4ff] p-6',
          contentClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

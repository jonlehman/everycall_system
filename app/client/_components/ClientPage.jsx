import Link from 'next/link';
import { Button, buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

function toneClass(tone) {
  if (tone === 'bad') return 'rounded-[18px] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900 shadow-sm';
  if (tone === 'ok') return 'rounded-[18px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-900 shadow-sm';
  if (tone === 'warn') return 'rounded-[18px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 shadow-sm';
  return 'rounded-[18px] border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-700 shadow-sm';
}

export default function ClientPage({ title, subtitle = '', status = null, primaryAction = null, children }) {
  const renderPrimaryAction = () => {
    if (!primaryAction) return null;
    if (primaryAction.onClick) {
      return (
        <Button
          variant={primaryAction.brand ? 'default' : 'outline'}
          type="button"
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
        >
          {primaryAction.label}
        </Button>
      );
    }
    return (
      <Link
        className={cn(buttonVariants({ variant: primaryAction.brand ? 'default' : 'outline' }))}
        href={primaryAction.href}
      >
        {primaryAction.label}
      </Link>
    );
  };

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Client Workspace</div>
          <h1 className="m-0 mt-2 text-[2rem] font-semibold tracking-tight text-slate-950">{title}</h1>
          {subtitle ? <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="flex gap-2">
          {renderPrimaryAction()}
        </div>
      </div>

      {status?.message ? (
        <div className={toneClass(status.tone)}>
          {status.message}
        </div>
      ) : null}

      {children}
    </section>
  );
}

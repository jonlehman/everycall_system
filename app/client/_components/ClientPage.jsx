import Link from 'next/link';
import { Button, buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

function toneClass(tone) {
  if (tone === 'bad') return 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900';
  if (tone === 'ok') return 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900';
  if (tone === 'warn') return 'rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900';
  return 'rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700';
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
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="m-0 mt-1 text-sm text-slate-500">{subtitle}</p> : null}
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

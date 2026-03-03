import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

export default function AdminMonitoringPage() {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Live Call Monitoring</h1>
      </div>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <p className="text-sm text-slate-500">Uses the same feed as the Operator Dashboard, but cross-tenant.</p>
        <a className={cn(buttonVariants({ variant: 'outline' }))} href="/dashboard">Open Operator Dashboard View</a>
      </div>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { buttonVariants } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

const SUPPORT_SECTIONS = [
  {
    title: 'Launch EveryCall Safely',
    body: 'Work through Basics, Knowledge, Notifications, and the Go Live Checklist in that order so the Sales Receptionist sounds specific before calls are routed to it.',
    links: [
      { href: '/client/receptionist/basics', label: 'Open Basics' },
      { href: '/client/receptionist/knowledge', label: 'Open Knowledge' },
      { href: '/client/receptionist/go-live', label: 'Open Go Live Checklist' }
    ]
  },
  {
    title: 'Understand Valid Lead Billing',
    body: 'Every completed call is visible in Calls and Billing. Only valid billable leads count toward usage. General questions, duplicates, spam, and non-project calls do not.',
    links: [
      { href: '/client/account/billing', label: 'Open Billing' },
      { href: '/client/calls', label: 'Open Calls' }
    ]
  },
  {
    title: 'Connect Downstream Systems',
    body: 'Integrations send completed calls with classification and structured caller details. Save the connector first, then test it before relying on live delivery.',
    links: [
      { href: '/client/account/integrations', label: 'Open Integrations' }
    ]
  },
  {
    title: 'Need Human Help?',
    body: 'If something looks wrong in live call handling, billing, or lead delivery, contact support with the call time, caller number if known, and what behavior you expected.',
    links: [
      { href: 'mailto:support@everycall.io', label: 'Email Support', external: true }
    ]
  }
];

export default function AccountSupportPage() {
  return (
    <SectionPage
      tabs={accountNavItems}
      title="Support"
      subtitle="Find the main launch steps, billing rules, and the fastest path to help when something needs attention."
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
        <div className="grid min-w-0 gap-3">
          {SUPPORT_SECTIONS.map((section) => (
            <section key={section.title} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="m-0 text-lg font-semibold">{section.title}</h2>
              <p className="m-0 mt-2 text-sm leading-6 text-slate-600">{section.body}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {section.links.map((link) => (
                  link.external ? (
                    <a
                      key={`${section.title}-${link.label}`}
                      href={link.href}
                      className={cn(buttonVariants({ variant: 'outline' }))}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      key={`${section.title}-${link.label}`}
                      href={link.href}
                      className={cn(buttonVariants({ variant: 'outline' }))}
                    >
                      {link.label}
                    </Link>
                  )
                ))}
              </div>
            </section>
          ))}
        </div>

        <GuidePanel title="Support Guide" eyebrow="What to include" icon="help">
          <div>When you contact support, include the tenant name, the time of the call, and what result you expected. That makes it much faster to trace gateway, knowledge, and notification behavior.</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Good support notes</div>
            <div className="mt-1 text-sm text-slate-600">Call time, caller number, what the receptionist said, whether the lead reached email/SMS/integrations, and whether the knowledge build was published.</div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="font-semibold text-slate-900">Where to check first</div>
            <div className="mt-1 text-sm text-slate-600">Calls for summaries and classifications, Billing for lead counts, Knowledge for build status, and Go Live for launch blockers.</div>
          </div>
        </GuidePanel>
      </div>
    </SectionPage>
  );
}

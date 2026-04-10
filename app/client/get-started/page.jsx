'use client';

import Link from 'next/link';
import ClientPage from '../_components/ClientPage';

function panelClassName(extra = '') {
  return `rounded-xl border border-slate-200/70 bg-white shadow-sm ${extra}`.trim();
}

function SetupStepCard({ title, description, action = null }) {
  return (
    <section className={panelClassName('p-5')}>
      <div className="min-w-0">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
      </div>
      {action ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {action}
        </div>
      ) : null}
    </section>
  );
}

export default function ClientGetStartedPage() {
  return (
    <ClientPage
      title="Get Started"
      subtitle="These are the first things to do to get EveryCall ready for live calls."
    >
      <div className="grid min-w-0 gap-3">
        <section className={panelClassName('p-5')}>
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-900">What To Do</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Work through these items in order. Once they are done, EveryCall is ready to handle real calls.
            </p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <SetupStepCard
              title="1. Teach EveryCall About Your Business"
              description="Open Knowledge and make sure EveryCall has enough approved information to answer basic questions about your business."
              action={(
                <Link
                  href="/client/receptionist/knowledge"
                  className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                >
                  Open Knowledge
                </Link>
              )}
            />
            <SetupStepCard
              title="2. Choose Where Leads Go"
              description="Open Send Leads To and choose which people should receive new lead alerts by email or text."
              action={(
                <Link
                  href="/client/team"
                  className="inline-flex items-center rounded-md border border-[#004ac6] bg-white px-3 py-2 text-sm font-semibold text-[#004ac6] transition-colors hover:bg-[#eff4ff]"
                >
                  Open Send Leads To
                </Link>
              )}
            />
            <SetupStepCard
              title="3. Forward Your Calls"
              description="When your EveryCall number is ready, it will appear in the header. Forward desired calls from your business phone system to that number."
            />
          </div>
        </section>
      </div>
    </ClientPage>
  );
}

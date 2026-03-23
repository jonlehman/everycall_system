export const metadata = {
  title: 'SMS Terms',
  description: 'EveryCall SMS terms and conditions'
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-tight">SMS Terms</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        These SMS Terms apply to text message programs provided by Creative Dynamic Co dba EveryCall.
      </p>

      <section className="mt-8 space-y-4 text-sm leading-6 text-slate-700">
        <h2 className="text-lg font-semibold text-slate-900">Program Description</h2>
        <p>
          Subscribers may receive SMS new lead alerts for the EveryCall client account they support. These messages are
          intended for team users who choose to receive lead notifications by text message.
        </p>

        <h2 className="text-lg font-semibold text-slate-900">Message Frequency</h2>
        <p>Message frequency may vary based on new lead activity and subscriber preferences.</p>

        <h2 className="text-lg font-semibold text-slate-900">Fees</h2>
        <p>Message and data rates may apply based on the subscriber&apos;s wireless plan.</p>

        <h2 className="text-lg font-semibold text-slate-900">Opt-In and Opt-Out</h2>
        <p>
          By opting in, the subscriber agrees to receive SMS new lead alerts from EveryCall. Reply <strong>STOP</strong>{' '}
          to opt out at any time. Reply <strong>HELP</strong> for help.
        </p>

        <h2 className="text-lg font-semibold text-slate-900">Support</h2>
        <p>
          For help, contact <a className="text-sky-700 underline" href="mailto:support@everycall.io">support@everycall.io</a>{' '}
          or visit <a className="text-sky-700 underline" href="/privacy">our privacy policy</a>.
        </p>
      </section>
    </main>
  );
}

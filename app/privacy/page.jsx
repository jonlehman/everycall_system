export const metadata = {
  title: 'Privacy Policy',
  description: 'EveryCall privacy policy'
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        This Privacy Policy describes how Creative Dynamic Co dba EveryCall collects, uses, and protects information
        provided through the EveryCall platform.
      </p>

      <section className="mt-8 space-y-4 text-sm leading-6 text-slate-700">
        <h2 className="text-lg font-semibold text-slate-900">Information We Collect</h2>
        <p>
          We collect account details, contact information, workspace settings, call-related data, and messaging
          preferences needed to provide EveryCall services.
        </p>

        <h2 className="text-lg font-semibold text-slate-900">How We Use Information</h2>
        <p>
          We use this information to operate the service, send account and lead notifications, provide customer support,
          improve platform reliability, and maintain security and compliance.
        </p>

        <h2 className="text-lg font-semibold text-slate-900">SMS Privacy Commitment</h2>
        <p>
          Mobile information and SMS opt-in data will not be shared, sold, rented, or disclosed to third parties or
          affiliates for marketing or promotional purposes.
        </p>
        <p>
          Text messaging originator opt-in data and consent are used only to deliver the SMS program requested by the
          subscriber and to maintain related compliance records.
        </p>

        <h2 className="text-lg font-semibold text-slate-900">Data Security</h2>
        <p>
          We use administrative, technical, and physical safeguards designed to protect the information we store and
          process through the platform.
        </p>

        <h2 className="text-lg font-semibold text-slate-900">Contact</h2>
        <p>
          For privacy questions or support, contact <a className="text-sky-700 underline" href="mailto:support@everycall.io">support@everycall.io</a>.
        </p>
      </section>
    </main>
  );
}

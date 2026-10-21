export const metadata = { title: "EveryCall checkout" };
export default function CheckoutResultPage() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8">
      <h1 className="text-2xl font-semibold text-slate-950">
        Your EveryCall checkout
      </h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        If you completed checkout, Stripe will send confirmation and EveryCall
        will update your payment status. Returning to this page does not confirm
        payment.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Your next step is a 15-minute setup call with Jon to get your line
        forwarded. If you still need to pay, Jon can help at the start of that
        call.
      </p>
      <a
        className="mt-6 inline-block font-semibold text-blue-700"
        href="https://everycall.io"
      >
        Return to EveryCall
      </a>
    </div>
  );
}

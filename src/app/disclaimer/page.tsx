import Link from 'next/link';

export default function DisclaimerPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-normal">Disclaimer</h1>
      <div className="mt-6 space-y-4 text-sm leading-7 text-slate-600">
        <p>
          Yeosonam provides travel information, package summaries, and operational guidance for
          planning support. Final prices, availability, schedules, visa rules, hotel details, and
          airline conditions can change before confirmation.
        </p>
        <p>
          Booking terms, cancellation fees, and supplier conditions are confirmed through the
          official reservation process. For time-sensitive or legal requirements, use the confirmed
          documents and notices provided with the booking.
        </p>
      </div>
      <div className="mt-8 flex gap-3">
        <Link className="text-sm font-medium text-blue-700 hover:underline" href="/privacy">
          Privacy
        </Link>
        <Link className="text-sm font-medium text-blue-700 hover:underline" href="/packages">
          Packages
        </Link>
      </div>
    </main>
  );
}
